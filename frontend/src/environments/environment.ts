import type { AppEnvironment } from './environment.model';

/**
 * Production configuration. Selected by the `production` build via the
 * `fileReplacements` entry in angular.json.
 *
 * Angular builds are static bundles, so everything here is baked in at compile
 * time and is publicly readable. Never put a secret in this file — API keys and
 * credentials belong to the backend only.
 */
export const environment: AppEnvironment = {
  production: true,
  apiBaseUrl: 'https://paris-bites-api.up.railway.app/api/v1',
  appName: 'Paris Bites',
  /** Warn level and above — debug logging would leak internals to the console. */
  logLevel: 'warn',
  enableDevTools: false,
  requestTimeoutMs: 30_000,
  /** Retry idempotent requests that fail on transient network/5xx errors. */
  httpRetryCount: 2,
};
