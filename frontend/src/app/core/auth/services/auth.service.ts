import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, map, of, shareReplay, switchMap, tap, type Observable } from 'rxjs';
import { ApiEndpoints } from '../../constants/api-endpoints';
import { AppRoutes } from '../../constants/app.constants';
import { skipErrorNotification } from '../../http/interceptors/error.interceptor';
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

/**
 * Authentication state and operations.
 *
 * State is exposed as signals so guards and templates read it synchronously —
 * no `async` pipe, no subscription to leak, and no chance of a guard running
 * against a stale value. Observables are kept only for the HTTP calls themselves,
 * where `retry`/`switchMap`/`shareReplay` are genuinely the right tools.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly tokenStorage = inject(TokenStorageService);

  private readonly currentUser = signal<AuthUser | null>(null);
  /** True until the initial session restore settles. */
  private readonly initialising = signal(true);

  readonly user: Signal<AuthUser | null> = this.currentUser.asReadonly();
  readonly isInitialising: Signal<boolean> = this.initialising.asReadonly();

  readonly isAuthenticated: Signal<boolean> = computed(() => this.currentUser() !== null);
  readonly role: Signal<Role | null> = computed(() => this.currentUser()?.role ?? null);
  readonly displayName: Signal<string> = computed(() => this.currentUser()?.fullName ?? '');

  /**
   * Permissions granted by the server, as a Set for O(1) lookup.
   *
   * `can()` is called from templates, which re-evaluate on every change
   * detection pass, so an array `includes` over 20+ entries per call adds up.
   */
  private readonly permissionSet: Signal<ReadonlySet<Permission>> = computed(
    () => new Set(this.currentUser()?.permissions ?? []),
  );

  readonly permissions: Signal<readonly Permission[]> = computed(
    () => this.currentUser()?.permissions ?? [],
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
    return this.refreshAccessToken().pipe(
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
        context: skipErrorNotification(),
      })
      .pipe(
        map((response) => response.data),
        tap((user) => this.currentUser.set(user)),
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
  refreshAccessToken(): Observable<string | null> {
    if (this.refreshInFlight !== null) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.http
      .post<ApiSuccessResponse<RefreshResponse>>(
        ApiEndpoints.auth.refresh,
        {},
        {
          // A failed refresh is a normal outcome — an anonymous visitor has no
          // cookie. Without this, every first-time visitor gets an error toast.
          context: skipErrorNotification(),
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

  private clearSession(): void {
    this.tokenStorage.clear();
    this.currentUser.set(null);
  }
}
