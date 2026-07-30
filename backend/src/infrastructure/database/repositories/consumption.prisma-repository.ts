import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import { type ConsumptionEntry } from '../../../core/domain/entities/consumption-entry.entity.js';
import { ConsumptionRevisionAction } from '../../../core/domain/enums/consumption.enum.js';
import { InventoryHistoryAction } from '../../../core/domain/enums/inventory.enum.js';
import { BusinessRuleError, NotFoundError } from '../../../core/domain/errors/domain-error.js';
import type {
  ConsumptionFilter,
  ConsumptionResult,
  ConsumptionSort,
  ConsumptionStockEffect,
  ConsumptionSummary,
  CreateConsumptionData,
  IConsumptionRepository,
  UpdateConsumptionData,
  VoidConsumptionData,
} from '../../../core/domain/repositories/consumption.repository.js';
import { InventoryQuantity } from '../../../core/domain/value-objects/inventory-quantity.js';
import { createPage, toSkipTake, type Page, type PageRequest } from '../../../shared/pagination.js';
import {
  ConsumptionPrismaMapper,
  CONSUMPTION_ENTRY_INCLUDE,
  type ConsumptionEntryRow,
} from '../mappers/consumption.prisma-mapper.js';
import { decimalToNumber } from '../mappers/inventory-item.prisma-mapper.js';

/** Shape returned by the row-locking query. */
interface LockedItemRow {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly current_quantity: string | number;
}

/** A line resolved against the item it names, ready to be written. */
interface ResolvedLine {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string;
  readonly quantity: number;
  readonly notes: string | null;
}

type Tx = Prisma.TransactionClient;

/**
 * Consumption persistence.
 *
 * Every mutation follows the same three steps inside one transaction: lock the affected
 * inventory rows, apply the net change to each through the domain, then write the entry
 * and its history. The lock is what makes two people recording usage of the same
 * ingredient land on the right figure instead of one overwriting the other.
 */
export class ConsumptionPrismaRepository implements IConsumptionRepository {
  constructor(private readonly client: PrismaClient) {}

  async findById(id: string): Promise<ConsumptionEntry | null> {
    const row = await this.client.consumptionEntry.findUnique({
      where: { id },
      include: CONSUMPTION_ENTRY_INCLUDE,
    });

    return row === null ? null : ConsumptionPrismaMapper.toDomain(row);
  }

  async findMany(
    filter: ConsumptionFilter,
    page: PageRequest,
    sort: ConsumptionSort,
  ): Promise<Page<ConsumptionEntry>> {
    const where = this.buildWhere(filter);
    const { skip, take } = toSkipTake(page);

    // One transaction so the count and the slice describe the same snapshot.
    const [rows, total] = await this.client.$transaction([
      this.client.consumptionEntry.findMany({
        where,
        skip,
        take,
        orderBy: this.buildOrderBy(sort),
        include: CONSUMPTION_ENTRY_INCLUDE,
      }),
      this.client.consumptionEntry.count({ where }),
    ]);

    return createPage(
      ConsumptionPrismaMapper.toDomainList(rows as ConsumptionEntryRow[]),
      total,
      page,
    );
  }

  async summary(filter: ConsumptionFilter): Promise<ConsumptionSummary> {
    const where = this.buildWhere(filter);

    const [entryCount, voidedCount, lines] = await this.client.$transaction([
      this.client.consumptionEntry.count({ where }),
      this.client.consumptionEntry.count({ where: { ...where, deletedAt: { not: null } } }),
      this.client.consumptionLine.findMany({
        where: { entry: where },
        select: { itemId: true },
      }),
    ]);

    return {
      entryCount,
      lineCount: lines.length,
      // Distinct ingredients touched, which is the more useful figure of the two: forty
      // lines across five items is a different picture from forty across forty.
      itemCount: new Set(lines.map((line) => line.itemId)).size,
      voidedCount,
    };
  }

