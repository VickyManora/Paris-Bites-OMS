/**
 * Namespaced keys for browser storage.
 *
 * The `pb.` prefix prevents collisions with anything else served from the same
 * origin, and makes it possible to clear only this app's state.
 */
export const StorageKeys = {
  /** In-memory by default — see `TokenStorageService` for the rationale. */
  accessToken: 'pb.auth.access_token',
  theme: 'pb.ui.theme',
  sidebarCollapsed: 'pb.ui.sidebar_collapsed',
  /** Row density for every `pb-data-table`. One preference, not one per screen. */
  tableDensity: 'pb.ui.table_density',

  /*
   * The two keys that exist so the counter works before the API answers.
   *
   * `posMenu` is the last menu the API returned — see `PosMenuCacheService` for why this one API
   * response is cached when no other is. `sessionHint` is not a credential and cannot be used as
   * one: it records only that this browser had a session and who it belonged to, so a reload during
   * a cold start renders the app the cashier was already signed into instead of the login form.
   */
  posMenu: 'pb.pos.menu',
  sessionHint: 'pb.auth.session_hint',
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];
