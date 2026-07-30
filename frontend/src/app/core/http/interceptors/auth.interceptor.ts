import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { ApiEndpoints } from '../../constants/api-endpoints';
import { AuthService } from '../../auth/services/auth.service';
import { TokenStorageService } from '../../auth/services/token-storage.service';

/** Endpoints that must never carry a token or trigger a refresh loop. */
const AUTH_EXEMPT_PATHS: readonly string[] = [
  ApiEndpoints.auth.login,
  ApiEndpoints.auth.refresh,
  ApiEndpoints.auth.logout,
];

function isExempt(url: string): boolean {
  return AUTH_EXEMPT_PATHS.some((path) => url.includes(path));
}

/**
 * Attaches the bearer token, and transparently recovers from expiry.
 *
 * On a 401 it refreshes once and replays the original request, so a token
 * expiring mid-session is invisible to the user rather than an error toast.
 *
 * Two safeguards prevent an infinite loop: auth endpoints are exempt (a failing
 * refresh cannot trigger another refresh), and a request already retried is not
 * retried again. `AuthService.refreshAccessToken` collapses concurrent callers
 * onto one network call.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const tokenStorage = inject(TokenStorageService);
  const auth = inject(AuthService);

  if (isExempt(req.url)) {
    return next(req);
  }

  const token = tokenStorage.accessToken();
  const authorised =
    token === null ? req : req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

  return next(authorised).pipe(
    catchError((error: unknown) => {
      const isAuthFailure = error instanceof HttpErrorResponse && error.status === 401;

      if (!isAuthFailure) {
        return throwError(() => error);
      }

      return auth.refreshAccessToken().pipe(
        switchMap((newToken) => {
          // Refresh failed — the session is genuinely over. `refreshAccessToken`
          // has already cleared local state; surface the original 401 so the
          // guard redirects rather than the app retrying forever.
          if (newToken === null) {
            return throwError(() => error);
          }

          return next(req.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } }));
        }),
      );
    }),
  );
};
