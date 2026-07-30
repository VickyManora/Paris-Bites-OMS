import { Router } from 'express';
import { Permission } from '../../../core/domain/enums/permission.enum.js';
import type { AppContainer } from '../../../infrastructure/container/container.js';
import { PurchaseController } from '../controllers/purchase.controller.js';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { requirePermission } from '../middlewares/authorize.middleware.js';
import { uploadInvoiceFile } from '../middlewares/upload.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { idParamSchema } from '../validators/common.validators.js';
import {
  createPurchaseSchema,
  listPurchasesQuerySchema,
} from '../validators/purchase.validators.js';

/**
 * Purchase routes.
 *
 * | Operation | Permission | Admin | Store Manager |
 * |---|---|---|---|
 * | List / read / summary | `PURCHASE_ORDER_READ` | yes | yes |
 * | Record an invoice | `PURCHASE_ORDER_CREATE` | yes | yes |
 * | Upload the bill | `PURCHASE_ORDER_CREATE` | yes | yes |
 *
 * Recording is **not** admin-only, unlike transfer approval, and the difference is worth
 * stating. A transfer approval is a decision — it authorises stock to move, so the person
 * requesting it must not also grant it. Recording a purchase is data entry after the fact:
 * the goods have already arrived and the money is already spent, and requiring an admin
 * would mean invoices pile up unrecorded while stock silently understates what is on the
 * shelf. The control here is the audit trail and immutability, not an approval gate.
 *
 * These routes reuse the existing `PURCHASE_ORDER_*` permissions rather than adding new
 * ones. A purchase order is the *future* half of the same capability — "may this person
 * deal with buying" — and splitting the permission would give both roles a second flag
 * that is always set alongside the first.
 */
export function purchaseRoutes(container: AppContainer): Router {
  const router = Router();

  const controller = new PurchaseController(
    container.listPurchasesUseCase,
    container.getPurchaseUseCase,
    container.getPurchaseSummaryUseCase,
    container.recordPurchaseUseCase,
    container.uploadPurchaseInvoiceUseCase,
    container.downloadPurchaseInvoiceUseCase,
  );

  // Applied to every route below, so a new route cannot accidentally be public.
  router.use(authenticate(container.tokenService));

  // Declared before `/:id`, or "summary" would be parsed as an id and fail UUID validation.
  router.get(
    '/summary',
    requirePermission(Permission.PURCHASE_ORDER_READ),
    validate({ query: listPurchasesQuerySchema }),
    controller.summary,
  );

  router.get(
    '/',
    requirePermission(Permission.PURCHASE_ORDER_READ),
    validate({ query: listPurchasesQuerySchema }),
    controller.list,
  );

  router.post(
    '/',
    requirePermission(Permission.PURCHASE_ORDER_CREATE),
    validate({ body: createPurchaseSchema }),
    controller.create,
  );

  router.get(
    '/:id',
    requirePermission(Permission.PURCHASE_ORDER_READ),
    validate({ params: idParamSchema }),
    controller.getById,
  );

  /**
   * Multipart, so the order differs from every other route here: `uploadInvoiceFile`
   * parses the body before `validate` can look at the params.
   *
   * Authorisation still runs first. Parsing a multipart body means buffering megabytes,
   * and doing that for a caller who is about to be refused is the cheap way to be
   * DoS'd — so the permission check stays in front of the parser.
   */
  router.post(
    '/:id/invoice',
    requirePermission(Permission.PURCHASE_ORDER_CREATE),
    validate({ params: idParamSchema }),
    uploadInvoiceFile(),
    controller.uploadInvoice,
  );

  router.get(
    '/:id/invoice',
    requirePermission(Permission.PURCHASE_ORDER_READ),
    validate({ params: idParamSchema }),
    controller.downloadInvoice,
  );

  return router;
}
