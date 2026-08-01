import type { RequestHandler } from 'express';
import type { Permission } from '../../../core/domain/enums/permission.enum.js';
import {
  sessionHasAllPermissions,
  sessionHasAnyPermission,
} from '../../../core/domain/enums/session-scope.enum.js';
import { hasAtLeastRole, type Role } from '../../../core/domain/enums/role.enum.js';
import { ForbiddenError, UnauthorizedError } from '../../../core/domain/errors/domain-error.js';

/**
 * Authorization guards.
 *
 * All of these must be registered after `authenticate`. A missing `req.user` is
 * reported as 401 rather than 403, because the distinction is actionable for the
 * client: refresh the token versus give up.
 *
 * `requirePermission` is the one to reach for. The role-based variants exist for
 * the rare check that is genuinely about identity rather than capability.
 */

/**
 * Requires every listed permission.
 *
 * Preferred over role checks: when a third role appears, a permission check keeps
 * expressing the actual intent, while `role === 'ADMIN'` silently excludes it.
 *
 * Checks the **session**, not the role. A till device is signed in as a real user — Sunil, an
 * administrator — and must still be refused everything except taking orders, so the question this
 * asks is "what may this sign-in do", which is the role narrowed by the session's scope.
 */
export function requirePermission(...permissions: readonly Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (req.user === undefined) {
      next(new UnauthorizedError());
      return;
    }

    if (!sessionHasAllPermissions(req.user.role, req.user.scope, permissions)) {
      next(new ForbiddenError());
      return;
    }

    next();
  };
}

/** Requires at least one of the listed permissions. */
export function requireAnyPermission(...permissions: readonly Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (req.user === undefined) {
      next(new UnauthorizedError());
      return;
    }

    if (!sessionHasAnyPermission(req.user.role, req.user.scope, permissions)) {
      next(new ForbiddenError());
      return;
    }

    next();
  };
}

/** Requires the caller to hold one of `roles` exactly. */
export function authorize(...roles: readonly Role[]): RequestHandler {
  return (req, _res, next) => {
    if (req.user === undefined) {
      next(new UnauthorizedError());
      return;
    }

    if (roles.length > 0 && !roles.includes(req.user.role)) {
      next(new ForbiddenError());
      return;
    }

    next();
  };
}

/** Requires the caller's role to meet or exceed `minimum`. */
export function authorizeAtLeast(minimum: Role): RequestHandler {
  return (req, _res, next) => {
    if (req.user === undefined) {
      next(new UnauthorizedError());
      return;
    }

    if (!hasAtLeastRole(req.user.role, minimum)) {
      next(new ForbiddenError());
      return;
    }

    next();
  };
}
