import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';
import type { LogLevel } from '../../../environments/environment.model';

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

/**
 * Level-filtered console logging.
 *
 * Going through a service rather than calling `console` directly means
 * production builds stay quiet (level `warn`), and swapping in a remote sink
 * such as Sentry is a change to this one class.
 */
@Injectable({ providedIn: 'root' })
export class LoggerService {
  private readonly threshold = LEVEL_RANK[environment.logLevel];

  debug(message: string, ...context: readonly unknown[]): void {
    if (this.enabled('debug')) {
      console.debug(`[debug] ${message}`, ...context);
    }
  }

  info(message: string, ...context: readonly unknown[]): void {
    if (this.enabled('info')) {
      console.info(`[info] ${message}`, ...context);
    }
  }

  warn(message: string, ...context: readonly unknown[]): void {
    if (this.enabled('warn')) {
      console.warn(`[warn] ${message}`, ...context);
    }
  }

  error(message: string, ...context: readonly unknown[]): void {
    if (this.enabled('error')) {
      console.error(`[error] ${message}`, ...context);
    }
  }

  private enabled(level: LogLevel): boolean {
    return LEVEL_RANK[level] >= this.threshold;
  }
}
