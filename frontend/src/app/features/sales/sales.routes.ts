import type { Routes } from '@angular/router';
import { withBreadcrumb } from '../../core/services/breadcrumb.service';

/**
 * Daily sales routes. The permission gate lives on the parent in `app.routes.ts`, so it
 * applies to every child without each one repeating it.
 */
export const salesRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Daily sales · Paris Bites',
    data: withBreadcrumb('Daily sales'),
    loadComponent: () => import('./pages/sales-list/sales-list.page').then((m) => m.SalesListPage),
  },
];
