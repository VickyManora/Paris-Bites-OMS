import type { RequestHandler } from 'express';
import { ForbiddenError } from '../../../core/domain/errors/domain-error.js';
import { REQUESTED_WITH_HEADER, REQUESTED_WITH_VALUE } from '../../../config/constants.js';

/**
 * CSRF protection for the cookie-authenticated endpoints (`/auth/refresh`,
 * `/auth/logout`).
 *
 * Those two routes are authenticated by the refresh cookie alone, and in
 * production that cookie is `SameSite=None` — it has to be, because the app and
 * API are on different sites. That combination is exactly what CSRF exploits: any
 * page could POST to `/auth/refresh` and the browser would attach the cookie.
 *
 * The defence is to require a custom request header. A cross-origin request
 * carrying a non-safelisted header triggers a CORS preflight, and the browser
 * refuses to send the actual request unless our server approves the origin — which
 * `app.ts` only does for the configured allowlist. A `<form>` or `<img>` cannot set
 * headers at all, so it can never reach here.
 *
 * This is preferred over a double-submit token because it needs no shared secret,
 * no extra round trip, and no state — the browser's own preflight does the work.
 * The Angular client sets the header in `apiUrlInterceptor`.
 */
export function requireFetchIntent(): RequestHandler {
  return (req, _res, next) => {
    if (req.get(REQUESTED_WITH_HEADER) !== REQUESTED_WITH_VALUE) {
      next(new ForbiddenError('This request must be made by the Paris Bites application.'));
      return;
    }

    next();
  };
}
