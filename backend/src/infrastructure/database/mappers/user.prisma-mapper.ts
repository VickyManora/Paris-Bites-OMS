import type { User as PrismaUser } from '../../../generated/prisma/client.js';
import { User } from '../../../core/domain/entities/user.entity.js';
import { Role } from '../../../core/domain/enums/role.enum.js';
import { UserStatus } from '../../../core/domain/enums/user-status.enum.js';

/**
 * Translates Prisma rows into domain entities.
 *
 * This is the only place allowed to know both shapes. It exists so the domain's
 * `Role`/`UserStatus` unions stay independent of Prisma's generated enums — if
 * the schema and the domain ever drift, the switch below stops compiling.
 */
function toDomainRole(role: PrismaUser['role']): Role {
  switch (role) {
    case 'ADMIN':
      return Role.ADMIN;
    case 'STORE_MANAGER':
      return Role.STORE_MANAGER;
  }
}

function toDomainStatus(status: PrismaUser['status']): UserStatus {
  switch (status) {
    case 'ACTIVE':
      return UserStatus.ACTIVE;
    case 'INVITED':
      return UserStatus.INVITED;
    case 'SUSPENDED':
      return UserStatus.SUSPENDED;
  }
}

export const UserPrismaMapper = {
  toDomain(row: PrismaUser): User {
    return User.fromPersistence({
      id: row.id,
      email: row.email,
      passwordHash: row.passwordHash,
      firstName: row.firstName,
      lastName: row.lastName,
      role: toDomainRole(row.role),
      status: toDomainStatus(row.status),
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  },

  toDomainList(rows: readonly PrismaUser[]): User[] {
    return rows.map((row) => UserPrismaMapper.toDomain(row));
  },
} as const;
