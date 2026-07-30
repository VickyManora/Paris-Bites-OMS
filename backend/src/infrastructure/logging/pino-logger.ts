import { pino, type Logger as PinoInstance } from 'pino';
import type { ILogger, LogContext } from '../../core/application/ports/logger.port.js';
import { env, isProduction } from '../../config/env.js';

/**
 * Fields that must never reach the log sink. Pino redacts these by path, so a
 * careless `logger.info('login', req.body)` cannot leak a password.
 */
const REDACTED_PATHS = [
  'password',
  'confirmPassword',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.passwordHash',
];

export function createPinoInstance(): PinoInstance {
  return pino({
    level: env.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
    // Structured JSON in production for log aggregation; human-readable locally.
    ...(isProduction
      ? {}
      : { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: false } } }),
  });
}

/** Adapter mapping the domain's `ILogger` port onto pino. */
export class PinoLogger implements ILogger {
  constructor(private readonly instance: PinoInstance) {}

  debug(message: string, context?: LogContext): void {
    this.instance.debug(context ?? {}, message);
  }

  info(message: string, context?: LogContext): void {
    this.instance.info(context ?? {}, message);
  }

  warn(message: string, context?: LogContext): void {
    this.instance.warn(context ?? {}, message);
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    this.instance.error({ ...context, err: error }, message);
  }

  child(context: LogContext): ILogger {
    return new PinoLogger(this.instance.child(context));
  }
}
