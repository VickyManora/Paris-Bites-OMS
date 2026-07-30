import { Router } from 'express';
import { Permission } from '../../../core/domain/enums/permission.enum.js';
import type { AppContainer } from '../../../infrastructure/container/container.js';
import { ConsumptionController } from '../controllers/consumption.controller.js';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { requirePermission } from '../middlewares/authorize.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { idParamSchema } from '../validators/common.validators.js';
import {
  listConsumptionQuerySchema,
  recordConsumptionSchema,
  updateConsumptionSchema,
  voidConsumptionSchema,
} from '../validators/consumption.validators.js';

/**
 * Daily consumption routes.
 *
 * | Operation | Permission | Admin | Store Manager |
 * |---|---|---|---|
 * | List / read / summary | `STOCK_READ` | yes | yes |
 * | Record a sheet | `STOCK_ADJUST` | yes | yes |
 * | Edit a sheet | `STOCK_ADJUST` | yes | yes |
 * | Void a sheet | `STOCK_WRITE_OFF` | yes | **no** |
 *
 * Recording and editing are `STOCK_ADJUST` — "record a normal movement: goods in, goods
 * out", which is exactly what a Store Manager entering the day's usage is doing. Editing
 * belongs with it rather than behind a higher gate: a correction made the same evening is
 * ordinary, and putting it out of reach would mean the sheet stays wrong.
 *
 * **Voiding is `STOCK_WRITE_OFF`, which only an admin holds.** It returns a whole day's
 * stock in one call with no counter-record of what was used instead — precisely the "make
 * physical and recorded stock agree without an explanation" risk that permission exists to
 * contain. Correcting a mistake is an edit; erasing the day is not.
 */
export function consumptionRoutes(container: AppContainer): Router {
  const router = Router();

  const controller = new ConsumptionController(
    container.listConsumptionUseCase,
    container.getConsumptionSummaryUseCase,
    container.getConsumptionUseCase,
    container.recordConsumptionUseCase,
    container.updateConsumptionUseCase,
    container.voidConsumptionUseCase,
  );

  // Applied to every route below, so a new route cannot accidentally be public.
  router.use(authenticate(container.tokenService));

  // Declared before `/:id`, or "summary" would be parsed as an id and fail UUID validation.
  router.get(
    '/summary',
    requirePermission(Permission.STOCK_READ),
    validate({ query: listConsumptionQuerySchema }),
    controller.summary,
  );

  router.get(
    '/',
    requirePermission(Permission.STOCK_READ),
    validate({ query: listConsumptionQuerySchema }),
    controller.list,
  );

  router.post(
    '/',
    requirePermission(Permission.STOCK_ADJUST),
    validate({ body: recordConsumptionSchema }),
    controller.record,
  );

  router.get(
    '/:id',
    requirePermission(Permission.STOCK_READ),
    validate({ params: idParamSchema }),
    controller.getById,
  );

  /**
   * `PUT`, not `PATCH`: the body is the entry's complete desired state, and the stock
   * effect is computed as a diff against what is stored. A partial update would leave the
   * server guessing which lines were meant to disappear.
   */
  router.put(
    '/:id',
    requirePermission(Permission.STOCK_ADJUST),
    validate({ params: idParamSchema, body: updateConsumptionSchema }),
    controller.update,
  );

  router.post(
    '/:id/void',
    requirePermission(Permission.STOCK_WRITE_OFF),
    validate({ params: idParamSchema, body: voidConsumptionSchema }),
    controller.void,
  );

  return router;
}
