import type { Role } from '../../../core/domain/enums/role.enum.js';

/**
 * Augments Express's `Request` with the fields our middleware attaches.
 *
 * Declaring them here (rather than casting at each use site) is what lets
 * `req.user!.role` be type-checked instead of `(req as any).user.role`.
 */
declare global {
  namespace Express {
    interface AuthenticatedUser {
      readonly id: string;
      readonly email: string;
      readonly role: Role;
    }

    interface Request {
      /** Set by `authenticate`; undefined on public routes. */
      user?: AuthenticatedUser;
      /** Correlation id, set by `requestContext` for every request. */
      requestId: string;
    }
  }
}

export {};
