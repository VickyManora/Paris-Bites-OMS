import type { User } from '../../domain/entities/user.entity.js';
import { permissionsForSession, type SessionScope } from '../../domain/enums/session-scope.enum.js';
import type { AuthenticatedUserDto } from '../dtos/auth.dto.js';
import { UserMapper } from './user.mapper.js';

export const AuthMapper = {
  /**
   * Builds the payload for `/auth/login` and `/auth/me`.
   *
   * Reuses `UserMapper.toDto`, which is the boundary that guarantees
   * `passwordHash` cannot leak: `UserDto` has no such field, so including it
   * would be a compile error rather than a review catch.
   *
   * **`permissions` is what this session may do, not what the user may do.** The client builds its
   * navigation, its route guards and every `*pbHasPermission` from this list, so returning the
   * role's full set to a till device would draw the entire admin console on the counter phone and
   * then 403 every screen in it. Answering with the scoped set means the till renders as what it
   * is: one screen, for taking orders.
   */
  toAuthenticatedUserDto(user: User, scope?: SessionScope): AuthenticatedUserDto {
    return {
      ...UserMapper.toDto(user),
      permissions: permissionsForSession(user.role, scope),
    };
  },
} as const;
