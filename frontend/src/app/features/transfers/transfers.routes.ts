import type { Routes } from '@angular/router';
import { withBreadcrumb } from '../../core/services/breadcrumb.service';

/**
 * Stock transfer routes. The permission gate lives on the parent in `app.routes.ts`, so it
 * applies to every child without each one repeating it.
 */
export const transfersRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Stock transfers · Paris Bites',
    data: withBreadcrumb('Transfers'),
    loadComponent: () =>
      import('./pages/transfer-list/transfer-list.page').then((m) => m.TransferListPage),
  },
];
