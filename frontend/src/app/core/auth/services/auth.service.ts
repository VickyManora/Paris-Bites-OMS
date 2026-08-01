import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, map, of, shareReplay, switchMap, tap, type Observable } from 'rxjs';
import { ApiEndpoints } from '../../constants/api-endpoints';
import { AppRoutes } from '../../constants/app.constants';
import { skipErrorNotification } from '../../http/interceptors/error.interceptor';
import { skipLoading } from '../../http/interceptors/loading.interceptor';
import { withTimeout } from '../../http/interceptors/timeout.interceptor';
import type { ApiSuccessResponse } from '../../models/api-response.model';
import type { Permission } from '../../models/permission.model';
import { hasAtLeastRole, type Role } from '../../models/role.model';
import type {
  AuthUser,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  RefreshResponse,
} from '../models/auth.model';
import { TokenStorageService } from './token-storage.service';
import { StorageKeys } from '../../constants/storage-keys';
import { StorageService } from '../../services/storage.service';

/**
 * Authentication state and operations.
 *
 * State is exposed as signals so guards and templates read it synchronously —
 * no `async` pipe, no subscription to leak, and no chance of a guard running
 * against a stale value. Observables are kept only for the HTTP calls themselves,
 * where `retry`/`switchMap`/`shareReplay` are genuinely the right tools.
 */
/**
 * The last known identity, kept in local storage. Never a credential — see `sessionHint`.
 */
interface SessionHint {
  readonly role: Role;
  readonly permissions: readonly Permission[];
}

/**
 * How long the session restore may wait for the API.
 *
 * Sized for a cold start on the free tier rather than for a healthy request: the service stops
 * after fifteen idle minutes and takes the better part of a minute to come back. The app is usable
 * throughout — nothing waits on this — so a long deadline costs nothing and saves the session.
 */
