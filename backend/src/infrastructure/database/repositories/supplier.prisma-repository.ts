import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { Supplier } from '../../../core/domain/entities/supplier.entity.js';
import type {
  CreateSupplierData,
  ISupplierRepository,
  SupplierFilter,
  SupplierSort,
  UpdateSupplierData,
} from '../../../core/domain/repositories/supplier.repository.js';
import { ConflictError, NotFoundError } from '../../../core/domain/errors/domain-error.js';
import { createPage, toSkipTake, type Page, type PageRequest } from '../../../shared/pagination.js';
import { SupplierPrismaMapper } from '../mappers/supplier.prisma-mapper.js';

/** Postgres unique-violation code, surfaced by Prisma as P2002. */
const UNIQUE_VIOLATION = 'P2002';

export class SupplierPrismaRepository implements ISupplierRepository {
  constructor(private readonly client: PrismaClient) {}

  async findById(id: string): Promise<Supplier | null> {
    const row = await this.client.supplier.findUnique({ where: { id } });
    return row === null ? null : SupplierPrismaMapper.toDomain(row);
  }

  async findMany(
    filter: SupplierFilter,
    page: PageRequest,
    sort: SupplierSort,
  ): Promise<Page<Supplier>> {
    const where = this.buildWhere(filter);
    const { skip, take } = toSkipTake(page);

    // One transaction so the count and the slice describe the same snapshot.
    const [rows, total] = await this.client.$transaction([
      this.client.supplier.findMany({ where, skip, take, orderBy: this.buildOrderBy(sort) }),
      this.client.supplier.count({ where }),
    ]);

    return createPage(SupplierPrismaMapper.toDomainList(rows), total, page);
  }

