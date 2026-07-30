export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Shared contract for every environment file.
 *
 * Typing the shape here means adding a key to one environment and forgetting the
 * other is a compile error, not a runtime `undefined` discovered in production.
 */
export interface AppEnvironment {
  readonly production: boolean;
  /** Fully qualified API root, including the version segment. No trailing slash. */
  readonly apiBaseUrl: string;
  readonly appName: string;
  readonly logLevel: LogLevel;
  readonly enableDevTools: boolean;
  readonly requestTimeoutMs: number;
  readonly httpRetryCount: number;
}
