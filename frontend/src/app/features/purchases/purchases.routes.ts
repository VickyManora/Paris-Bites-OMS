import type { Routes } from '@angular/router';
import { permissionGuard, withAccess } from '../../core/auth/guards/permission.guard';
import { Permission } from '../../core/models/permission.model';
import { withBreadcrumb } from '../../core/services/breadcrumb.service';

/**
 * Purchase routes.
 *
 * The read gate lives on the parent in `app.routes.ts`. `record` adds its own gate on
 * `PURCHASE_ORDER_CREATE`, because reading the history and entering a bill are separate
 * capabilities — someone who may only look must not reach a form the API would refuse.
 */
export const purchasesRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Purchases · Paris Bites',
    data: withBreadcrumb('Purchases'),
    loadComponent: () =>
      import('./pages/purchase-list/purchase-list.page').then((m) => m.PurchaseListPage),
  },
  {
    path: 'record',
    title: 'Record purchase · Paris Bites',
    canActivate: [permissionGuard],
    data: {
      ...withAccess({ permissions: [Permission.PURCHASE_ORDER_CREATE] }),
      ...withBreadcrumb('Record purchase'),
    },
    loadComponent: () =>
      import('./pages/purchase-record/purchase-record.page').then((m) => m.PurchaseRecordPage),
  },
];
