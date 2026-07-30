import type { Routes } from '@angular/router';
import { withBreadcrumb } from '../../core/services/breadcrumb.service';

/**
 * Reports routes.
 *
 * One route for all six reports: which one is showing is a query param, not a path, so a
 * filtered view is a single shareable link and switching reports keeps the filter bar in
 * place rather than remounting the page.
 */
export const reportsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Reports · Paris Bites',
    data: withBreadcrumb('Reports'),
    loadComponent: () => import('./pages/reports/reports.page').then((m) => m.ReportsPage),
  },
];
