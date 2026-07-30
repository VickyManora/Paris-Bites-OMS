import type { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { REQUESTED_WITH_HEADER, REQUESTED_WITH_VALUE } from '../../constants/app.constants';

/**
 * Prefixes relative URLs with the configured API base.
 *
 * Lets services reference `ApiEndpoints.users.root` rather than repeating the
 * host, so switching environments is a config change. Absolute URLs pass through
 * untouched, which keeps third-party calls and asset requests working.
 */
export const apiUrlInterceptor: HttpInterceptorFn = (req, next) => {
  const isAbsolute = /^https?:\/\//i.test(req.url);

  if (isAbsolute) {
    return next(req);
  }

  const base = environment.apiBaseUrl.replace(/\/+$/, '');
  const path = req.url.startsWith('/') ? req.url : `/${req.url}`;

  return next(
    req.clone({
      url: `${base}${path}`,
      // Required for the httpOnly refresh cookie to travel cross-origin
      // (Vercel frontend, Railway API).
      withCredentials: true,
      /*
       * CSRF marker for the cookie-authenticated endpoints.
       *
       * A non-safelisted header forces the browser to preflight cross-origin
       * requests, and the API only approves origins on its allowlist. A `<form>`
       * or `<img>` on a hostile page cannot set headers, so it can never forge a
       * call to /auth/refresh or /auth/logout.
       *
       * Set on every request rather than just those two, so the API can adopt the
       * same protection elsewhere without a client change.
       */
      setHeaders: { [REQUESTED_WITH_HEADER]: REQUESTED_WITH_VALUE },
    }),
  );
};
