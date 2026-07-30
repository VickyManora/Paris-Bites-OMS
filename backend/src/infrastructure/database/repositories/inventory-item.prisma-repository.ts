import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { InventoryItem } from '../../../core/domain/entities/inventory-item.entity.js';
import {
  InventoryItemStatus,
  InventoryLocation,
  type InventoryUnit,
} from '../../../core/domain/enums/inventory.enum.js';
import { NotFoundError } from '../../../core/domain/errors/domain-error.js';
import type {
  AdjustmentHistory,
  CreateInventoryItemData,
  IInventoryItemRepository,
  InventoryItemFilter,
  InventoryItemSort,
  InventorySummary,
  UpdateInventoryItemData,
} from '../../../core/domain/repositories/inventory-item.repository.js';
import { createPage, toSkipTake, type Page, type PageRequest } from '../../../shared/pagination.js';
import {
  decimalToNumber,
  INVENTORY_ITEM_INCLUDE,
  InventoryItemPrismaMapper,
  toDomainUnitFromString,
} from '../mappers/inventory-item.prisma-mapper.js';

/** Shape returned by the raw locking query in `adjustQuantity`. */
interface LockedQuantityRow {
  readonly current_quantity: string | number;
  readonly unit: string;
}

export class InventoryItemPrismaRepository implements IInventoryItemRepository {
  constructor(private readonly client: PrismaClient) {}

  async findById(id: string): Promise<InventoryItem | null> {
    // Not filtered on `deletedAt` — callers that care check `isDeleted`, and history
    // reads legitimately need deleted items.
    const row = await this.client.inventoryItem.findUnique({
      where: { id },
      include: INVENTORY_ITEM_INCLUDE,
    });
    return row === null ? null : InventoryItemPrismaMapper.toDomain(row);
  }

  async findByNameAndLocation(
    name: string,
    location: InventoryLocation,
  ): Promise<InventoryItem | null> {
    /*
     * Mirrors the partial unique index exactly: case-insensitive on name, scoped to
     * live rows. `mode: 'insensitive'` on an equality filter compiles to ILIKE, which
     * Postgres can satisfy from the `LOWER(name)` index.
     */
    const row = await this.client.inventoryItem.findFirst({
      where: {
        name: { equals: name.trim(), mode: 'insensitive' },
        location,
        deletedAt: null,
      },
      include: INVENTORY_ITEM_INCLUDE,
    });

    return row === null ? null : InventoryItemPrismaMapper.toDomain(row);
  }

  async findMany(
    filter: InventoryItemFilter,
    page: PageRequest,
    sort: InventoryItemSort,
  ): Promise<Page<InventoryItem>> {
    const where = this.buildWhere(filter);
    const { skip, take } = toSkipTake(page);

    // One transaction so the count and the slice describe the same snapshot —
    // otherwise a concurrent insert can make the total disagree with the rows.
    const [rows, total] = await this.client.$transaction([
      this.client.inventoryItem.findMany({
        where,
        skip,
        take,
        orderBy: this.buildOrderBy(sort),
        include: INVENTORY_ITEM_INCLUDE,
      }),
      this.client.inventoryItem.count({ where }),
    ]);

    return createPage(InventoryItemPrismaMapper.toDomainList(rows), total, page);
  }

  async create(data: CreateInventoryItemData): Promise<InventoryItem> {
    const row = await this.client.inventoryItem.create({
      data: {
        name: data.name,
        category: data.category,
        unit: data.unit,
        location: data.location,
        currentQuantity: data.currentQuantity,
        openingQuantity: data.openingQuantity,
        minimumQuantity: data.minimumQuantity,
        purchasePrice: data.purchasePrice,
        supplierId: data.supplierId,
        lowStockAlertEnabled: data.lowStockAlertEnabled,
        batchNumber: data.batchNumber,
        expiryDate: data.expiryDate,
        status: data.status,
        notes: data.notes,
        createdById: data.createdById,
      },
      include: INVENTORY_ITEM_INCLUDE,
    });

    return InventoryItemPrismaMapper.toDomain(row);
  }

