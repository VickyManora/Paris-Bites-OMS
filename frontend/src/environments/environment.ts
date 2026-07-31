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
  /*
   * Baked in at build time, which is why this is code and not a platform setting.
   *
   * Angular compiles this file into the bundle, so Vercel cannot supply it as an environment
   * variable — changing the API host means a commit and a redeploy. Worth knowing before hunting
   * for a dashboard field that does not exist.
   *
   * The `/api/v1` suffix is part of it: `apiUrlInterceptor` prefixes every relative request with
   * this string verbatim, so dropping the version turns every call into a 404.
   */
  apiBaseUrl: 'https://paris-bites-api.onrender.com/api/v1',
  appName: 'Paris Bites',
  /** Warn level and above — debug logging would leak internals to the console. */
  logLevel: 'warn',
  enableDevTools: false,
  requestTimeoutMs: 30_000,
  /** Retry idempotent requests that fail on transient network/5xx errors. */
  httpRetryCount: 2,
};
