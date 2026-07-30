/**
 * Every API path the app calls, in one place.
 *
 * Paths are relative — `apiUrlInterceptor` prefixes `environment.apiBaseUrl`.
 * Centralising them means a renamed backend route is a one-line change here
 * rather than a grep across feature services.
 */
export const ApiEndpoints = {
  auth: {
    login: '/auth/login',
    logout: '/auth/logout',
    refresh: '/auth/refresh',
    me: '/auth/me',
    changePassword: '/auth/change-password',
  },

  users: {
    root: '/users',
    byId: (id: string): string => `/users/${id}`,
  },

  health: {
    live: '/health/live',
    ready: '/health/ready',
  },

  // Inventory endpoints are added here alongside their features, e.g.
  //   products: { root: '/products', byId: (id: string) => `/products/${id}` },
} as const;
