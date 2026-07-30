import type { User } from '../../domain/entities/user.entity.js';
import type { UserDto } from '../dtos/user.dto.js';

/**
 * Domain entity to outbound DTO. One-directional by design: inbound data is
 * validated by a zod schema in the presentation layer, not reconstructed here.
 */
export const UserMapper = {
  toDto(user: User): UserDto {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  },

  toDtoList(users: readonly User[]): UserDto[] {
    return users.map((user) => UserMapper.toDto(user));
  },
} as const;
