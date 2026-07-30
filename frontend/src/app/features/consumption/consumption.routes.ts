import type { Routes } from '@angular/router';
import { withBreadcrumb } from '../../core/services/breadcrumb.service';

/**
 * Consumption routes. The permission gate lives on the parent in `app.routes.ts`, so it
 * applies to every child without each one repeating it.
 */
export const consumptionRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Consumption · Paris Bites',
    data: withBreadcrumb('Consumption'),
    loadComponent: () =>
      import('./pages/consumption-list/consumption-list.page').then((m) => m.ConsumptionListPage),
  },
];
