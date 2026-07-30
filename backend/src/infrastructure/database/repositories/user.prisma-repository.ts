import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { User } from '../../../core/domain/entities/user.entity.js';
import type { Role } from '../../../core/domain/enums/role.enum.js';
import type {
  CreateUserData,
  IUserRepository,
  UpdateUserData,
  UserFilter,
} from '../../../core/domain/repositories/user.repository.js';
import { createPage, toSkipTake, type Page, type PageRequest } from '../../../shared/pagination.js';
import { UserPrismaMapper } from '../mappers/user.prisma-mapper.js';

/**
 * Prisma-backed implementation of `IUserRepository`.
 *
 * Reference adapter for the pattern every future repository follows: take the
 * client by constructor injection, translate domain filters into Prisma
 * `where` clauses, and return domain entities — never Prisma rows.
 */
export class UserPrismaRepository implements IUserRepository {
  constructor(private readonly client: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.client.user.findFirst({ where: { id, deletedAt: null } });
    return row === null ? null : UserPrismaMapper.toDomain(row);
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.client.user.findFirst({
      where: { email: this.normaliseEmail(email), deletedAt: null },
    });
    return row === null ? null : UserPrismaMapper.toDomain(row);
  }

  async findMany(filter: UserFilter, page: PageRequest): Promise<Page<User>> {
    const where = this.buildWhere(filter);
    const { skip, take } = toSkipTake(page);

    // One transaction so the count and the slice describe the same snapshot.
    const [rows, total] = await this.client.$transaction([
      this.client.user.findMany({ where, skip, take, orderBy: { createdAt: 'desc' } }),
      this.client.user.count({ where }),
    ]);

    return createPage(UserPrismaMapper.toDomainList(rows), total, page);
  }

  async findIdsByRole(role: Role): Promise<readonly string[]> {
    const rows = await this.client.user.findMany({
      // Suspended and invited accounts are excluded: neither can sign in, so a
      // notification addressed to them is delivered to nobody and inflates an unread
      // count that will never be cleared.
      where: { role, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });

    return rows.map((row) => row.id);
  }

  async existsByEmail(email: string): Promise<boolean> {
    const count = await this.client.user.count({
      where: { email: this.normaliseEmail(email), deletedAt: null },
    });
    return count > 0;
  }

  async create(data: CreateUserData): Promise<User> {
    const row = await this.client.user.create({
      data: {
        id: data.id,
        email: this.normaliseEmail(data.email),
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        status: data.status,
        lastLoginAt: data.lastLoginAt,
      },
    });
    return UserPrismaMapper.toDomain(row);
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    const row = await this.client.user.update({
      where: { id },
      data: {
        ...(data.email !== undefined && { email: this.normaliseEmail(data.email) }),
        ...(data.passwordHash !== undefined && { passwordHash: data.passwordHash }),
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(data.role !== undefined && { role: data.role }),
        ...(data.status !== undefined && { status: data.status }),
      },
    });
    return UserPrismaMapper.toDomain(row);
  }

  async recordLogin(id: string, at: Date): Promise<void> {
    await this.client.user.update({ where: { id }, data: { lastLoginAt: at } });
  }

  async softDelete(id: string): Promise<void> {
    await this.client.user.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Emails are treated case-insensitively; storing them lowercased keeps the
   * unique index meaningful without a functional index. */
  private normaliseEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private buildWhere(filter: UserFilter): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};

    if (filter.includeDeleted !== true) {
      where.deletedAt = null;
    }
    if (filter.role !== undefined) {
      where.role = filter.role;
    }
    if (filter.status !== undefined) {
      where.status = filter.status;
    }
    if (filter.search !== undefined && filter.search.trim().length > 0) {
      const search = filter.search.trim();
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    return where;
  }
}