  async record(data: CreateConsumptionData): Promise<ConsumptionResult> {
    return this.client.$transaction(
      async (tx) => {
        const resolved = await this.resolveLines(tx, data.lines);

        // Negative because consumption takes stock off the shelf.
        const effects = await this.applyStockChanges(
          tx,
          new Map(resolved.map((line) => [line.itemId, -line.quantity])),
          data.recordedById,
          `Consumption ${this.formatDate(data.entryDate)}`,
        );

        const created = await tx.consumptionEntry.create({
          data: {
            entryDate: data.entryDate,
            location: data.location,
            notes: data.notes ?? null,
            recordedById: data.recordedById,
            lines: {
              create: resolved.map((line) => ({
                itemId: line.itemId,
                quantity: line.quantity,
                itemName: line.itemName,
                unit: line.unit as never,
                notes: line.notes,
              })),
            },
          },
          include: CONSUMPTION_ENTRY_INCLUDE,
        });

        await tx.consumptionEntryRevision.create({
          data: {
            entryId: created.id,
            revision: 1,
            action: ConsumptionRevisionAction.CREATED,
            snapshot: this.snapshotOf(resolved) as Prisma.InputJsonValue,
            actorId: data.recordedById,
          },
        });

        return {
          entry: ConsumptionPrismaMapper.toDomain(created),
          effects,
        };
      },
      this.transactionOptions(),
    );
  }

  async update(id: string, data: UpdateConsumptionData): Promise<ConsumptionResult> {
    return this.client.$transaction(
      async (tx) => {
        const existing = await tx.consumptionEntry.findUnique({
          where: { id },
          include: { lines: true },
        });

        if (existing === null || existing.deletedAt !== null) {
          throw new NotFoundError('Consumption entry', id);
        }

        const resolved = await this.resolveLines(tx, data.lines);

        /*
         * The stock change is the difference between what the sheet used to say and what
         * it says now, per item:
         *
         *   change = previouslyConsumed - nowConsumed
         *
         * Consuming more takes more off the shelf; consuming less puts some back; an item
         * dropped from the sheet has its whole quantity returned. Computing the diff — as
         * opposed to reversing everything and re-applying — means an unchanged line never
         * touches its item at all, so it writes no history and cannot fail on a stock
         * check it already passed.
         */
        const previous = new Map(
          existing.lines.map((line) => [line.itemId, decimalToNumber(line.quantity)]),
        );
        const next = new Map(resolved.map((line) => [line.itemId, line.quantity]));

        const changes = new Map<string, number>();

        for (const itemId of new Set([...previous.keys(), ...next.keys()])) {
          const change = (previous.get(itemId) ?? 0) - (next.get(itemId) ?? 0);

          if (change !== 0) {
            changes.set(itemId, change);
          }
        }

        const effects = await this.applyStockChanges(
          tx,
          changes,
          data.actorId,
          `Consumption ${this.formatDate(data.entryDate)} edited`,
        );

        // Replaced wholesale rather than diffed row by row: the stock effect is already
        // computed above, and rewriting the lines is the simplest way to land exactly the
        // state the caller asked for.
        await tx.consumptionLine.deleteMany({ where: { entryId: id } });

        const revision = existing.revision + 1;

        const updated = await tx.consumptionEntry.update({
          where: { id },
          data: {
            entryDate: data.entryDate,
            location: data.location,
            notes: data.notes ?? null,
            revision,
            lines: {
              create: resolved.map((line) => ({
                itemId: line.itemId,
                quantity: line.quantity,
                itemName: line.itemName,
                unit: line.unit as never,
                notes: line.notes,
              })),
            },
          },
          include: CONSUMPTION_ENTRY_INCLUDE,
        });

        await tx.consumptionEntryRevision.create({
          data: {
            entryId: id,
            revision,
            action: ConsumptionRevisionAction.UPDATED,
            snapshot: {
              ...this.snapshotOf(resolved),
              // The per-item movement, so the history reads as "Dark Chocolate 2.1 → 1.2"
              // rather than only showing the end state.
              changedItems: [...changes.keys()].map((itemId) => ({
                itemId,
                itemName:
                  resolved.find((line) => line.itemId === itemId)?.itemName ??
                  existing.lines.find((line) => line.itemId === itemId)?.itemName ??
                  'Unknown item',
                consumedBefore: previous.get(itemId) ?? 0,
                consumedAfter: next.get(itemId) ?? 0,
              })),
            },
            note: data.note ?? null,
            actorId: data.actorId,
          },
        });

        return {
          entry: ConsumptionPrismaMapper.toDomain(updated),
          effects,
        };
      },
      this.transactionOptions(),
    );
  }

