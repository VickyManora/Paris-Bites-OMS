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
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];
