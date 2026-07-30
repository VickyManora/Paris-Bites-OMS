import type { Permission } from '../../models/permission.model';
import type { Role } from '../../models/role.model';

export type UserStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED';

/**
 * The authenticated user, as returned by `/auth/login` and `/auth/me`.
 *
 * `permissions` comes from the server rather than being derived from `role`, so
 * the access model has exactly one definition — see `permission.model.ts`.
 */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly role: Role;
  readonly status: UserStatus;
  readonly permissions: readonly Permission[];
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
}

/**
 * Login response.
 *
 * Only the access token appears here — the refresh token is set by the server as
 * an httpOnly cookie, so no script (including an injected one) can read it.
 */
export interface LoginResponse {
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly user: AuthUser;
}

export interface RefreshResponse {
  readonly accessToken: string;
  readonly expiresAt: string;
}

export interface ChangePasswordRequest {
  readonly currentPassword: string;
  readonly newPassword: string;
}
