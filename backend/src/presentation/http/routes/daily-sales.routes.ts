import { Router } from 'express';
import { Permission } from '../../../core/domain/enums/permission.enum.js';
import type { AppContainer } from '../../../infrastructure/container/container.js';
import { DailySalesController } from '../controllers/daily-sales.controller.js';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { requirePermission } from '../middlewares/authorize.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { idParamSchema } from '../validators/common.validators.js';
import {
  dailySalesDateParamSchema,
  dailySalesSummaryQuerySchema,
  listDailySalesQuerySchema,
  recordDailySalesSchema,
  updateDailySalesSchema,
} from '../validators/daily-sales.validators.js';

/**
 * Daily sales routes.
 *
 * | Operation | Permission | Admin | Store Manager |
 * |---|---|---|---|
 * | List / read / summary | `SALE_READ` | yes | **no** |
 * | Record a day | `SALE_RECORD` | yes | **no** |
 * | Correct a day | `SALE_RECORD` | yes | **no** |
 *
 * Both permissions are admin-only, which is a deliberate choice rather than an oversight.
 * Revenue is financial data — the same reasoning that keeps `REPORT_VIEW_FINANCIAL` from
 * a Store Manager applies — and the entry itself is an admin task: the day is reconciled
 * against a bank statement and two aggregator dashboards, none of which a manager holds.
 *
 * Correcting a day sits behind the same permission as recording one rather than a higher
 * gate. A figure misread from a card machine and fixed the same evening is ordinary work,
 * and putting it out of reach would only mean the wrong number stays.
 *
 * There is no delete route. A day recorded in error is corrected, not erased: the totals
 * feed month-to-date figures, and a day that silently vanished would leave a gap nobody
 * can explain later. Soft delete exists on the repository for a future admin tool.
 */
export function dailySalesRoutes(container: AppContainer): Router {
  const router = Router();

  const controller = new DailySalesController(
    container.listDailySalesUseCase,
    container.getDailySalesSummaryUseCase,
    container.getDailySalesUseCase,
    container.getDailySalesByDateUseCase,
    container.recordDailySalesUseCase,
    container.updateDailySalesUseCase,
  );

  // Applied to every route below, so a new route cannot accidentally be public.
  router.use(authenticate(container.tokenService));

  // Both declared before `/:id`, or "summary" and "by-date" would be parsed as ids and
  // fail UUID validation — the same ordering trap as `/transfers/summary`.
  router.get(
    '/summary',
    requirePermission(Permission.SALE_READ),
    validate({ query: dailySalesSummaryQuerySchema }),
    controller.summary,
  );

  router.get(
    '/by-date/:date',
    requirePermission(Permission.SALE_READ),
    validate({ params: dailySalesDateParamSchema }),
    controller.getByDate,
  );

  router.get(
    '/',
    requirePermission(Permission.SALE_READ),
    validate({ query: listDailySalesQuerySchema }),
    controller.list,
  );

  router.post(
    '/',
    requirePermission(Permission.SALE_RECORD),
    validate({ body: recordDailySalesSchema }),
    controller.record,
  );

  router.get(
    '/:id',
    requirePermission(Permission.SALE_READ),
    validate({ params: idParamSchema }),
    controller.getById,
  );

  router.put(
    '/:id',
    requirePermission(Permission.SALE_RECORD),
    validate({ params: idParamSchema, body: updateDailySalesSchema }),
    controller.update,
  );

  return router;
}
