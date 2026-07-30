import { Router } from 'express';
import { Permission } from '../../../core/domain/enums/permission.enum.js';
import type { AppContainer } from '../../../infrastructure/container/container.js';
import { InventoryController } from '../controllers/inventory.controller.js';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { requirePermission } from '../middlewares/authorize.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { idParamSchema } from '../validators/common.validators.js';
import {
  adjustQuantitySchema,
  createInventoryItemSchema,
  historyQuerySchema,
  listInventoryQuerySchema,
  updateInventoryItemSchema,
} from '../validators/inventory.validators.js';

/**
 * Inventory routes.
 *
 * Every route is authenticated and then gated on a **capability**, not a role — see
 * `permission.enum.ts`. The mapping to the two current roles falls out of that:
 *
 * | Operation | Permission | Admin | Store Manager |
 * |---|---|---|---|
 * | List / read / history | `PRODUCT_READ` | yes | yes |
 * | Create | `PRODUCT_CREATE` | yes | yes |
 * | Edit details | `PRODUCT_UPDATE` | yes | yes |
 * | Adjust quantity | `STOCK_ADJUST` | yes | yes |
 * | Delete | `PRODUCT_DELETE` | yes | **no** |
 *
 * Delete is the one a Store Manager cannot do, which is deliberate: running the store
 * day to day never requires removing an item's record, and a mistaken delete takes
 * stock history with it.
 *
 * Per-route middleware order is uniform: authenticate → authorize → validate → handler.
 * Cheap rejections first, so an unauthorised request never reaches the database.
 */
export function inventoryRoutes(container: AppContainer): Router {
  const router = Router();

  const controller = new InventoryController(
    container.listInventoryItemsUseCase,
    container.getInventoryItemUseCase,
    container.createInventoryItemUseCase,
    container.updateInventoryItemUseCase,
    container.adjustInventoryQuantityUseCase,
    container.deleteInventoryItemUseCase,
    container.getInventoryHistoryUseCase,
    container.getInventoryDashboardUseCase,
  );

  // Applied to every route below, so a new route cannot accidentally be public.
  router.use(authenticate(container.tokenService));

  router.get('/dashboard', requirePermission(Permission.STOCK_READ), controller.dashboard);

  router.get(
    '/items',
    requirePermission(Permission.PRODUCT_READ),
    validate({ query: listInventoryQuerySchema }),
    controller.list,
  );

  router.post(
    '/items',
    requirePermission(Permission.PRODUCT_CREATE),
    validate({ body: createInventoryItemSchema }),
    controller.create,
  );

  router.get(
    '/items/:id',
    requirePermission(Permission.PRODUCT_READ),
    validate({ params: idParamSchema }),
    controller.getById,
  );

  router.patch(
    '/items/:id',
    requirePermission(Permission.PRODUCT_UPDATE),
    validate({ params: idParamSchema, body: updateInventoryItemSchema }),
    controller.update,
  );

  /**
   * Separate from the edit route because a stock change is a different operation with a
   * different permission, and it records a quantity-specific history entry.
   */
  router.patch(
    '/items/:id/quantity',
    requirePermission(Permission.STOCK_ADJUST),
    validate({ params: idParamSchema, body: adjustQuantitySchema }),
    controller.adjustQuantity,
  );

  router.delete(
    '/items/:id',
    requirePermission(Permission.PRODUCT_DELETE),
    validate({ params: idParamSchema }),
    controller.remove,
  );

  router.get(
    '/items/:id/history',
    requirePermission(Permission.PRODUCT_READ),
    validate({ params: idParamSchema, query: historyQuerySchema }),
    controller.history,
  );

  return router;
}
