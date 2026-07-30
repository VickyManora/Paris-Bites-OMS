import type { HttpInterceptorFn } from '@angular/common/http';
import { apiUrlInterceptor } from './api-url.interceptor';
import { authInterceptor } from './auth.interceptor';
import { errorInterceptor } from './error.interceptor';
import { loadingInterceptor } from './loading.interceptor';
import { retryInterceptor } from './retry.interceptor';
import { timeoutInterceptor } from './timeout.interceptor';

/**
 * The interceptor chain, in execution order.
 *
 * Order is load-bearing. A request travels down this list and the response comes
 * back up it, so each position is a deliberate choice:
 *
 * 1. `apiUrl`  — must run first; everything below assumes a resolved absolute URL.
 * 2. `loading` — wraps the widest span, so the progress bar covers retries and
 *                token refreshes rather than flickering between them.
 * 3. `error`   — sits ABOVE `auth`, so a 401 that `auth` recovers from never
 *                reaches it. Placed below `auth` instead, every expired token
 *                would produce a spurious error toast.
 * 4. `auth`    — attaches the token; on 401 refreshes once and replays.
 * 5. `retry`   — so backoff applies to the individual attempt and a retried
 *                request still gets a fresh token from `auth` above it.
 * 6. `timeout` — innermost, so the deadline bounds **each attempt** rather than
 *                the whole retry sequence. Above `retry` instead, three attempts
 *                would share one budget and the last would be cut off before it
 *                was even sent. Being innermost also means `retry` sees the
 *                timeout and can treat it as the transient failure it usually is.
 */
export const HTTP_INTERCEPTORS_CHAIN: readonly HttpInterceptorFn[] = [
  apiUrlInterceptor,
  loadingInterceptor,
  errorInterceptor,
  authInterceptor,
  retryInterceptor,
  timeoutInterceptor,
];

export { apiUrlInterceptor } from './api-url.interceptor';
export { authInterceptor } from './auth.interceptor';
export {
  errorInterceptor,
  SKIP_ERROR_NOTIFICATION,
  skipErrorNotification,
} from './error.interceptor';
export { loadingInterceptor, SKIP_LOADING, skipLoading } from './loading.interceptor';
export { retryInterceptor } from './retry.interceptor';
export { REQUEST_TIMEOUT_MS, timeoutInterceptor, withTimeout } from './timeout.interceptor';
