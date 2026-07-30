import { HttpContext, HttpContextToken, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs';
import { LoadingService } from '../../services/loading.service';

/**
 * Opt-out flag for requests that should not show the global progress bar —
 * typeahead lookups, polling, background refreshes.
 *
 * `HttpContext` rather than a custom header: it stays client-side instead of
 * being sent to the server, and it is typed.
 */
export const SKIP_LOADING = new HttpContextToken<boolean>(() => false);

/**
 * Builds a context that suppresses the progress bar for one request:
 *
 * ```ts
 * this.http.get(url, { context: skipLoading() });
 * ```
 *
 * Pass an existing context to add the flag without discarding other tokens.
 */
export function skipLoading(context: HttpContext = new HttpContext()): HttpContext {
  return context.set(SKIP_LOADING, true);
}

/**
 * Counts in-flight requests so a single indicator reflects network activity.
 *
 * `finalize` is what guarantees the counter is decremented on success, error and
 * cancellation alike — anything less leaks a permanently visible progress bar.
 */
export const loadingInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.context.get(SKIP_LOADING)) {
    return next(req);
  }

  const loading = inject(LoadingService);
  loading.start();

  return next(req).pipe(finalize(() => loading.stop()));
};
