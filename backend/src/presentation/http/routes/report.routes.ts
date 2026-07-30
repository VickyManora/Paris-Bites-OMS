import { Router } from 'express';
import { Permission } from '../../../core/domain/enums/permission.enum.js';
import type { AppContainer } from '../../../infrastructure/container/container.js';
import { ReportController } from '../controllers/report.controller.js';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { requirePermission } from '../middlewares/authorize.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import {
  reportExportQuerySchema,
  reportIdParamSchema,
  reportQuerySchema,
} from '../validators/report.validators.js';

/**
 * Report routes.
 *
 * Gated at the door on `REPORT_VIEW`, which both roles hold. The finer decision — which
 * reports appear, and whether cost columns are in the payload — lives in the use case,
 * because it varies per report and per column rather than per route.
 *
 * `REPORT_VIEW_FINANCIAL` is admin-only, so a Store Manager running the inventory report
 * receives it without the unit cost and value columns, and cannot run the purchase report
 * at all.
 */
export function reportRoutes(container: AppContainer): Router {
  const router = Router();

  const controller = new ReportController(
    container.listReportsUseCase,
    container.runReportUseCase,
    container.exportReportUseCase,
  );

  router.use(authenticate(container.tokenService));

  router.get('/', requirePermission(Permission.REPORT_VIEW), controller.list);

  // Declared before `/:id`, or "export" would be parsed as a report id.
  router.get(
    '/:id/export',
    requirePermission(Permission.REPORT_VIEW),
    validate({ params: reportIdParamSchema, query: reportExportQuerySchema }),
    controller.export,
  );

  router.get(
    '/:id',
    requirePermission(Permission.REPORT_VIEW),
    validate({ params: reportIdParamSchema, query: reportQuerySchema }),
    controller.run,
  );

  return router;
}
