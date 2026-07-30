import { HttpContext, HttpContextToken, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AppRoutes } from '../../constants/app.constants';
import { toAppError } from '../../errors/app-error';
import { LoggerService } from '../../services/logger.service';
import { NotificationService } from '../../services/notification.service';

/**
 * Opt-out for requests that handle their own failures — a login form showing
 * "invalid credentials" inline does not also want a snackbar.
 */
export const SKIP_ERROR_NOTIFICATION = new HttpContextToken<boolean>(() => false);

export function skipErrorNotification(context: HttpContext = new HttpContext()): HttpContext {
  return context.set(SKIP_ERROR_NOTIFICATION, true);
}

/**
 * Converts every HTTP failure into an `AppError`, notifies the user, and logs it.
 *
 * Centralising this means no feature has to remember error handling, and the
 * error a component receives is always the same normalised type.
 *
 * The error is still re-thrown: this interceptor decides how a failure is
 * *reported*, not whether the caller gets to react to it.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notifications = inject(NotificationService);
  const logger = inject(LoggerService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((raw: unknown) => {
      const error = toAppError(raw);

      logger.error(`${req.method} ${req.url} failed`, {
        code: error.code,
        status: error.status,
        requestId: error.requestId,
      });

      // A 403 means the user is signed in but not permitted; send them to a page
      // that says so rather than leaving a dead-end blank view.
      if (error.isForbidden) {
        void router.navigate([AppRoutes.forbidden]);
      }

      // 401s are handled by `authInterceptor` (refresh and replay). One that
      // reaches here means refresh already failed, so stay quiet and let the
      // guard redirect — a "session expired" toast on every queued request would
      // stack up.
      const suppress = req.context.get(SKIP_ERROR_NOTIFICATION) || error.isUnauthorized;

      if (!suppress) {
        notifications.fromError(error);
      }

      return throwError(() => error);
    }),
  );
};