const COLD_START_TIMEOUT_MS = 90_000;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly tokenStorage = inject(TokenStorageService);

  private readonly storage = inject(StorageService);

  private readonly currentUser = signal<AuthUser | null>(null);
  /** True until the initial session restore settles. */
  private readonly initialising = signal(true);

  /**
   * Who this browser was signed in as when it was last used, or `null`.
   *
   * **Not a credential, and it cannot be made into one.** It holds a role and a list of permission
   * strings — nothing the API would accept, no token, no signature. Every request still carries an
   * access token the server issued, and the server re-authorises every action regardless of what
   * this says. Editing it in devtools grants a user nothing except a menu that 403s.
   *
   * It exists because the app boots faster than the API wakes. A cold start on the free tier costs
   * about a minute, and restoring a session is the first request the app makes; with nothing to go
   * on, the guards treat a still-restoring session as no session and send a signed-in cashier to
   * the login form — where signing in *also* waits on the same sleeping API. With it, the app can
   * render the screens that identity had while the real answer is in flight.
   *
   * It carries permissions rather than a bare flag because `permissionGuard` and every
   * `*pbHasPermission` in the app ask what the user may do, not merely whether they exist. A flag
   * would have got the cashier past the front door and left them looking at an empty shell.
   */
  private readonly sessionHint = signal<SessionHint | null>(
    this.storage.get<SessionHint | null>(StorageKeys.sessionHint, null),
  );

  /** Whether a previous session is remembered — see `sessionHint`. */
  readonly hadSession: Signal<boolean> = computed(() => this.sessionHint() !== null);

  /**
   * True when the app should render as signed in: either it is, or it is about to be.
   *
   * The second case is the cold start. `isAuthenticated` stays strict — it means "there is a user
   * object" — and this is what the guards ask, so the difference between the two is stated once
   * here instead of being re-derived at every call site.
   */
  readonly isSignedInOrRestoring: Signal<boolean> = computed(
    () => this.isAuthenticated() || (this.initialising() && this.hadSession()),
  );

  readonly user: Signal<AuthUser | null> = this.currentUser.asReadonly();
  readonly isInitialising: Signal<boolean> = this.initialising.asReadonly();

  readonly isAuthenticated: Signal<boolean> = computed(() => this.currentUser() !== null);

  /**
   * The current role, falling back to the remembered one *only* while the session is being
   * restored. Once the restore settles the hint is never consulted again — either a real user
   * arrived, or there is no session and the answer is `null`.
   */
  readonly role: Signal<Role | null> = computed(
    () =>
      this.currentUser()?.role ?? (this.initialising() ? (this.sessionHint()?.role ?? null) : null),
  );
  readonly displayName: Signal<string> = computed(() => this.currentUser()?.fullName ?? '');

  /**
   * Permissions granted by the server, as a Set for O(1) lookup.
   *
   * `can()` is called from templates, which re-evaluate on every change
   * detection pass, so an array `includes` over 20+ entries per call adds up.
   */
  private readonly permissionSet: Signal<ReadonlySet<Permission>> = computed(
    () => new Set(this.permissions()),
  );

  /** The same fallback as `role`, and for the same window. */
  readonly permissions: Signal<readonly Permission[]> = computed(
    () =>
      this.currentUser()?.permissions ??
      (this.initialising() ? (this.sessionHint()?.permissions ?? []) : []),
  );

  /**
   * In-flight refresh, shared so N concurrent 401s trigger one network call.
   * Without this, each queued request would rotate the refresh token in turn and
   * every rotation after the first would look like token reuse — which the server
   * responds to by revoking the whole session.
   */
  private refreshInFlight: Observable<string | null> | null = null;

  login(credentials: LoginRequest): Observable<AuthUser> {
    return this.http
      .post<ApiSuccessResponse<LoginResponse>>(ApiEndpoints.auth.login, credentials, {
        // The login form shows failures inline, beside the fields; a snackbar
        // saying the same thing is noise.
        context: skipErrorNotification(),
      })
      .pipe(
        map((response) => response.data),
        tap((data) => {
          this.tokenStorage.set(data.accessToken, data.expiresAt);
          this.currentUser.set(data.user);
          this.rememberSession(data.user);
        }),
        map((data) => data.user),
      );
  }

  /**
   * Clears the session.
   *
   * Local state is cleared regardless of whether the server call succeeds: a user
   * who clicked "sign out" must end up signed out even with no network. The
   * server call revokes the refresh token and clears the cookie.
   */
  logout(redirect = true): void {
    this.http
      .post<unknown>(ApiEndpoints.auth.logout, {}, { context: skipErrorNotification() })
      .pipe(catchError(() => of(null)))
      .subscribe(() => {
        if (redirect) {
          void this.router.navigate([AppRoutes.login]);
        }
      });

    // Cleared immediately rather than in the callback, so the UI reflects the
    // sign-out at once instead of after a round trip.
    this.clearSession();
  }

  /**
   * Restores the session on app start using the httpOnly refresh cookie.
   *
   * Runs as an app initializer so guards never evaluate against empty state and
   * bounce an already-authenticated user to the login page on reload.
   */
  restoreSession(): Observable<boolean> {
    return this.refreshAccessToken(COLD_START_TIMEOUT_MS).pipe(
      switchMap((token) => {
        if (token === null) {
          return of(false);
        }
        // A fresh token is useless without the user it belongs to: after a reload
        // the in-memory user is gone, so fetch it before the first route resolves.
        return this.loadCurrentUser().pipe(map((user) => user !== null));
      }),
      catchError(() => of(false)),
      finalize(() => this.initialising.set(false)),
    );
  }

  /** Fetches the current user and their permissions. */
  loadCurrentUser(): Observable<AuthUser | null> {
    return this.http
      .get<ApiSuccessResponse<AuthUser>>(ApiEndpoints.auth.me, {
        // Restoring a session is background work — see the note on the refresh above.
        context: skipLoading(skipErrorNotification()),
      })
      .pipe(
        map((response) => response.data),
        tap((user) => {
          this.currentUser.set(user);
          // Re-stamped on every restore, so a role or permission changed on the server is reflected
          // in the hint the *next* cold start renders from.
          this.rememberSession(user);
        }),
        catchError(() => {
          this.clearSession();
          return of(null);
        }),
      );
  }

  /**
   * Exchanges the refresh cookie for a new access token.
   *
   * The `refreshInFlight` latch plus `shareReplay` collapses concurrent callers
   * onto one request; the latch is released in `finalize` so a later refresh can
   * start cleanly.
   */
  refreshAccessToken(deadlineMs?: number): Observable<string | null> {
    if (this.refreshInFlight !== null) {
      return this.refreshInFlight;
    }

    /*
     * The boot call passes its own deadline, and it has to.
     *
     * The app-wide 30s timeout is right for a refresh triggered by a 401 mid-shift: the API is
     * awake, so a request that slow has failed. It is wrong for the *first* refresh after the
     * service has been asleep, which is the one request that has to wait out a cold start of about
     * a minute. Cut off at 30s it takes the session down with it, and the cashier — who was signed
     * in — is asked to sign in again against an API that is still starting.
     */
    const context =
      deadlineMs === undefined
        ? skipErrorNotification()
        : /*
           * The boot call is also kept off the global progress bar.
           *
           * It runs for as long as the cold start does — up to the deadline above — and the bar is
           * a *foreground* signal: a magenta line across the top and a "Still working…" toast, for
           * a minute, over a POS the cashier is already using. The screens that depend on the API
           * say so themselves, where the person is looking; a page-wide alarm for a request nobody
           * is waiting on is the wrong instrument.
           */
          withTimeout(deadlineMs, skipLoading(skipErrorNotification()));

    this.refreshInFlight = this.http
      .post<ApiSuccessResponse<RefreshResponse>>(
        ApiEndpoints.auth.refresh,
        {},
        {
          // A failed refresh is a normal outcome — an anonymous visitor has no
          // cookie. Without this, every first-time visitor gets an error toast.
          context,
        },
      )
      .pipe(
        map((response) => response.data),
        tap((data) => this.tokenStorage.set(data.accessToken, data.expiresAt)),
        map((data) => data.accessToken),
        catchError(() => {
          this.clearSession();
          return of(null);
        }),
        finalize(() => {
          this.refreshInFlight = null;
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );

    return this.refreshInFlight;
  }

  /**
   * Changes the password. The server revokes every session on success, so the
   * caller must sign in again — hence the local clear.
   */
  changePassword(request: ChangePasswordRequest): Observable<void> {
    return this.http
      .post<void>(ApiEndpoints.auth.changePassword, request, {
        context: skipErrorNotification(),
      })
      .pipe(
        map(() => undefined),
        tap(() => this.clearSession()),
      );
  }

  // --- Authorization checks -------------------------------------------------
  //
  // These drive what the UI offers. They are NOT a security boundary: the bundle
  // ships to the browser, so every guarded action is authorised again server-side.

  /** True when the user holds `permission`. Prefer this over role checks. */
  can(permission: Permission): boolean {
    return this.permissionSet().has(permission);
  }

  canAny(permissions: readonly Permission[]): boolean {
    const granted = this.permissionSet();
    return permissions.some((permission) => granted.has(permission));
  }

  canAll(permissions: readonly Permission[]): boolean {
    const granted = this.permissionSet();
    return permissions.every((permission) => granted.has(permission));
  }

  hasRole(role: Role): boolean {
    return this.currentUser()?.role === role;
  }

  hasAnyRole(roles: readonly Role[]): boolean {
    const current = this.currentUser()?.role;
    return current !== undefined && roles.includes(current);
  }

  isAtLeast(role: Role): boolean {
    const current = this.currentUser()?.role;
    return current !== undefined && hasAtLeastRole(current, role);
  }

  private rememberSession(user: AuthUser): void {
    const hint: SessionHint = { role: user.role, permissions: user.permissions };
    this.sessionHint.set(hint);
    this.storage.set(StorageKeys.sessionHint, hint);
  }

  private clearSession(): void {
    this.tokenStorage.clear();
    this.currentUser.set(null);

    /*
     * The hint goes with the session, including when the session is ended *for* us — an expired
     * refresh cookie, a revoked token. Leaving it behind would make the guard hold the door open on
     * every future load for a session that no longer exists, and the reward for that patience would
     * be a redirect to the login page one round trip later instead of immediately.
     */
    this.sessionHint.set(null);
    this.storage.remove(StorageKeys.sessionHint);
  }
}
