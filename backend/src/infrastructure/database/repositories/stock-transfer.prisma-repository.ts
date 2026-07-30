import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { StockTransfer } from '../../../core/domain/entities/stock-transfer.entity.js';
import { InventoryHistoryAction } from '../../../core/domain/enums/inventory.enum.js';
import { BusinessRuleError, NotFoundError } from '../../../core/domain/errors/domain-error.js';
import type {
  CreateStockTransferData,
  IStockTransferRepository,
  StockTransferFilter,
  StockTransferSort,
  TransferStockEffect,
  TransferSummary,
} from '../../../core/domain/repositories/stock-transfer.repository.js';
import { InventoryQuantity } from '../../../core/domain/value-objects/inventory-quantity.js';
import { createPage, toSkipTake, type Page, type PageRequest } from '../../../shared/pagination.js';
import { decimalToNumber } from '../mappers/inventory-item.prisma-mapper.js';
import {
  StockTransferPrismaMapper,
  TRANSFER_INCLUDE,
} from '../mappers/stock-transfer.prisma-mapper.js';

/** Row shape from the locking query in `approve`. */
interface LockedSourceRow {
  readonly id: string;
  readonly name: string;
  readonly current_quantity: string | number;
}

/**
 * Transaction settings shared by all three mutating operations.
 *
 * Raised from the defaults (2s wait / 5s timeout) because these transactions lock several
 * inventory rows at once: a second approval touching an overlapping item legitimately
 * queues, and the default would turn that wait into a failed request.
 */
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

export class StockTransferPrismaRepository implements IStockTransferRepository {
  constructor(private readonly client: PrismaClient) {}

  async findById(id: string): Promise<StockTransfer | null> {
    const row = await this.client.stockTransfer.findUnique({
      where: { id },
      include: TRANSFER_INCLUDE,
    });

    return row === null ? null : StockTransferPrismaMapper.toDomain(row);
  }

  async findByReference(reference: string): Promise<StockTransfer | null> {
    const row = await this.client.stockTransfer.findUnique({
      where: { reference },
      include: TRANSFER_INCLUDE,
    });

    return row === null ? null : StockTransferPrismaMapper.toDomain(row);
  }

  async findMany(
    filter: StockTransferFilter,
    page: PageRequest,
    sort: StockTransferSort,
  ): Promise<Page<StockTransfer>> {
    const where = this.buildWhere(filter);
    const { skip, take } = toSkipTake(page);

    // One transaction so the count and the slice describe the same snapshot.
    const [rows, total] = await this.client.$transaction([
      this.client.stockTransfer.findMany({
        where,
        include: TRANSFER_INCLUDE,
        skip,
        take,
        // `reference` as tiebreaker: without a deterministic total order, rows with equal
        // sort keys can appear on two pages or none.
        orderBy: [{ [sort.field]: sort.direction }, { reference: 'desc' }],
      }),
      this.client.stockTransfer.count({ where }),
    ]);

    return createPage(StockTransferPrismaMapper.toDomainList(rows), total, page);
  }

  /**
   * Per-status counts in a single round trip.
   *
   * Raw SQL rather than Prisma's `groupBy`, which on this stack (Prisma 7 with the pg driver
   * adapter) emits parameterless SQL while still binding a parameter and fails with
   * Postgres `08P01` — "bind message supplies 1 parameters, but prepared statement requires
   * 0". It broke every load of the transfers page. This is the same `count(*) FILTER` shape
   * the inventory summary already uses reliably.
   *
   * One statement, so all four figures describe the same snapshot.
   */
  async summary(): Promise<TransferSummary> {
    const rows = await this.client.$queryRaw<
      {
        pending: bigint;
        in_transit: bigint;
        completed: bigint;
        rejected: bigint;
      }[]
    >`
      SELECT
        count(*) FILTER (WHERE status = 'PENDING')   AS pending,
        count(*) FILTER (WHERE status = 'APPROVED')  AS in_transit,
        count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
        count(*) FILTER (WHERE status = 'REJECTED')  AS rejected
      FROM stock_transfers
    `;

    const row = rows[0];

    // An empty table still has to produce a valid summary.
    if (row === undefined) {
      return { pending: 0, inTransit: 0, completed: 0, rejected: 0 };
    }

    // Postgres `count()` is bigint, which Prisma surfaces as a JS BigInt — it must be
    // narrowed before it reaches JSON.stringify, which cannot serialise BigInt.
    return {
      pending: Number(row.pending),
      inTransit: Number(row.in_transit),
      completed: Number(row.completed),
      rejected: Number(row.rejected),
    };
  }

