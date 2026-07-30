import { Router } from 'express';
import type { AppContainer } from '../../../infrastructure/container/container.js';
import { API_VERSION } from '../../../config/constants.js';
import { env } from '../../../config/env.js';
import { stateNameFor } from '../../../core/domain/enums/purchase.enum.js';
import { sendSuccess } from '../serializers/response.serializer.js';
import { analyticsRoutes } from './analytics.routes.js';
import { authRoutes } from './auth.routes.js';
import { consumptionRoutes } from './consumption.routes.js';
import { dailySalesRoutes } from './daily-sales.routes.js';
import { dashboardRoutes } from './dashboard.routes.js';
import { healthRoutes } from './health.routes.js';
import { inventoryRoutes } from './inventory.routes.js';
import { notificationRoutes } from './notification.routes.js';
import { posRoutes } from './pos.routes.js';
import { purchaseRoutes } from './purchase.routes.js';
import { reportRoutes } from './report.routes.js';
import { stockTransferRoutes } from './stock-transfer.routes.js';
import { supplierRoutes } from './supplier.routes.js';

/**
 * Root router mounted at `/api/v1`.
 *
 * Every feature contributes exactly one `<feature>.routes.ts` module and one line
 * below, so the full surface area of the API is readable at a glance.
 */
export function createApiRouter(container: AppContainer): Router {
  const router = Router();

  router.use('/health', healthRoutes(container));
  router.use('/dashboard', dashboardRoutes(container));
  router.use('/auth', authRoutes(container));
  router.use('/inventory', inventoryRoutes(container));
  router.use('/transfers', stockTransferRoutes(container));
  router.use('/consumption', consumptionRoutes(container));
  router.use('/daily-sales', dailySalesRoutes(container));
  router.use('/notifications', notificationRoutes(container));
  router.use('/suppliers', supplierRoutes(container));
  router.use('/purchases', purchaseRoutes(container));
  router.use('/pos', posRoutes(container));
  router.use('/reports', reportRoutes(container));
  router.use('/analytics', analyticsRoutes(container));

  /**
   * Service descriptor, and the one piece of server configuration a client legitimately
   * needs: the state the business files GST from.
   *
   * Exposed rather than duplicated in the frontend build, because the purchase form has
   * to show whether an invoice will split into CGST + SGST or land as IGST *before* it is
   * saved — and a copy of this value that drifted from the server's would preview one
   * split while the server filed the other. The server still decides what is stored; this
   * only lets the client predict it honestly.
   *
   * Unauthenticated, like the rest of this descriptor: a GST state code is printed on
   * every invoice the business issues.
   */
  router.get('/', (_req, res) => {
    sendSuccess(res, {
      name: 'Paris Bites Inventory Management API',
      version: API_VERSION,
      businessStateCode: env.BUSINESS_STATE_CODE,
      businessStateName: stateNameFor(env.BUSINESS_STATE_CODE),
    });
  });

  // Inventory routes are registered here as they are built, e.g.
  //   router.use('/products', productRoutes(container));
  //
  // Each should sit behind `authenticate(container.tokenService)` and declare its
  // required capability with `requirePermission(...)`.

  return router;
}
