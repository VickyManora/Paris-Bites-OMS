import type { CookieOptions, Request, Response } from 'express';
import { API_BASE_PATH, REFRESH_TOKEN_COOKIE } from '../../../config/constants.js';
import { cookieOptions } from '../../../config/env.js';

/**
 * The refresh-token cookie is the only browser-persisted credential in the
 * system, so its attributes are defined once, here, rather than at each call site.
 *
 * - `httpOnly`  — JavaScript cannot read it, so an XSS payload cannot steal it.
 *                 This is the whole reason the refresh token lives in a cookie
 *                 while the access token stays in memory.
 * - `secure`    — HTTPS only in production.
 * - `sameSite`  — `none` in production, `lax` locally. See `requireFetchIntent` for how the
 *                 resulting CSRF exposure is closed, and `COOKIE_SAME_SITE` in `env.ts` for why
 *                 `none` is no longer strictly required now that Vercel proxies `/api/*` to the
 *                 API and the browser sees a single origin.
 * - `path`      — scoped to the auth routes, so it is not attached to every
 *                 unrelated API request.
 */
function buildOptions(expiresAt?: Date): CookieOptions {
  const options: CookieOptions = {
    httpOnly: true,
    secure: cookieOptions.secure,
    sameSite: cookieOptions.sameSite,
    path: `${API_BASE_PATH}/auth`,
  };

  if (cookieOptions.domain !== undefined) {
    options.domain = cookieOptions.domain;
  }

  if (expiresAt !== undefined) {
    options.expires = expiresAt;
  }

  return options;
}

export function setRefreshTokenCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_TOKEN_COOKIE, token, buildOptions(expiresAt));
}

/**
 * Clears the cookie. The attributes must match those it was set with (except
 * `expires`), or the browser treats it as a different cookie and leaves the
 * original in place.
 */
export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, buildOptions());
}

export function readRefreshTokenCookie(req: Request): string | undefined {
  // `req.cookies` is typed loosely by cookie-parser, so narrow rather than trust:
  // this value is attacker-controlled and is about to be hashed and looked up.
  const cookies: unknown = req.cookies;

  if (typeof cookies !== 'object' || cookies === null) {
    return undefined;
  }

  const value = (cookies as Record<string, unknown>)[REFRESH_TOKEN_COOKIE];

  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
