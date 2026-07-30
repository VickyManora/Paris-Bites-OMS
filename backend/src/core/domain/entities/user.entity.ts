import type { Permission } from '../enums/permission.enum.js';
import {
  permissionsForRole,
  roleHasAnyPermission,
  roleHasPermission,
} from '../enums/permission.enum.js';
import type { Role } from '../enums/role.enum.js';
import { hasAtLeastRole } from '../enums/role.enum.js';
import type { UserStatus } from '../enums/user-status.enum.js';
import { canAuthenticate } from '../enums/user-status.enum.js';

/**
 * Properties that make up a user, independent of how they are stored.
 *
 * `passwordHash` lives on the entity because authentication is a domain
 * concern, but no mapper ever copies it into a DTO — see `UserMapper`.
 */
export interface UserProps {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: Role;
  readonly status: UserStatus;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/**
 * Domain entity. Behaviour that depends only on a user's own state belongs
 * here rather than in a use case, so the rules are testable without any
 * database or HTTP scaffolding.
 */
export class User {
  private constructor(private readonly props: UserProps) {}

  /** Rehydrates an entity from persistence. Assumes the data is already valid. */
  static fromPersistence(props: UserProps): User {
    return new User(props);
  }

  get id(): string {
    return this.props.id;
  }

  get email(): string {
    return this.props.email;
  }

  get passwordHash(): string {
    return this.props.passwordHash;
  }

  get firstName(): string {
    return this.props.firstName;
  }

  get lastName(): string {
    return this.props.lastName;
  }

  get fullName(): string {
    return `${this.props.firstName} ${this.props.lastName}`.trim();
  }

  get role(): Role {
    return this.props.role;
  }

  get status(): UserStatus {
    return this.props.status;
  }

  get lastLoginAt(): Date | null {
    return this.props.lastLoginAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  /** A soft-deleted or non-active account must not be able to sign in. */
  get canSignIn(): boolean {
    return !this.isDeleted && canAuthenticate(this.props.status);
  }

  /** Everything this user's role permits. Derived, never stored. */
  get permissions(): readonly Permission[] {
    return permissionsForRole(this.props.role);
  }

  hasRole(role: Role): boolean {
    return this.props.role === role;
  }

  hasAnyRole(roles: readonly Role[]): boolean {
    return roles.includes(this.props.role);
  }

  /** True when this user's role meets or exceeds the required privilege level. */
  isAtLeast(role: Role): boolean {
    return hasAtLeastRole(this.props.role, role);
  }

  /**
   * Preferred over `hasRole` for authorization decisions: it survives the
   * addition of a new role, where a role comparison silently stops matching.
   */
  can(permission: Permission): boolean {
    return roleHasPermission(this.props.role, permission);
  }

  canAny(permissions: readonly Permission[]): boolean {
    return roleHasAnyPermission(this.props.role, permissions);
  }

  /** Snapshot for mappers and repositories. Callers must not mutate it. */
  toProps(): UserProps {
    return this.props;
  }
}
