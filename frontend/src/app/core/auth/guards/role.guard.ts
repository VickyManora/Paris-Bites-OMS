import { inject } from '@angular/core';
import { Router, type CanActivateFn, type Route } from '@angular/router';
import { AppRoutes } from '../../constants/app.constants';
import { isRole, type Role } from '../../models/role.model';
import { AuthService } from '../services/auth.service';

/**
 * Role-based route guard.
 *
 * Kept for the checks that are genuinely about *identity* rather than capability
 * — "this page is for administrators" as a statement about who it is for.
 *
 * For access control, prefer `permissionGuard`: a permission keeps expressing the
 * intent when a role is added, whereas a role list silently excludes it.
 */
export interface RoleRouteData {
  readonly roles?: readonly Role[];
  readonly minimumRole?: Role;
}

export function withRoles(data: RoleRouteData): NonNullable<Route['data']> {
  return { ...data };
}

export const roleGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree([AppRoutes.login]);
  }

  const data = route.data as RoleRouteData;

  // No declared requirement means authenticated-only, not closed to everyone.
  if (data.roles === undefined && data.minimumRole === undefined) {
    return true;
  }

  const allowed =
    (data.roles === undefined || auth.hasAnyRole(data.roles)) &&
    (data.minimumRole === undefined || auth.isAtLeast(data.minimumRole));

  return allowed ? true : router.createUrlTree([AppRoutes.forbidden]);
};

/** Guard factory for a fixed set of roles. */
export function requireRole(...roles: readonly Role[]): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (!auth.isAuthenticated()) {
      return router.createUrlTree([AppRoutes.login]);
    }

    return auth.hasAnyRole(roles.filter(isRole))
      ? true
      : router.createUrlTree([AppRoutes.forbidden]);
  };
}