  async void(id: string, data: VoidConsumptionData): Promise<ConsumptionResult> {
    return this.client.$transaction(
      async (tx) => {
        const existing = await tx.consumptionEntry.findUnique({
          where: { id },
          include: { lines: true },
        });

        if (existing === null) {
          throw new NotFoundError('Consumption entry', id);
        }

        // Idempotent by refusal rather than by silence: voiding twice would return the
        // stock twice, so the second attempt must fail loudly.
        if (existing.deletedAt !== null) {
          throw new BusinessRuleError('This entry has already been voided.');
        }

        // Positive: voiding puts every line's stock back.
        const effects = await this.applyStockChanges(
          tx,
          new Map(
            existing.lines.map((line) => [line.itemId, decimalToNumber(line.quantity)]),
          ),
          data.actorId,
          `Consumption ${this.formatDate(existing.entryDate)} voided`,
        );

        const revision = existing.revision + 1;

        const voided = await tx.consumptionEntry.update({
          where: { id },
          data: {
            deletedAt: new Date(),
            voidedById: data.actorId,
            voidReason: data.reason,
            revision,
          },
          include: CONSUMPTION_ENTRY_INCLUDE,
        });

        await tx.consumptionEntryRevision.create({
          data: {
            entryId: id,
            revision,
            action: ConsumptionRevisionAction.VOIDED,
            snapshot: {
              // The lines are kept on the row, so the snapshot records what was returned
              // rather than repeating them.
              returnedItems: existing.lines.map((line) => ({
                itemId: line.itemId,
                itemName: line.itemName,
                quantity: decimalToNumber(line.quantity),
                unit: line.unit,
              })),
            },
            note: data.reason,
            actorId: data.actorId,
          },
        });

        return {
          entry: ConsumptionPrismaMapper.toDomain(voided),
          effects,
        };
      },
      this.transactionOptions(),
    );
  }

  /**
   * Locks the affected inventory rows and applies each net change.
   *
   * `changes` maps item id to a **signed** quantity: negative consumes, positive returns.
   * Items are locked in one statement ordered by id, which is what stops two concurrent
   * entries touching the same pair of ingredients from deadlocking against each other.
   *
   * Arithmetic goes through `InventoryQuantity` so the unit rules and rounding match
   * every other path that changes a quantity — including the refusal to go below zero,
   * which is what rejects consuming more than is on the shelf.
   */
  private async applyStockChanges(
    tx: Tx,
    changes: ReadonlyMap<string, number>,
    actorId: string | null,
    note: string,
  ): Promise<ConsumptionStockEffect[]> {
    if (changes.size === 0) {
      return [];
    }

    const itemIds = [...changes.keys()].sort();

    const locked = await tx.$queryRaw<LockedItemRow[]>`
      SELECT id::text AS id, name, unit::text AS unit, current_quantity
      FROM inventory_items
      WHERE id = ANY(${itemIds}::uuid[]) AND deleted_at IS NULL
      ORDER BY id
      FOR UPDATE
    `;

    const current = new Map(locked.map((row) => [row.id, row]));
    const effects: ConsumptionStockEffect[] = [];

    for (const itemId of itemIds) {
      const row = current.get(itemId);

      if (row === undefined) {
        throw new NotFoundError('Inventory item', itemId);
      }

      const before = decimalToNumber(row.current_quantity);
      const change = changes.get(itemId) ?? 0;
      const unit = row.unit as never;

      let after: number;

      try {
        after = InventoryQuantity.applyDelta(before, change, unit);
      } catch (error) {
        // Re-thrown naming the ingredient. "Cannot remove 5 — only 3 in stock" is not
        // actionable on a sheet with six lines; "Dark Chocolate: …" is.
        if (error instanceof BusinessRuleError) {
          throw new BusinessRuleError(`${row.name}: ${error.message}`, error.details);
        }
        throw error;
      }

      await tx.inventoryItem.update({
        where: { id: itemId },
        data: { currentQuantity: after },
      });

      await tx.inventoryItemHistory.create({
        data: {
          itemId,
          action: InventoryHistoryAction.CONSUMED,
          // Taken from the values actually committed, so the entry cannot describe a
          // different change from the one that happened.
          quantityBefore: before,
          quantityAfter: after,
          note,
          actorId,
        },
      });

      effects.push({
        itemId,
        itemName: row.name,
        unit,
        quantityBefore: before,
        quantityAfter: after,
      });
    }

    return effects;
  }

