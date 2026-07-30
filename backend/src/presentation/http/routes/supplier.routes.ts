import { Router } from 'express';
import { Permission } from '../../../core/domain/enums/permission.enum.js';
import type { AppContainer } from '../../../infrastructure/container/container.js';
import { SupplierController } from '../controllers/supplier.controller.js';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { requirePermission } from '../middlewares/authorize.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { idParamSchema } from '../validators/common.validators.js';
import {
  createSupplierSchema,
  listSuppliersQuerySchema,
  updateSupplierSchema,
} from '../validators/purchase.validators.js';

/**
 * Supplier routes.
 *
 * | Operation | Permission | Admin | Store Manager |
 * |---|---|---|---|
 * | List / read / options | `SUPPLIER_READ` | yes | yes |
 * | Create / edit / remove | `SUPPLIER_MANAGE` | yes | yes |
 *
 * Both roles manage suppliers, which is deliberate: adding the vendor you just bought
 * from is part of recording the purchase, and routing that through an admin would stall
 * data entry at the moment it is being done. Nothing here moves stock or money.
 *
 * Middleware order is uniform: authenticate → authorize → validate → handler.
 */
export function supplierRoutes(container: AppContainer): Router {
  const router = Router();

  const controller = new SupplierController(
    container.listSuppliersUseCase,
    container.listSupplierOptionsUseCase,
    container.getSupplierUseCase,
    container.createSupplierUseCase,
    container.updateSupplierUseCase,
    container.deleteSupplierUseCase,
  );

  // Applied to every route below, so a new route cannot accidentally be public.
  router.use(authenticate(container.tokenService));

  // Declared before `/:id`, or "options" would be parsed as an id and fail UUID validation.
  router.get('/options', requirePermission(Permission.SUPPLIER_READ), controller.options);

  router.get(
    '/',
    requirePermission(Permission.SUPPLIER_READ),
    validate({ query: listSuppliersQuerySchema }),
    controller.list,
  );

  router.post(
    '/',
    requirePermission(Permission.SUPPLIER_MANAGE),
    validate({ body: createSupplierSchema }),
    controller.create,
  );

  router.get(
    '/:id',
    requirePermission(Permission.SUPPLIER_READ),
    validate({ params: idParamSchema }),
    controller.getById,
  );

  router.patch(
    '/:id',
    requirePermission(Permission.SUPPLIER_MANAGE),
    validate({ params: idParamSchema, body: updateSupplierSchema }),
    controller.update,
  );

  router.delete(
    '/:id',
    requirePermission(Permission.SUPPLIER_MANAGE),
    validate({ params: idParamSchema }),
    controller.remove,
  );

  return router;
}
