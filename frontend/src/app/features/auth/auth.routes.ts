import type { Routes } from '@angular/router';

/**
 * Auth feature routes, lazy loaded under `auth` and wrapped by
 * `AuthLayoutComponent`. Guarded by `guestGuard`, so a signed-in user cannot
 * reach them and clobber a valid session.
 */
export const authRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'login',
  },
  {
    path: 'login',
    title: 'Sign in · Paris Bites',
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },

  // Password reset is not implemented — it needs transactional email, which is
  // infrastructure this project does not have yet.
  // {
  //   path: 'forgot-password',
  //   loadComponent: () =>
  //     import('./pages/forgot-password/forgot-password.page').then((m) => m.ForgotPasswordPage),
  // },
];
