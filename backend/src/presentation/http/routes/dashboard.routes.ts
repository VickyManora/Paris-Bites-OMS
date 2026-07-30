import { Router } from 'express';
import { Permission } from '../../../core/domain/enums/permission.enum.js';
import type { AppContainer } from '../../../infrastructure/container/container.js';
import { DashboardController } from '../controllers/dashboard.controller.js';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { requirePermission } from '../middlewares/authorize.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { dashboardQuerySchema } from '../validators/dashboard.validators.js';

/**
 * Dashboard route.
 *
 * One endpoint, gated on `STOCK_READ` — the floor for seeing anything about stock at all.
 * The finer split is inside the use case, which omits an admin's figures from a Store
 * Manager's payload rather than sending them for the client to hide. A number that reaches
 * the browser has been disclosed, whatever the template does with it.
 */
export function dashboardRoutes(container: AppContainer): Router {
  const router = Router();

  const controller = new DashboardController(container.getDashboardUseCase);

  router.use(authenticate(container.tokenService));

  router.get(
    '/',
    requirePermission(Permission.STOCK_READ),
    validate({ query: dashboardQuerySchema }),
    controller.get,
  );

  return router;
}
