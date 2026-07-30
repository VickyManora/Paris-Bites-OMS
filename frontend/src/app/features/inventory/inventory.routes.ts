import type { Routes } from '@angular/router';
import { withBreadcrumb } from '../../core/services/breadcrumb.service';

/**
 * Inventory feature routes.
 *
 * The permission gate lives on the parent route in `app.routes.ts`, so it applies to every
 * child without each one having to remember it.
 */
export const inventoryRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Inventory · Paris Bites',
    data: withBreadcrumb('Inventory'),
    loadComponent: () =>
      import('./pages/inventory-list/inventory-list.page').then((m) => m.InventoryListPage),
  },
];
