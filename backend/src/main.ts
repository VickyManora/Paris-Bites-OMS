import type { Server } from 'node:http';
import { createApp } from './app.js';
import { API_BASE_PATH, SHUTDOWN_TIMEOUT_MS } from './config/constants.js';
import { env } from './config/env.js';
import { createContainer } from './infrastructure/container/container.js';
import { disconnectDatabase, poolSize } from './infrastructure/database/prisma.client.js';
import { AlertScheduler } from './infrastructure/scheduling/alert-scheduler.js';

/**
 * Process entrypoint: builds the dependency graph, starts listening, and owns
 * the shutdown lifecycle. Nothing else in the codebase touches the socket.
 */
function bootstrap(): void {
  const container = createContainer();
  const logger = container.logger;
  const app = createApp(container);

  /*
   * Low-stock and expiry alerts. Started after `createApp` so a failure building the
   * routes surfaces before a timer exists to clean up, and stopped in `shutdown` so a
   * sweep cannot begin while the database is being disconnected.
   */
  const alerts = new AlertScheduler(
    container.stockAlertScanner,
    logger,
    env.ALERT_SCAN_INTERVAL_MINUTES,
  );
  alerts.start();

  const server: Server = app.listen(env.PORT, () => {
    logger.info('API started', {
      port: env.PORT,
      environment: env.NODE_ENV,
      basePath: API_BASE_PATH,
      // Surfaced because 1 is the development default and it serialises every query.
      // A silent pool of 1 would look like a mysterious latency problem later.
      databasePoolMax: poolSize(),
    });
  });

  /**
   * Graceful shutdown. Railway sends SIGTERM before replacing a container, so
   * draining in-flight requests here is the difference between a clean deploy
   * and dropped responses. The timer is a backstop for requests that hang.
   */
  let shuttingDown = false;

  async function releaseResources(): Promise<never> {
    try {
      await disconnectDatabase();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error while disconnecting the database', error);
      process.exit(1);
    }
  }

  function shutdown(signal: string): void {
    // Repeated signals (an impatient Ctrl-C) must not start a second drain.
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info('Shutdown signal received, draining connections', { signal });

    // Before draining: a sweep starting now would issue queries into a closing pool.
    alerts.stop();

    const forceExit = setTimeout(() => {
      logger.error('Shutdown timed out, forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    // Do not let this timer hold the event loop open once draining finishes.
    forceExit.unref();

    server.close((error) => {
      if (error) {
        logger.error('Error while closing the HTTP server', error);
      }

      // `void` rather than an async callback: `server.close` ignores a returned
      // promise, so a rejection inside it would be an unhandled rejection.
      // `releaseResources` handles its own failure and never resolves normally.
      void releaseResources();
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  /**
   * An unhandled rejection or uncaught exception leaves the process in an
   * unknown state; the only safe response is to log loudly and let the platform
   * restart a clean one.
   */
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason);
    shutdown('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    shutdown('uncaughtException');
  });
}

try {
  bootstrap();
} catch (error: unknown) {
  // The logger may not exist yet, so fail loudly on stderr.
  process.stderr.write(`Failed to start the API: ${String(error)}\n`);
  process.exit(1);
}
