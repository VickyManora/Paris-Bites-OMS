/** UI-wide values that are not configuration and not feature-specific. */

export const AppRoutes = {
  root: '/',
  login: '/auth/login',
  profile: '/account/profile',
  changePassword: '/account/password',
  dashboard: '/dashboard',
  forbidden: '/forbidden',
  notFound: '/not-found',
} as const;

/**
 * Header the API's `requireFetchIntent` middleware checks on
 * cookie-authenticated routes. Must match `REQUESTED_WITH_*` in
 * `backend/src/config/constants.ts`.
 */
export const REQUESTED_WITH_HEADER = 'X-Requested-With';
export const REQUESTED_WITH_VALUE = 'paris-bites-web';

export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50, 100];

/** Debounce for search-as-you-type inputs, in milliseconds. */
export const SEARCH_DEBOUNCE_MS = 300;

export const SNACKBAR_DURATION_MS = {
  success: 3000,
  info: 4000,
  /** Errors stay longer — the user needs time to read what went wrong. */
  error: 6000,
} as const;

/**
 * How long before expiry to proactively refresh the access token. Refreshing
 * early avoids a user-visible 401 round trip mid-action.
 */
export const TOKEN_REFRESH_LEEWAY_MS = 60_000;
