import type { Routes } from '@angular/router';
import { withBreadcrumb } from '../../core/services/breadcrumb.service';

/**
 * Analytics routes. The permission gate lives on the parent in `app.routes.ts`.
 */
export const analyticsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Analytics · Paris Bites',
    data: withBreadcrumb('Analytics'),
    loadComponent: () => import('./pages/analytics/analytics.page').then((m) => m.AnalyticsPage),
  },
];
