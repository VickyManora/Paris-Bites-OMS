import { Router } from 'express';
import { Permission } from '../../../core/domain/enums/permission.enum.js';
import type { AppContainer } from '../../../infrastructure/container/container.js';
import { AnalyticsController } from '../controllers/analytics.controller.js';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { requirePermission } from '../middlewares/authorize.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  analyticsExportQuerySchema,
  analyticsQuerySchema,
} from '../validators/analytics.validators.js';

/**
 * Analytics routes.
 *
 * Gated on `REPORT_VIEW_FINANCIAL`, which is admin-only.
 *
 * The whole page is financial: revenue, stock valuation and food cost are the three
 * figures it exists to show, and the two that are not — ingredient usage and transfer
 * volume — are already available to a Store Manager through the consumption and transfer
 * reports. Projecting this page per column, the way the reports module does, would leave
 * a manager with a dashboard of two tiles and four empty charts. Withholding it whole is
 * both simpler and a more honest description of what it is.
 */
export function analyticsRoutes(container: AppContainer): Router {
  const router = Router();

  const controller = new AnalyticsController(
    container.getAnalyticsUseCase,
    container.analyticsExporters,
  );

  router.use(authenticate(container.tokenService));

  // Declared before `/`, though it would not collide — kept in the same order as the
  // other routers so the pattern reads the same everywhere.
  router.get(
    '/export',
    requirePermission(Permission.REPORT_VIEW_FINANCIAL),
    validate({ query: analyticsExportQuerySchema }),
    controller.export,
  );

  router.get(
    '/',
    requirePermission(Permission.REPORT_VIEW_FINANCIAL),
    validate({ query: analyticsQuerySchema }),
    controller.get,
  );

  return router;
}
