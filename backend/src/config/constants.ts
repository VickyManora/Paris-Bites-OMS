/** Values that are part of the API contract rather than the deployment. */

export const API_PREFIX = '/api';
export const API_VERSION = 'v1';
export const API_BASE_PATH = `${API_PREFIX}/${API_VERSION}` as const;

/** Request body ceiling. Raise per-route rather than globally for uploads. */
export const JSON_BODY_LIMIT = '100kb';

/** Header carrying the correlation id echoed back on every response. */
export const REQUEST_ID_HEADER = 'x-request-id';

export const PAGINATION = {
  defaultPage: 1,
  defaultPageSize: 25,
  maxPageSize: 100,
} as const;

/** Name of the httpOnly cookie holding the refresh token. */
export const REFRESH_TOKEN_COOKIE = 'pb_refresh_token';

/**
 * Custom header the Angular client sends on cookie-authenticated requests.
 *
 * Its only job is to be non-safelisted, which forces a CORS preflight the browser
 * enforces against our origin allowlist. See `requireFetchIntent`.
 */
export const REQUESTED_WITH_HEADER = 'x-requested-with';
export const REQUESTED_WITH_VALUE = 'paris-bites-web';

/** Graceful shutdown budget before in-flight requests are abandoned. */
export const SHUTDOWN_TIMEOUT_MS = 10_000;
