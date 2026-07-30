import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AppRoutes } from '../../constants/app.constants';
import { AuthService } from '../services/auth.service';

/**
 * Inverse of `authGuard`: keeps signed-in users off the login and registration
 * pages, which would otherwise let them clobber a valid session by accident.
 */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.isAuthenticated() ? router.createUrlTree([AppRoutes.dashboard]) : true;
};
