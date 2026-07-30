import type { AppEnvironment } from './environment.model';

/** Local development configuration. This is the default for `ng serve`. */
export const environment: AppEnvironment = {
  production: false,
  apiBaseUrl: 'http://localhost:4000/api/v1',
  appName: 'Paris Bites (dev)',
  logLevel: 'debug',
  enableDevTools: true,
  requestTimeoutMs: 30_000,
  httpRetryCount: 0,
};
