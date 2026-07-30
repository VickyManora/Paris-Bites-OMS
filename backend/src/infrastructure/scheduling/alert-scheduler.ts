import type { ILogger } from '../../core/application/ports/logger.port.js';
import type { StockAlertScanner } from '../../core/application/use-cases/notifications/stock-alert-scanner.js';

/**
 * Delay before the first sweep.
 *
 * The process has just started and is being probed for readiness; a burst of inventory
 * queries in that window competes with the traffic that decides whether the deploy is
 * healthy. Half a minute is long enough to be out of the way and short enough that a
 * developer who starts the server to look at alerts does not think it is broken.
 */
const INITIAL_DELAY_MS = 30_000;

/**
 * Runs the stock alert sweep on a timer.
 *
 * Thin on purpose. It owns *when* the sweep runs and nothing about what it does, so the
 * scanner stays a plain object that a test can call directly with a fixed clock.
 *
 * Three properties this has to get right, all of them about shutdown and overlap:
 *
 * - **The timers are `unref`'d.** A pending interval otherwise keeps the event loop alive
 *   and the process never exits — the classic reason a container hangs until its kill
 *   timeout on every deploy.
 * - **Sweeps cannot overlap.** `setInterval` does not wait for an async callback, so a
 *   sweep slower than the interval would have a second one start on top of it, and the
 *   two would see the same un-alerted items and both send. A running flag serialises them.
 * - **`stop()` is idempotent**, because shutdown can be triggered by two signals at once.
 *
 * A zero interval disables it, which is the correct setting for every instance but one:
 * two processes sweeping concurrently is the same double-send race as overlapping sweeps,
 * and this class cannot see across processes.
 */
export class AlertScheduler {
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly scanner: StockAlertScanner,
    private readonly logger: ILogger,
    private readonly intervalMinutes: number,
  ) {}

  start(): void {
    if (this.intervalMinutes <= 0) {
      this.logger.info('Stock alert sweep disabled', { intervalMinutes: this.intervalMinutes });
      return;
    }

    const intervalMs = this.intervalMinutes * 60_000;

    this.initialTimer = setTimeout(() => {
      void this.sweep();

      this.timer = setInterval(() => void this.sweep(), intervalMs);
      this.timer.unref();
    }, INITIAL_DELAY_MS);

    this.initialTimer.unref();

    this.logger.info('Stock alert sweep scheduled', {
      intervalMinutes: this.intervalMinutes,
      firstRunInSeconds: INITIAL_DELAY_MS / 1000,
    });
  }

  stop(): void {
    this.stopped = true;

    if (this.initialTimer !== null) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One guarded sweep.
   *
   * The scanner already swallows its own failures; the try/catch here is a second net for
   * anything thrown before it gets that far, because an unhandled rejection from a timer
   * callback takes the process down through the handler in `main.ts`.
   */
  private async sweep(): Promise<void> {
    if (this.running || this.stopped) {
      return;
    }

    this.running = true;

    try {
      const result = await this.scanner.scan();

      if (result.notificationsWritten > 0) {
        this.logger.info('Stock alerts sent', {
          lowStockItems: result.lowStockItems,
          expiringItems: result.expiringItems,
          notificationsWritten: result.notificationsWritten,
          deferred: result.deferred,
        });
      }
    } catch (error) {
      this.logger.error('Stock alert sweep threw unexpectedly', error);
    } finally {
      this.running = false;
    }
  }
}