  async update(id: string, data: UpdateInventoryItemData): Promise<InventoryItem> {
    const row = await this.client.inventoryItem.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.unit !== undefined && { unit: data.unit }),
        ...(data.location !== undefined && { location: data.location }),
        ...(data.minimumQuantity !== undefined && { minimumQuantity: data.minimumQuantity }),
        ...(data.purchasePrice !== undefined && { purchasePrice: data.purchasePrice }),
        ...(data.supplierId !== undefined && { supplierId: data.supplierId }),
        ...(data.lowStockAlertEnabled !== undefined && {
          lowStockAlertEnabled: data.lowStockAlertEnabled,
        }),
        ...(data.batchNumber !== undefined && { batchNumber: data.batchNumber }),
        ...(data.expiryDate !== undefined && { expiryDate: data.expiryDate }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
      include: INVENTORY_ITEM_INCLUDE,
    });

    return InventoryItemPrismaMapper.toDomain(row);
  }

  /**
   * Locks the row, applies the caller's function to the quantity read under that lock,
   * writes the result, and records the history entry — all in one transaction.
   *
   * `SELECT ... FOR UPDATE` is what makes concurrent adjustments safe: a second
   * transaction touching the same item blocks until this one commits, so it sees the
   * post-adjustment quantity rather than the stale one. Without it two simultaneous
   * withdrawals would each read the original value and one would be lost.
   *
   * The history insert is inside the same transaction on purpose. Written afterwards it
   * could fail — a timeout, an exhausted pool — leaving stock changed with no record of
   * the change, which defeats the point of having a history.
   *
   * The lock query also returns the unit, so the caller needs no separate read: one
   * fewer round trip, one fewer connection held, and no window in which the unit could
   * change between the two.
   */
  async adjustQuantity(
    id: string,
    apply: (currentQuantity: number, unit: InventoryUnit) => number,
    buildHistory: (previousQuantity: number, nextQuantity: number) => AdjustmentHistory | null,
  ): Promise<{ item: InventoryItem; previousQuantity: number }> {
    return this.client.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<LockedQuantityRow[]>`
          SELECT current_quantity, unit::text AS unit
          FROM inventory_items
          WHERE id = ${id}::uuid AND deleted_at IS NULL
          FOR UPDATE
        `;

        const row = locked[0];

        if (row === undefined) {
          throw new NotFoundError('Inventory item', id);
        }

        const previousQuantity = decimalToNumber(row.current_quantity);
        const nextQuantity = apply(previousQuantity, toDomainUnitFromString(row.unit));

        const updated = await tx.inventoryItem.update({
          where: { id },
          data: { currentQuantity: nextQuantity },
          include: INVENTORY_ITEM_INCLUDE,
        });

        const history = buildHistory(previousQuantity, nextQuantity);

        if (history !== null) {
          await tx.inventoryItemHistory.create({
            data: {
              itemId: id,
              action: history.action,
              // Taken from the values actually committed, not from the caller, so the
              // entry cannot describe a different change than the one that happened.
              quantityBefore: previousQuantity,
              quantityAfter: nextQuantity,
              note: history.note ?? null,
              actorId: history.actorId ?? null,
            },
          });
        }

        return {
          item: InventoryItemPrismaMapper.toDomain(updated),
          previousQuantity,
        };
      },
      {
        /*
         * Lock contention is normal here — several staff adjusting the same item is the
         * expected case, not an error. The defaults (2s maxWait, 5s timeout) turn a
         * short queue into failed requests, so both are raised: a waiting transaction
         * should queue and succeed rather than surface a 500.
         */
        maxWait: 10_000,
        timeout: 15_000,
      },
    );
  }

  async softDelete(id: string): Promise<void> {
    await this.client.inventoryItem.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async restore(id: string): Promise<InventoryItem> {
    const row = await this.client.inventoryItem.update({
      where: { id },
      data: { deletedAt: null },
      include: INVENTORY_ITEM_INCLUDE,
    });

    return InventoryItemPrismaMapper.toDomain(row);
  }

  /**
   * Aggregate counts in a single round trip.
   *
   * Raw SQL because the low-stock rule compares two *columns*, which Prisma's query
   * API cannot express. The `CASE` expressions mirror `deriveStockStatus` — including
   * the rule that a zero threshold means "no threshold", so such items are only ever
   * counted as out of stock.
   *
   * Kept as one statement rather than five counts so all the figures describe the same
   * snapshot.
   */
  async summary(): Promise<InventorySummary> {
    const rows = await this.client.$queryRaw<
      {
        total_items: bigint;
        active_items: bigint;
        low_stock_items: bigint;
        out_of_stock_items: bigint;
        home_warehouse_items: bigint;
        cart_items: bigint;
      }[]
    >`
      SELECT
        count(*)                                                          AS total_items,
        count(*) FILTER (WHERE status = 'ACTIVE')                         AS active_items,
        count(*) FILTER (
          WHERE status = 'ACTIVE'
            AND current_quantity > 0
            AND minimum_quantity > 0
            AND current_quantity <= minimum_quantity
        )                                                                 AS low_stock_items,
        count(*) FILTER (WHERE status = 'ACTIVE' AND current_quantity <= 0) AS out_of_stock_items,
        count(*) FILTER (WHERE location = 'HOME_WAREHOUSE')                AS home_warehouse_items,
        count(*) FILTER (WHERE location = 'CART')                          AS cart_items
      FROM inventory_items
      WHERE deleted_at IS NULL
    `;

    const row = rows[0];

    // An empty inventory still has to produce a valid summary.
    if (row === undefined) {
      return {
        totalItems: 0,
        activeItems: 0,
        lowStockItems: 0,
        outOfStockItems: 0,
        byLocation: { HOME_WAREHOUSE: 0, CART: 0 },
      };
    }

    return {
      // Postgres `count()` is bigint, which Prisma surfaces as a JS BigInt — it must be
      // narrowed before it reaches JSON.stringify, which cannot serialise BigInt.
      totalItems: Number(row.total_items),
      activeItems: Number(row.active_items),
      lowStockItems: Number(row.low_stock_items),
      outOfStockItems: Number(row.out_of_stock_items),
      byLocation: {
        [InventoryLocation.HOME_WAREHOUSE]: Number(row.home_warehouse_items),
        [InventoryLocation.CART]: Number(row.cart_items),
      },
    };
  }

  /**
   * Everything the low-stock alert should fire on.
   *
   * Reuses `buildWhere` so the predicate is literally the same one the list and the
   * reorder report use — a scan with its own hand-written copy of "what counts as low"
   * would drift the first time the rule changed, and the symptom would be alerts that
   * disagree with the screen.
   */
  async findLowStockForAlert(): Promise<InventoryItem[]> {
    const rows = await this.client.inventoryItem.findMany({
      where: {
        ...this.buildWhere({ needsRestocking: true, status: InventoryItemStatus.ACTIVE }),
        lowStockAlertEnabled: true,
      },
      orderBy: [{ name: 'asc' }],
    });

    return InventoryItemPrismaMapper.toDomainList(rows);
  }

  /**
   * Live stock expiring on or before `date`.
   *
   * `currentQuantity > 0` is part of the query, not a filter afterwards: an expired item
   * with nothing on the shelf is not a loss, and alerting on it would bury the ones that
   * are.
   */
  async findExpiringOnOrBefore(date: Date): Promise<InventoryItem[]> {
    const rows = await this.client.inventoryItem.findMany({
      where: {
        deletedAt: null,
        status: InventoryItemStatus.ACTIVE,
        currentQuantity: { gt: 0 },
        expiryDate: { not: null, lte: date },
      },
      orderBy: [{ expiryDate: 'asc' }, { name: 'asc' }],
    });

    return InventoryItemPrismaMapper.toDomainList(rows);
  }

  private buildWhere(filter: InventoryItemFilter): Prisma.InventoryItemWhereInput {
    const where: Prisma.InventoryItemWhereInput = {};

    if (filter.includeDeleted !== true) {
      where.deletedAt = null;
    }
    if (filter.category !== undefined) {
      where.category = filter.category;
    }
    if (filter.location !== undefined) {
      where.location = filter.location;
    }
    if (filter.unit !== undefined) {
      where.unit = filter.unit;
    }
    if (filter.status !== undefined) {
      where.status = filter.status;
    }

    /*
     * Both remaining filters are disjunctions, so they are collected into `AND` rather
     * than assigned to `where.OR`. Two independent filters writing to the same `OR` key
     * would silently overwrite each other, turning "low stock AND matching the search"
     * into just one of the two.
     */
    const conditions: Prisma.InventoryItemWhereInput[] = [];

    if (filter.search !== undefined && filter.search.trim().length > 0) {
      const search = filter.search.trim();
      conditions.push({
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { notes: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    /*
     * "Needs restocking" is `out of stock OR at/below a real threshold`.
     *
     * Uses a Prisma **field reference** to compare two columns, keeping the filter in
     * SQL. Doing it in memory would return fewer rows than the page size and report a
     * total that does not match the filter, so the paginator would offer empty pages.
     *
     * Mirrors `deriveStockStatus` exactly, including treating a zero threshold as
     * "unset" so untracked items are flagged only when they hit zero.
     */
    if (filter.needsRestocking === true) {
      conditions.push({
        OR: [
          { currentQuantity: { lte: 0 } },
          {
            minimumQuantity: { gt: 0 },
            currentQuantity: { lte: this.client.inventoryItem.fields.minimumQuantity },
          },
        ],
      });
    }

    if (conditions.length > 0) {
      where.AND = conditions;
    }

    return where;
  }

  private buildOrderBy(sort: InventoryItemSort): Prisma.InventoryItemOrderByWithRelationInput[] {
    // `name` is appended as a tiebreaker so paging is stable: without a deterministic
    // total order, rows with equal sort keys can appear on two pages or on none.
    return [{ [sort.field]: sort.direction }, { name: 'asc' }];
  }
}