  async findSelectable(): Promise<readonly Supplier[]> {
    const rows = await this.client.supplier.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
    });

    return SupplierPrismaMapper.toDomainList(rows);
  }

  async create(data: CreateSupplierData): Promise<Supplier> {
    try {
      const row = await this.client.supplier.create({
        data: {
          name: data.name,
          gstin: data.gstin ?? null,
          stateCode: data.stateCode,
          contactName: data.contactName ?? null,
          email: data.email ?? null,
          phone: data.phone ?? null,
          addressLine: data.addressLine ?? null,
          city: data.city ?? null,
          notes: data.notes ?? null,
          createdById: data.createdById,
        },
      });

      return SupplierPrismaMapper.toDomain(row);
    } catch (error) {
      throw await this.translateUniqueViolation(error, data.name, data.gstin);
    }
  }

  async update(id: string, data: UpdateSupplierData): Promise<Supplier> {
    try {
      const row = await this.client.supplier.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.gstin !== undefined && { gstin: data.gstin ?? null }),
          ...(data.stateCode !== undefined && { stateCode: data.stateCode }),
          ...(data.contactName !== undefined && { contactName: data.contactName ?? null }),
          ...(data.email !== undefined && { email: data.email ?? null }),
          ...(data.phone !== undefined && { phone: data.phone ?? null }),
          ...(data.addressLine !== undefined && { addressLine: data.addressLine ?? null }),
          ...(data.city !== undefined && { city: data.city ?? null }),
          ...(data.notes !== undefined && { notes: data.notes ?? null }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
        },
      });

      return SupplierPrismaMapper.toDomain(row);
    } catch (error) {
      throw await this.translateUniqueViolation(error, data.name ?? '', data.gstin ?? undefined, id);
    }
  }

  async softDelete(id: string): Promise<void> {
    await this.client.supplier.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async hasPurchases(id: string): Promise<boolean> {
    const count = await this.client.purchase.count({ where: { supplierId: id } });
    return count > 0;
  }

  /**
   * Turns a partial-index violation into a message naming the field.
   *
   * Both unique indexes are partial (`WHERE deleted_at IS NULL`) and hand-written, so
   * Prisma cannot report which constraint fired the way it does for a declared `@unique`.
   * Without this the user would see a raw constraint name — and "name" versus "GSTIN" is
   * exactly what they need to know to fix it.
   */
  private async translateUniqueViolation(
    error: unknown,
    name: string,
    gstin: string | undefined,
    excludeId?: string,
  ): Promise<unknown> {
    if (
      typeof error !== 'object' ||
      error === null ||
      (error as { code?: string }).code !== UNIQUE_VIOLATION
    ) {
      return error;
    }

    // Prisma reports `meta.target` as a column array for declared constraints and a plain
    // string for raw ones. Both shapes are flattened to text rather than assumed.
    const rawTarget = (error as { meta?: { target?: unknown } }).meta?.target;
    const target = Array.isArray(rawTarget)
      ? rawTarget.join(',')
      : typeof rawTarget === 'string'
        ? rawTarget
        : '';

    if (target.includes('gstin') && gstin !== undefined) {
      return this.gstinConflict(gstin);
    }

    if (target.includes('name') && name.length > 0) {
      return this.nameConflict(name);
    }

    /*
     * The target did not name a column, so find out which value actually collides.
     *
     * Both unique constraints here are PARTIAL indexes written by hand in the migration,
     * and Prisma reports no `meta.target` for those — it arrives empty. The previous
     * fallback blamed the name whenever one was supplied, which on create is always, so a
     * duplicate GSTIN was reported as "a supplier named X already exists" while no such
     * name existed. The message named a field the user had not got wrong, and the form
     * had nothing to attach it to.
     *
     * One extra query, on the error path only, buys a message the user can act on.
     */
    const [gstinTaken, nameTaken] = await Promise.all([
      gstin === undefined ? Promise.resolve(false) : this.isGstinTaken(gstin, excludeId),
      name.length === 0 ? Promise.resolve(false) : this.isNameTaken(name, excludeId),
    ]);

    if (gstinTaken) {
      return this.gstinConflict(gstin as string);
    }

    if (nameTaken) {
      return this.nameConflict(name);
    }

    // A unique violation we cannot attribute. Reported honestly rather than guessed at:
    // naming the wrong field sends the user to correct something that is already right.
    return excludeId === undefined
      ? new ConflictError('A supplier with these details already exists.')
      : new NotFoundError('Supplier', excludeId);
  }

  /** Field-scoped, so the form puts the message under the offending input. */
  private gstinConflict(gstin: string): ConflictError {
    return new ConflictError(`A supplier with GSTIN ${gstin} already exists.`, {
      gstin: ['This GSTIN is already registered to another supplier.'],
    });
  }

  private nameConflict(name: string): ConflictError {
    return new ConflictError(`A supplier named "${name}" already exists.`, {
      name: ['This name is already in use.'],
    });
  }

  /** Mirrors `suppliers_gstin_live_key`: live rows only. */
  private async isGstinTaken(gstin: string, excludeId?: string): Promise<boolean> {
    const found = await this.client.supplier.findFirst({
      where: {
        gstin,
        deletedAt: null,
        ...(excludeId !== undefined && { id: { not: excludeId } }),
      },
      select: { id: true },
    });

    return found !== null;
  }

  /** Mirrors `suppliers_name_live_key`: live rows, compared case-insensitively. */
  private async isNameTaken(name: string, excludeId?: string): Promise<boolean> {
    const found = await this.client.supplier.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        deletedAt: null,
        ...(excludeId !== undefined && { id: { not: excludeId } }),
      },
      select: { id: true },
    });

    return found !== null;
  }

  private buildWhere(filter: SupplierFilter): Prisma.SupplierWhereInput {
    const where: Prisma.SupplierWhereInput = {};

    if (filter.includeDeleted !== true) {
      where.deletedAt = null;
    }

    if (filter.isActive !== undefined) {
      where.isActive = filter.isActive;
    }

    if (filter.stateCode !== undefined) {
      where.stateCode = filter.stateCode;
    }

    if (filter.search !== undefined && filter.search.length > 0) {
      // Across the fields someone would actually search a vendor list by. GSTIN is
      // included because "who is 27ABCDE..." is a real question when reconciling a bill,
      // and email because a vendor is often identified by the address a bill arrived from.
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { gstin: { contains: filter.search, mode: 'insensitive' } },
        { contactName: { contains: filter.search, mode: 'insensitive' } },
        { city: { contains: filter.search, mode: 'insensitive' } },
        { email: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  private buildOrderBy(sort: SupplierSort): Prisma.SupplierOrderByWithRelationInput[] {
    // `id` as a tiebreaker, so rows with equal sort keys keep a stable order across pages
    // — without it, page 2 can repeat a row page 1 already showed.
    return [{ [sort.field]: sort.direction }, { id: 'asc' }];
  }
}
