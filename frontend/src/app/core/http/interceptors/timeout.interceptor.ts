import { HttpContext, HttpContextToken, type HttpInterceptorFn } from '@angular/common/http';
import { timeout } from 'rxjs';
import { environment } from '../../../../environments/environment';

/**
 * Per-request timeout override, in milliseconds.
 *
 * `0` disables the timeout entirely — for a long report build or a file download, where the
 * request is *expected* to take a while and cutting it off would be the bug.
 */
export const REQUEST_TIMEOUT_MS = new HttpContextToken<number | null>(() => null);

/**
 * Builds a context that gives one request its own deadline:
 *
 * ```ts
 * this.api.post(url, body, { context: withTimeout(45_000) });
 * ```
 *
 * Pass an existing context to add the deadline without discarding other tokens.
 */
export function withTimeout(ms: number, context: HttpContext = new HttpContext()): HttpContext {
  return context.set(REQUEST_TIMEOUT_MS, ms);
}

/**
 * Fails a request that never comes back.
 *
 * Without this a request on a dead mobile connection hangs until the browser gives up, which
 * can be well over a minute — and for that whole time the POS shows a disabled button and no
 * explanation. A bounded deadline is what turns "the app is frozen" into "that didn't send,
 * try again", and it is what makes the retry and offline handling elsewhere reachable at all.
 *
 * Innermost in the chain on purpose, so the deadline applies to **each attempt** rather than to
 * the whole retry sequence. Placed outside `retry`, three retries of a 30-second timeout would
 * share one 30-second budget and the later attempts would be cut off before they were sent.
 *
 * `environment.requestTimeoutMs` is the default; `withTimeout()` overrides it per request.
 */
export const timeoutInterceptor: HttpInterceptorFn = (req, next) => {
  const override = req.context.get(REQUEST_TIMEOUT_MS);
  const ms = override ?? environment.requestTimeoutMs;

  // A non-positive budget means "no deadline" rather than "expire immediately", which is the
  // only reading that makes `withTimeout(0)` a usable opt-out.
  if (ms <= 0) {
    return next(req);
  }

  return next(req).pipe(timeout({ each: ms }));
};
