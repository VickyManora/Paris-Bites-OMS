import { Router } from 'express';
import { Permission } from '../../../core/domain/enums/permission.enum.js';
import type { AppContainer } from '../../../infrastructure/container/container.js';
import { PosController } from '../controllers/pos.controller.js';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { requirePermission } from '../middlewares/authorize.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { idParamSchema } from '../validators/common.validators.js';
import {
  cancelOrderSchema,
  listOrdersQuerySchema,
  menuQuerySchema,
  placeOrderSchema,
  posSummaryQuerySchema,
  productAvailabilitySchema,
  receivePaymentSchema,
} from '../validators/pos.validators.js';

/**
 * Point-of-sale routes.
 *
 * | Operation | Permission | Admin | Store Manager |
 * |---|---|---|---|
 * | Menu, summary, list, read | `POS_OPERATE` | yes | yes |
 * | Place an order | `POS_OPERATE` | yes | yes |
 * | Receive payment | `POS_OPERATE` | yes | yes |
 * | Cancel an order | `POS_ORDER_CANCEL` | yes | **no** |
 * | Sold-out toggle | `POS_OPERATE` | yes | yes |
 *
 * Only cancellation is gated higher, and that is the whole shape of the split: taking money
 * is the counter's job, making it disappear again is not. An admin holds `POS_OPERATE` too,
 * because on a bad evening they will be the one serving.
 *
 * **Reads use one permission for both roles and are scoped inside the use case.** A Store
 * Manager calling `GET /pos/orders` gets their own orders from today; an admin gets
 * everything. Expressing that as two endpoints would leave the narrower one a query
 * parameter away from the wider, and expressing it as two permissions would still need the
 * row-level filter — so the filter is the only thing that enforces it.
 */
export function posRoutes(container: AppContainer): Router {
  const router = Router();

  const controller = new PosController(
    container.getMenuUseCase,
    container.getPosSummaryUseCase,
    container.listOrdersUseCase,
    container.getOrderUseCase,
    container.placeOrderUseCase,
    container.receivePaymentUseCase,
    container.cancelOrderUseCase,
    container.productRepository,
  );

  router.use(authenticate(container.tokenService));

  // `menu` and `summary` before `/orders/:id` is not strictly needed — they sit on different
  // paths — but the ordering matches every other router here so the pattern reads the same.
  router.get(
    '/menu',
    requirePermission(Permission.POS_OPERATE),
    validate({ query: menuQuerySchema }),
    controller.menu,
  );

  router.get(
    '/summary',
    requirePermission(Permission.POS_OPERATE),
    validate({ query: posSummaryQuerySchema }),
    controller.summary,
  );

  router.get(
    '/orders',
    requirePermission(Permission.POS_OPERATE),
    validate({ query: listOrdersQuerySchema }),
    controller.list,
  );

  router.post(
    '/orders',
    requirePermission(Permission.POS_OPERATE),
    validate({ body: placeOrderSchema }),
    controller.place,
  );

  router.get(
    '/orders/:id',
    requirePermission(Permission.POS_OPERATE),
    validate({ params: idParamSchema }),
    controller.getById,
  );

  router.post(
    '/orders/:id/payment',
    requirePermission(Permission.POS_OPERATE),
    validate({ params: idParamSchema, body: receivePaymentSchema }),
    controller.receivePayment,
  );

  router.post(
    '/orders/:id/cancel',
    requirePermission(Permission.POS_ORDER_CANCEL),
    validate({ params: idParamSchema, body: cancelOrderSchema }),
    controller.cancel,
  );

  router.patch(
    '/products/:id/availability',
    requirePermission(Permission.POS_OPERATE),
    validate({ params: idParamSchema, body: productAvailabilitySchema }),
    controller.setAvailability,
  );

  return router;
}
