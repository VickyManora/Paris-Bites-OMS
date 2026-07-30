import { Router } from 'express';
import { Permission } from '../../../core/domain/enums/permission.enum.js';
import type { AppContainer } from '../../../infrastructure/container/container.js';
import { StockTransferController } from '../controllers/stock-transfer.controller.js';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { requirePermission } from '../middlewares/authorize.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { idParamSchema } from '../validators/common.validators.js';
import {
  approveTransferSchema,
  createTransferSchema,
  listTransfersQuerySchema,
  rejectTransferSchema,
} from '../validators/stock-transfer.validators.js';

/**
 * Stock transfer routes: Home Warehouse → Cart.
 *
 * | Operation | Permission | Admin | Store Manager |
 * |---|---|---|---|
 * | List / details / summary | `TRANSFER_READ` | yes | yes |
 * | Request a transfer | `TRANSFER_CREATE` | yes | yes |
 * | Approve (deducts source) | `TRANSFER_APPROVE` | yes | **no** |
 * | Reject | `TRANSFER_APPROVE` | yes | **no** |
 * | Complete (credits destination) | `TRANSFER_COMPLETE` | yes | yes |
 *
 * Approval is the control point: it is the moment stock actually leaves the warehouse, so
 * the person who raised the request cannot also authorise it. Completion is deliberately
 * *not* restricted the same way — whoever is running the cart confirms what arrived, and
 * blocking that would leave dispatched stock stranded in transit.
 *
 * Approve and reject share one permission. They are the same decision with two outcomes;
 * separating them would let someone reject everything but approve nothing.
 */
export function stockTransferRoutes(container: AppContainer): Router {
  const router = Router();

  const controller = new StockTransferController(
    container.listStockTransfersUseCase,
    container.getStockTransferUseCase,
    container.getTransferSummaryUseCase,
    container.createStockTransferUseCase,
    container.approveStockTransferUseCase,
    container.rejectStockTransferUseCase,
    container.completeStockTransferUseCase,
  );

  // Applied to every route below, so a new route cannot accidentally be public.
  router.use(authenticate(container.tokenService));

  // Declared before `/:id`, or "summary" would be parsed as an id and fail UUID validation.
  router.get('/summary', requirePermission(Permission.TRANSFER_READ), controller.summary);

  router.get(
    '/',
    requirePermission(Permission.TRANSFER_READ),
    validate({ query: listTransfersQuerySchema }),
    controller.list,
  );

  router.post(
    '/',
    requirePermission(Permission.TRANSFER_CREATE),
    validate({ body: createTransferSchema }),
    controller.create,
  );

  router.get(
    '/:id',
    requirePermission(Permission.TRANSFER_READ),
    validate({ params: idParamSchema }),
    controller.getById,
  );

  router.post(
    '/:id/approve',
    requirePermission(Permission.TRANSFER_APPROVE),
    validate({ params: idParamSchema, body: approveTransferSchema }),
    controller.approve,
  );

  router.post(
    '/:id/reject',
    requirePermission(Permission.TRANSFER_APPROVE),
    validate({ params: idParamSchema, body: rejectTransferSchema }),
    controller.reject,
  );

  router.post(
    '/:id/complete',
    requirePermission(Permission.TRANSFER_COMPLETE),
    validate({ params: idParamSchema }),
    controller.complete,
  );

  return router;
}
