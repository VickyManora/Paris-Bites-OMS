import type { Role } from '../../domain/enums/role.enum.js';
import type { UserStatus } from '../../domain/enums/user-status.enum.js';

/**
 * Outbound representation of a user. This is the boundary that guarantees
 * `passwordHash` never reaches a client: the type has no such field, so a leak
 * is a compile error rather than a code-review catch.
 *
 * Dates are ISO strings because that is what crosses the wire.
 */
export interface UserDto {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly role: Role;
  readonly status: UserStatus;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
