import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { retry, throwError, TimeoutError, timer } from 'rxjs';
import { environment } from '../../../../environments/environment';

/** Status codes worth retrying: transport failure, or a server saying "later". */
const RETRYABLE_STATUSES: readonly number[] = [0, 408, 429, 500, 502, 503, 504];

/**
 * Only idempotent methods are retried. Replaying a POST could create a duplicate
 * record — a stock movement counted twice is worse than a visible error.
 */
const IDEMPOTENT_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Retries transient failures with exponential backoff and jitter.
 *
 * Backoff prevents hammering a struggling server; the random jitter prevents many
 * clients that failed together from retrying in lockstep and re-creating the
 * spike. Disabled in development (`httpRetryCount: 0`) so failures are immediate
 * and obvious while debugging.
 */
export const retryInterceptor: HttpInterceptorFn = (req, next) => {
  const maxRetries = environment.httpRetryCount;

  if (maxRetries <= 0 || !IDEMPOTENT_METHODS.includes(req.method.toUpperCase())) {
    return next(req);
  }

  return next(req).pipe(
    retry({
      count: maxRetries,
      delay: (error: unknown, retryCount: number) => {
        /*
         * A timeout counts.
         *
         * `timeoutInterceptor` sits below this one, so a request that outran its deadline
         * arrives here as an rxjs `TimeoutError` rather than a response. On a slow mobile
         * connection that is the *typical* transient failure, and excluding it would leave
         * retry handling covering only the cases that barely happen.
         */
        const isRetryable =
          error instanceof TimeoutError ||
          (error instanceof HttpErrorResponse && RETRYABLE_STATUSES.includes(error.status));

        if (!isRetryable) {
          return throwError(() => error);
        }

        // 300ms, 600ms, 1200ms ... plus up to 200ms of jitter.
        const backoff = 300 * 2 ** (retryCount - 1);
        return timer(backoff + Math.random() * 200);
      },
    }),
  );
};
