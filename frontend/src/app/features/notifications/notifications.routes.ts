import type { Routes } from '@angular/router';
import { withBreadcrumb } from '../../core/services/breadcrumb.service';

/**
 * Notification centre routes.
 *
 * No permission guard, unlike every other feature. An inbox is not a shared resource, so
 * "may this role do this?" is the wrong question — the API enforces ownership from the
 * verified token instead, and every signed-in user has an inbox of their own to read.
 */
export const notificationsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Notifications · Paris Bites',
    data: withBreadcrumb('Notifications'),
    loadComponent: () =>
      import('./pages/notification-center/notification-center.page').then(
        (m) => m.NotificationCenterPage,
      ),
  },
];