  /**
   * Creates a PENDING transfer with its lines. No stock moves.
   *
   * One transaction covering the reference allocation, the transfer and every line: a
   * transfer document with missing lines would be silently wrong, and a consumed reference
   * with no transfer would leave a gap nobody could explain.
   */
  async create(data: CreateStockTransferData): Promise<StockTransfer> {
    return this.client.$transaction(async (tx) => {
      /*
       * Source items are read inside the transaction so the snapshot stored on each line
       * matches what existed when the request was made. Availability is *not* enforced
       * here — a request may legitimately be raised for more than is currently on the
       * shelf, and approval is where it is checked against locked quantities.
       */
      const items = await tx.inventoryItem.findMany({
        where: {
          id: { in: data.lines.map((line) => line.itemId) },
          location: data.fromLocation,
          deletedAt: null,
        },
      });

      const byId = new Map(items.map((item) => [item.id, item]));
      const missing = data.lines.filter((line) => !byId.has(line.itemId));

      if (missing.length > 0) {
        throw new NotFoundError(
          `Inventory item at the source location`,
          missing.map((line) => line.itemId).join(', '),
        );
      }

      const reference = await this.nextReference(tx);

      const created = await tx.stockTransfer.create({
        data: {
          reference,
          fromLocation: data.fromLocation,
          toLocation: data.toLocation,
          status: 'PENDING',
          notes: data.notes ?? null,
          requestedById: data.requestedById,
          lines: {
            create: data.lines.map((line) => {
              const item = byId.get(line.itemId);

              if (item === undefined) {
                // Unreachable — the check above covers it. Present so the compiler can see
                // the value is defined without a non-null assertion.
                throw new NotFoundError('Inventory item', line.itemId);
              }

              return {
                itemId: line.itemId,
                quantity: line.quantity,
                itemName: item.name,
                unit: item.unit,
                category: item.category,
              };
            }),
          },
        },
        include: TRANSFER_INCLUDE,
      });

      return StockTransferPrismaMapper.toDomain(created);
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Approve and dispatch — deducts the source location.
   *
   * The whole operation is one transaction. In order:
   *
   * 1. Re-read the transfer and verify it is still `PENDING`. Checking again here closes the
   *    window between the use case's read and this write, where a second approver could
   *    have got there first.
   * 2. Lock every source row with `SELECT … FOR UPDATE`, **ordered by id**. A consistent
   *    lock order is what stops two overlapping transfers from deadlocking: without it, one
   *    could hold A waiting for B while the other holds B waiting for A.
   * 3. Re-check availability against the locked quantities, which are the only ones that
   *    cannot change underneath us.
   * 4. Deduct, record `TRANSFER_OUT` history per item, and update the transfer.
   *
   * Any failure rolls the whole thing back, so stock is never partially moved.
   */
  async approve(
    transferId: string,
    actorId: string,
    note?: string,
  ): Promise<{ transfer: StockTransfer; effects: readonly TransferStockEffect[] }> {
    return this.client.$transaction(async (tx) => {
      const transfer = await this.loadForUpdate(tx, transferId);
      transfer.assertCanApprove();

      const lines = transfer.lines;
      // Deterministic lock order — see step 2 above.
      const itemIds = [...new Set(lines.map((line) => line.itemId))].sort();

      const locked = await tx.$queryRaw<LockedSourceRow[]>`
        SELECT id::text AS id, name, current_quantity
        FROM inventory_items
        WHERE id = ANY(${itemIds}::uuid[]) AND deleted_at IS NULL
        ORDER BY id
        FOR UPDATE
      `;

      const available = new Map(
        locked.map((row) => [
          row.id,
          { name: row.name, quantity: decimalToNumber(row.current_quantity) },
        ]),
      );

      // Collect every shortfall before failing, so the user fixes all of them at once
      // rather than discovering them one approval at a time.
      const shortfalls: string[] = [];

      for (const line of lines) {
        const source = available.get(line.itemId);

        if (source === undefined) {
          shortfalls.push(`${line.itemName} (no longer available)`);
          continue;
        }

        if (source.quantity < line.quantity) {
          shortfalls.push(`${line.itemName} (need ${line.quantity}, have ${source.quantity})`);
        }
      }

      if (shortfalls.length > 0) {
        throw new BusinessRuleError(
          `Not enough stock at the source location: ${shortfalls.join('; ')}.`,
          { lines: shortfalls },
        );
      }

      const effects: TransferStockEffect[] = [];

      for (const line of lines) {
        const source = available.get(line.itemId);

        if (source === undefined) {
          throw new NotFoundError('Inventory item', line.itemId);
        }

        // Routed through the domain so the unit rules and rounding are the same ones the
        // manual adjust endpoint applies.
        const nextQuantity = InventoryQuantity.applyDelta(
          source.quantity,
          -line.quantity,
          line.unit,
        );

        await tx.inventoryItem.update({
          where: { id: line.itemId },
          data: { currentQuantity: nextQuantity },
        });

        await tx.inventoryItemHistory.create({
          data: {
            itemId: line.itemId,
            action: InventoryHistoryAction.TRANSFER_OUT,
            quantityBefore: source.quantity,
            quantityAfter: nextQuantity,
            note: `Transfer ${transfer.reference} dispatched`,
            actorId,
          },
        });

        effects.push({
          itemId: line.itemId,
          itemName: line.itemName,
          quantityBefore: source.quantity,
          quantityAfter: nextQuantity,
        });
      }

      const updated = await tx.stockTransfer.update({
        where: { id: transferId },
        data: {
          status: 'APPROVED',
          reviewedById: actorId,
          reviewedAt: new Date(),
          reviewNote: note ?? null,
        },
        include: TRANSFER_INCLUDE,
      });

      return { transfer: StockTransferPrismaMapper.toDomain(updated), effects };
    }, TRANSACTION_OPTIONS);
  }

  /** Rejects a pending transfer. No stock moves, so no locking is needed. */
  async reject(transferId: string, actorId: string, reason: string): Promise<StockTransfer> {
    return this.client.$transaction(async (tx) => {
      const transfer = await this.loadForUpdate(tx, transferId);
      transfer.assertCanReject();

      const updated = await tx.stockTransfer.update({
        where: { id: transferId },
        data: {
          status: 'REJECTED',
          reviewedById: actorId,
          reviewedAt: new Date(),
          reviewNote: reason,
        },
        include: TRANSFER_INCLUDE,
      });

      return StockTransferPrismaMapper.toDomain(updated);
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Complete — credits the destination location.
   *
   * Same transactional shape as `approve`. No availability check: the stock has already
   * left the source, so refusing to credit the destination would make it vanish.
   *
   * Destination items are created on demand. Transferring something the cart has never
   * stocked is the normal case the first time, and failing on it would make the feature
   * unusable. Lookup is case-insensitive on name and scoped to live rows, mirroring the
   * partial unique index.
   */
  async complete(
    transferId: string,
    actorId: string,
  ): Promise<{ transfer: StockTransfer; effects: readonly TransferStockEffect[] }> {
    return this.client.$transaction(async (tx) => {
      const transfer = await this.loadForUpdate(tx, transferId);
      transfer.assertCanComplete();

      const effects: TransferStockEffect[] = [];

      // Sorted by the snapshot name so concurrent completions take destination locks in a
      // consistent order, for the same deadlock reason as `approve`.
      const lines = [...transfer.lines].sort((a, b) => a.itemName.localeCompare(b.itemName));

      for (const line of lines) {
        const existing = await tx.inventoryItem.findFirst({
          where: {
            name: { equals: line.itemName, mode: 'insensitive' },
            location: transfer.toLocation,
            deletedAt: null,
          },
        });

        if (existing === null) {
          const created = await tx.inventoryItem.create({
            data: {
              name: line.itemName,
              category: line.category,
              unit: line.unit,
              location: transfer.toLocation,
              currentQuantity: line.quantity,
              // No reorder threshold: the system has no basis for one, and inventing a
              // number would produce a low-stock warning nobody configured.
              minimumQuantity: 0,
              status: 'ACTIVE',
              createdById: actorId,
            },
          });

          await tx.inventoryItemHistory.create({
            data: {
              itemId: created.id,
              action: InventoryHistoryAction.TRANSFER_IN,
              quantityBefore: 0,
              quantityAfter: line.quantity,
              note: `Created by transfer ${transfer.reference}`,
              actorId,
            },
          });

          effects.push({
            itemId: created.id,
            itemName: created.name,
            quantityBefore: 0,
            quantityAfter: line.quantity,
          });

          continue;
        }

        // Lock the existing destination row before reading its quantity for the increment.
        const locked = await tx.$queryRaw<LockedSourceRow[]>`
          SELECT id::text AS id, name, current_quantity
          FROM inventory_items
          WHERE id = ${existing.id}::uuid
          FOR UPDATE
        `;

        const row = locked[0];

        if (row === undefined) {
          throw new NotFoundError('Inventory item', existing.id);
        }

        const before = decimalToNumber(row.current_quantity);
        const after = InventoryQuantity.applyDelta(before, line.quantity, line.unit);

        await tx.inventoryItem.update({
          where: { id: existing.id },
          data: { currentQuantity: after },
        });

        await tx.inventoryItemHistory.create({
          data: {
            itemId: existing.id,
            action: InventoryHistoryAction.TRANSFER_IN,
            quantityBefore: before,
            quantityAfter: after,
            note: `Transfer ${transfer.reference} received`,
            actorId,
          },
        });

        effects.push({
          itemId: existing.id,
          itemName: existing.name,
          quantityBefore: before,
          quantityAfter: after,
        });
      }

      const updated = await tx.stockTransfer.update({
        where: { id: transferId },
        data: {
          status: 'COMPLETED',
          completedById: actorId,
          completedAt: new Date(),
        },
        include: TRANSFER_INCLUDE,
      });

      return { transfer: StockTransferPrismaMapper.toDomain(updated), effects };
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Loads a transfer inside a transaction with its row locked.
   *
   * The lock is what makes the subsequent status check meaningful: two approvers hitting the
   * same transfer at once would otherwise both read `PENDING` and both proceed, moving the
   * stock twice.
   */
  private async loadForUpdate(
    tx: Prisma.TransactionClient,
    transferId: string,
  ): Promise<StockTransfer> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM stock_transfers WHERE id = ${transferId}::uuid FOR UPDATE
    `;

    if (locked[0] === undefined) {
      throw new NotFoundError('Stock transfer', transferId);
    }

    const row = await tx.stockTransfer.findUnique({
      where: { id: transferId },
      include: TRANSFER_INCLUDE,
    });

    if (row === null) {
      throw new NotFoundError('Stock transfer', transferId);
    }

    return StockTransferPrismaMapper.toDomain(row);
  }

  /**
   * Next human-readable reference, from a Postgres sequence.
   *
   * A sequence rather than a row count: two concurrent creates would read the same count and
   * collide on the unique constraint. `nextval` is atomic.
   */
  private async nextReference(tx: Prisma.TransactionClient): Promise<string> {
    const rows = await tx.$queryRaw<{ value: bigint }[]>`
      SELECT nextval('stock_transfer_reference_seq') AS value
    `;

    const value = rows[0]?.value ?? 0n;
    return `TR-${String(value).padStart(6, '0')}`;
  }

  private buildWhere(filter: StockTransferFilter): Prisma.StockTransferWhereInput {
    const where: Prisma.StockTransferWhereInput = {};

    if (filter.status !== undefined) {
      where.status = filter.status;
    }
    if (filter.requestedById !== undefined) {
      where.requestedById = filter.requestedById;
    }

    if (filter.search !== undefined && filter.search.trim().length > 0) {
      const search = filter.search.trim();
      // Searching line snapshots as well as the reference, because "which transfer moved the
      // butter?" is the question people actually ask.
      where.OR = [
        { reference: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { lines: { some: { itemName: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    return where;
  }
}
