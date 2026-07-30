import { Router } from 'express';
import type { AppContainer } from '../../../infrastructure/container/container.js';
import { checkDatabaseConnection } from '../../../infrastructure/database/prisma.client.js';
import { asyncHandler } from '../../../shared/async-handler.js';
import { HttpStatus } from '../../../shared/http-status.js';
import { sendError, sendSuccess } from '../serializers/response.serializer.js';

/**
 * Liveness and readiness probes.
 *
 * The two are separate on purpose: Railway should restart the container only
 * when the *process* is wedged (liveness), not when Postgres is briefly
 * unreachable (readiness). Conflating them turns a database blip into a restart
 * loop.
 */
export function healthRoutes(container: AppContainer): Router {
  const router = Router();

  // Liveness — process is up. Must not touch dependencies.
  router.get('/live', (_req, res) => {
    sendSuccess(res, { status: 'ok', uptime: process.uptime() });
  });

  // Readiness — safe to route traffic here.
  router.get(
    '/ready',
    asyncHandler(async (_req, res) => {
      try {
        await checkDatabaseConnection();
        sendSuccess(res, { status: 'ok', database: 'connected' });
      } catch (error) {
        container.logger.error('Readiness probe failed', error);
        sendError(
          res,
          HttpStatus.SERVICE_UNAVAILABLE,
          'NOT_READY',
          'The service is not ready to accept traffic.',
        );
      }
    }),
  );

  return router;
}
