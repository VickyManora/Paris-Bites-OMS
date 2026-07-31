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
   * Deliberately a *relative* path, not the API's own host.
   *
   * `vercel.json` rewrites `/api/*` to the Render service, so every request leaves the browser
   * addressed to the same origin as the app. That is the only reason a page reload keeps the
   * user signed in: the access token is held in memory (see `TokenStorageService`), so surviving
   * a reload depends entirely on the httpOnly refresh cookie — and pointing straight at
   * `onrender.com` made that cookie **third-party**. Mobile Safari blocks third-party cookies
   * outright and Chrome's Tracking Protection does too, so the phone refused to store it and
   * every refresh landed back on the login screen. Desktop Chrome still allows them, which is
   * why this only showed up on mobile.
   *
   * Behind the proxy the cookie is first-party, so it is stored everywhere, and the API is
   * same-origin, so CORS stops being involved in normal traffic at all.
   *
   * Changing the API host is therefore an edit to `vercel.json`, not to this file. The `/api/v1`
   * prefix must stay: `apiUrlInterceptor` prepends this string verbatim, so dropping the version
   * turns every call into a 404.
   */
  apiBaseUrl: '/api/v1',
  appName: 'Paris Bites',
  /** Warn level and above — debug logging would leak internals to the console. */
  logLevel: 'warn',
  enableDevTools: false,
  requestTimeoutMs: 30_000,
  /** Retry idempotent requests that fail on transient network/5xx errors. */
  httpRetryCount: 2,
};
