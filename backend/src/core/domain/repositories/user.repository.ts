import type { Page, PageRequest } from '../../../shared/pagination.js';
import type { User, UserProps } from '../entities/user.entity.js';
import type { Role } from '../enums/role.enum.js';
import type { UserStatus } from '../enums/user-status.enum.js';

/** Fields a caller may create a user with. Timestamps are set by the store. */
export type CreateUserData = Omit<UserProps, 'createdAt' | 'updatedAt' | 'deletedAt'>;

/** Fields a caller may change. Absent keys are left untouched. */
export type UpdateUserData = Partial<
  Pick<UserProps, 'email' | 'passwordHash' | 'firstName' | 'lastName' | 'role' | 'status'>
>;

export interface UserFilter {
  readonly search?: string;
  readonly role?: Role;
  readonly status?: UserStatus;
  /** Defaults to false — soft-deleted rows are hidden unless asked for. */
  readonly includeDeleted?: boolean;
}

/**
 * Port for user persistence, owned by the domain and implemented in
 * `infrastructure/database/repositories`. Use cases depend on this interface,
 * never on Prisma, which is what keeps the core testable with a fake.
 */
export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findMany(filter: UserFilter, page: PageRequest): Promise<Page<User>>;
  /**
   * Ids of every active, non-deleted user holding the role — the audience for a
   * fan-out notification.
   *
   * Returns ids rather than entities because the only caller counts them into an
   * insert, and loading full users to read one column each is waste. It is also
   * unpaginated on purpose: a notification must reach *every* admin, and a page of
   * them would silently skip the rest.
   */
  findIdsByRole(role: Role): Promise<readonly string[]>;
  existsByEmail(email: string): Promise<boolean>;
  create(data: CreateUserData): Promise<User>;
  update(id: string, data: UpdateUserData): Promise<User>;
  recordLogin(id: string, at: Date): Promise<void>;
  /** Soft delete — stamps `deletedAt` rather than removing the row. */
  softDelete(id: string): Promise<void>;
}
