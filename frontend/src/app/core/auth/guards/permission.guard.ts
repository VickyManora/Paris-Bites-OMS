import { inject } from '@angular/core';
import { Router, type CanActivateFn, type Route } from '@angular/router';
import { AppRoutes } from '../../constants/app.constants';
import type { Permission } from '../../models/permission.model';
import type { Role } from '../../models/role.model';
import { AuthService } from '../services/auth.service';

/** Access requirement a route declares in its `data`. */
export interface AccessRouteData {
  /** Caller must hold every one of these. */
  readonly permissions?: readonly Permission[];
  /** Caller must hold at least one of these. */
  readonly anyPermission?: readonly Permission[];
  /** Caller must hold one of these roles exactly. Prefer permissions. */
  readonly roles?: readonly Role[];
  /** Caller's role must meet or exceed this. Prefer permissions. */
  readonly minimumRole?: Role;
}

/**
 * Type-checked helper for declaring a route's requirement:
 *
 * ```ts
 * {
 *   path: 'users',
 *   canActivate: [authGuard, permissionGuard],
 *   data: withAccess({ permissions: [Permission.USER_READ] }),
 *   loadComponent: () => import('./user-list.page').then((m) => m.UserListPage),
 * }
 * ```
 *
 * Without this, `data` is `Record<string, any>` and a typo in a permission name
 * fails silently at runtime instead of at compile time.
 */
export function withAccess(data: AccessRouteData): NonNullable<Route['data']> {
  return { ...data };
}

/**
 * Permission-based route guard.
 *
 * Requirements come from `route.data`, so one generic guard serves every route
 * and there is no per-permission guard function to maintain.
 *
 * Pair with `authGuard`, which runs first and owns the unauthenticated redirect
 * (including preserving the return URL).
 *
 * A route that declares no requirement is treated as authenticated-only. That is
 * the deliberate choice: the alternative — denying by default — would silently
 * lock out routes that legitimately need nothing beyond a session, and the
 * server enforces the real boundary regardless.
 *
 * This hides UI. It is not security: every action is re-authorised server-side.
 */
export const permissionGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  /*
   * Unauthenticated: defer to `authGuard` so the return URL is preserved.
   *
   * "Signed in *or restoring*" for the reason `authGuard` gives at length: on a cold start the
   * session is still arriving, and treating that as signed out sends a cashier to a login form
   * whose submit button needs the same sleeping API. While restoring, the permission checks below
   * read the last known permissions — see `sessionHint` — so this guard answers the same way it
   * would have a moment ago, and the server re-authorises everything regardless.
   */
  if (!auth.isSignedInOrRestoring()) {
    return router.createUrlTree([AppRoutes.login]);
  }

  const data = route.data as AccessRouteData;

  const checks: readonly boolean[] = [
    data.permissions === undefined || auth.canAll(data.permissions),
    data.anyPermission === undefined || auth.canAny(data.anyPermission),
    data.roles === undefined || auth.hasAnyRole(data.roles),
    data.minimumRole === undefined || auth.isAtLeast(data.minimumRole),
  ];

  return checks.every(Boolean) ? true : router.createUrlTree([AppRoutes.forbidden]);
};

/**
 * Guard factory for when the requirement is known at declaration time and
 * routing it through `data` would be indirection for its own sake.
 */
export function requirePermission(...permissions: readonly Permission[]): CanActivateFn {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (!auth.isSignedInOrRestoring()) {
      return router.createUrlTree([AppRoutes.login]);
    }

    return auth.canAll(permissions) ? true : router.createUrlTree([AppRoutes.forbidden]);
  };
}
