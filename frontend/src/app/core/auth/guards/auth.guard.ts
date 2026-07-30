import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AppRoutes } from '../../constants/app.constants';
import { AuthService } from '../services/auth.service';

/**
 * Blocks unauthenticated access.
 *
 * Functional guard rather than a class: it composes with `inject()`, needs no
 * `providedIn`, and tree-shakes when unused.
 *
 * The attempted URL is preserved as `returnUrl` so the user lands where they were
 * headed after signing in, instead of on a generic dashboard.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return true;
  }

  return router.createUrlTree([AppRoutes.login], {
    queryParams: { returnUrl: state.url },
  });
};
