import type { Routes } from '@angular/router';
import { withBreadcrumb } from '../../core/services/breadcrumb.service';

/**
 * Account self-service, inside the authenticated shell.
 *
 * No permission guard: every signed-in user may manage their own credentials
 * regardless of role, and the server scopes each operation to `req.user.id` so one
 * user cannot act on another's account.
 *
 * The parent contributes an "Account" crumb with no component of its own, which is
 * what gives children a two-level trail.
 */
export const accountRoutes: Routes = [
  {
    path: '',
    data: withBreadcrumb('Account'),
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'profile',
      },
      {
        path: 'profile',
        title: 'My profile · Paris Bites',
        data: withBreadcrumb('My profile'),
        loadComponent: () => import('./pages/profile/profile.page').then((m) => m.ProfilePage),
      },
      {
        path: 'password',
        title: 'Change password · Paris Bites',
        data: withBreadcrumb('Change password'),
        loadComponent: () =>
          import('./pages/change-password/change-password.page').then((m) => m.ChangePasswordPage),
      },
    ],
  },
];