  /**
   * Resolves each line against the item it names, snapshotting the name and unit.
   *
   * Rejects an unknown, deleted or inactive item here rather than letting the foreign key
   * do it, because the message needs to say which line is wrong.
   */
  private async resolveLines(
    tx: Tx,
    lines: readonly { itemId: string; quantity: number; notes?: string | undefined }[],
  ): Promise<ResolvedLine[]> {
    const itemIds = [...new Set(lines.map((line) => line.itemId))];

    const items = await tx.inventoryItem.findMany({
      where: { id: { in: itemIds }, deletedAt: null },
      select: { id: true, name: true, unit: true, status: true },
    });

    const byId = new Map(items.map((item) => [item.id, item]));

    return lines.map((line) => {
      const item = byId.get(line.itemId);

      if (item === undefined) {
        throw new NotFoundError('Inventory item', line.itemId);
      }

      if (item.status !== 'ACTIVE') {
        throw new BusinessRuleError(`${item.name} is inactive and cannot be consumed.`);
      }

      // Validated against the item's own unit, so "0.5 packets" is rejected rather than
      // stored — the same rule every other quantity path applies.
      const quantity = InventoryQuantity.normalise(line.quantity, item.unit, 'quantity');

      if (quantity <= 0) {
        throw new BusinessRuleError(`${item.name}: enter a quantity greater than zero.`, {
          quantity: ['Must be greater than zero.'],
        });
      }

      return {
        itemId: item.id,
        itemName: item.name,
        unit: item.unit,
        quantity,
        notes: line.notes?.trim() ?? null,
      };
    });
  }

  private snapshotOf(lines: readonly ResolvedLine[]): Record<string, unknown> {
    return {
      lines: lines.map((line) => ({
        itemId: line.itemId,
        itemName: line.itemName,
        quantity: line.quantity,
        unit: line.unit,
      })),
    };
  }

  /** `YYYY-MM-DD` from the UTC parts — the column is a DATE and means a calendar day. */
  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private transactionOptions(): { maxWait: number; timeout: number } {
    /*
     * Raised from the defaults for the same reason stock adjustments raise them: several
     * people recording usage at once is the expected case, not an error, and a waiting
     * transaction should queue and succeed rather than surface a 500.
     */
    return { maxWait: 10_000, timeout: 20_000 };
  }

  private buildWhere(filter: ConsumptionFilter): Prisma.ConsumptionEntryWhereInput {
    const where: Prisma.ConsumptionEntryWhereInput = {};

    if (filter.includeVoided !== true) {
      where.deletedAt = null;
    }
    if (filter.location !== undefined) {
      where.location = filter.location;
    }
    if (filter.itemId !== undefined) {
      where.lines = { some: { itemId: filter.itemId } };
    }

    if (filter.fromDate !== undefined || filter.toDate !== undefined) {
      where.entryDate = {
        ...(filter.fromDate !== undefined && { gte: filter.fromDate }),
        ...(filter.toDate !== undefined && { lte: filter.toDate }),
      };
    }

    if (filter.search !== undefined && filter.search.trim().length > 0) {
      const search = filter.search.trim();

      // The two things anyone searches a consumption log by: what was used, and whatever
      // was written on the sheet.
      where.OR = [
        { notes: { contains: search, mode: 'insensitive' } },
        { lines: { some: { itemName: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    return where;
  }

  private buildOrderBy(sort: ConsumptionSort): Prisma.ConsumptionEntryOrderByWithRelationInput[] {
    // `createdAt` as a tiebreaker: several entries share one date by design, and without
    // a deterministic total order a row can appear on two pages or on none.
    return [{ [sort.field]: sort.direction }, { createdAt: 'desc' }];
  }
}
