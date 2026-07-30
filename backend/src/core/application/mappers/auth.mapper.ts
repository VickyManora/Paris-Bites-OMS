import type { User } from '../../domain/entities/user.entity.js';
import type { AuthenticatedUserDto } from '../dtos/auth.dto.js';
import { UserMapper } from './user.mapper.js';

export const AuthMapper = {
  /**
   * Builds the payload for `/auth/login` and `/auth/me`.
   *
   * Reuses `UserMapper.toDto`, which is the boundary that guarantees
   * `passwordHash` cannot leak: `UserDto` has no such field, so including it
   * would be a compile error rather than a review catch.
   */
  toAuthenticatedUserDto(user: User): AuthenticatedUserDto {
    return {
      ...UserMapper.toDto(user),
      permissions: user.permissions,
    };
  },
} as const;
