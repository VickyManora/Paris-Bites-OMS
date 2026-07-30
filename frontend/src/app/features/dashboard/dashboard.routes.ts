import type { Routes } from '@angular/router';
import { withBreadcrumb } from '../../core/services/breadcrumb.service';

/** Dashboard feature routes, inside `MainLayoutComponent` and behind `authGuard`. */
export const dashboardRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Dashboard · Paris Bites',
    data: withBreadcrumb('Dashboard'),
    loadComponent: () => import('./dashboard.page').then((m) => m.DashboardPage),
  },
];
