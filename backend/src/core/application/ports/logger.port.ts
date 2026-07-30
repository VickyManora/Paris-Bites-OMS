export type LogContext = Readonly<Record<string, unknown>>;

/**
 * Logging port. Use cases log through this interface so the core never imports
 * pino, and tests can assert on log calls with a stub.
 */
export interface ILogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
  /** Returns a logger that stamps `context` onto every subsequent entry. */
  child(context: LogContext): ILogger;
}
