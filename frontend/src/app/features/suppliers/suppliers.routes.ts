import type { Routes } from '@angular/router';
import { withBreadcrumb } from '../../core/services/breadcrumb.service';

/**
 * Supplier routes. The permission gate lives on the parent in `app.routes.ts`, so it
 * applies to every child without each one repeating it.
 */
export const suppliersRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Suppliers · Paris Bites',
    data: withBreadcrumb('Suppliers'),
    loadComponent: () =>
      import('./pages/supplier-list/supplier-list.page').then((m) => m.SupplierListPage),
  },
];
