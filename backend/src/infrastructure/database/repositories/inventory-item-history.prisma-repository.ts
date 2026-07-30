import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type {
  CreateInventoryHistoryData,
  IInventoryItemHistoryRepository,
  InventoryHistoryEntry,
} from '../../../core/domain/repositories/inventory-item-history.repository.js';
import { createPage, toSkipTake, type Page, type PageRequest } from '../../../shared/pagination.js';
import {
  nullableDecimalToNumber,
  toDomainHistoryAction,
  toFieldChanges,
} from '../mappers/inventory-item.prisma-mapper.js';

/** The row shape returned when the actor is joined in. */
/**
 * The item relation is optional: only the activity feed joins it, and a per-item history
 * already knows which item it is showing.
 */
type HistoryRowWithActor = Prisma.InventoryItemHistoryGetPayload<{
  include: { actor: { select: { firstName: true; lastName: true } } };
}> & { readonly item?: { readonly name: string } | null };

export class InventoryItemHistoryPrismaRepository implements IInventoryItemHistoryRepository {
  constructor(private readonly client: PrismaClient) {}

  async record(data: CreateInventoryHistoryData): Promise<void> {
    await this.client.inventoryItemHistory.create({
      data: {
        itemId: data.itemId,
        action: data.action,
        quantityBefore: data.quantityBefore ?? null,
        quantityAfter: data.quantityAfter ?? null,
        /*
         * `changes` is a nested record, which Prisma's `InputJsonValue` cannot express
         * structurally. Routed through `unknown` rather than asserted directly: the
         * shape is JSON-serialisable by construction (only strings, numbers and null
         * reach it — see `toRecordable` in the update use case), so this is a limit of
         * the generated types, not an unchecked claim about the data.
         */
        changes: (data.changes ?? null) as unknown as Prisma.InputJsonValue,
        note: data.note ?? null,
        actorId: data.actorId ?? null,
      },
    });
  }

  async findByItem(itemId: string, page: PageRequest): Promise<Page<InventoryHistoryEntry>> {
    const { skip, take } = toSkipTake(page);

    const [rows, total] = await this.client.$transaction([
      this.client.inventoryItemHistory.findMany({
        where: { itemId },
        include: { actor: { select: { firstName: true, lastName: true } } },
        // Newest first: the most recent change is what someone opening a history is
        // almost always looking for. `id` breaks ties, because entries written in the
        // same millisecond would otherwise page unstably.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.client.inventoryItemHistory.count({ where: { itemId } }),
    ]);

    return createPage(
      rows.map((row) => this.toEntry(row)),
      total,
      page,
    );
  }

  async findRecent(limit: number): Promise<readonly InventoryHistoryEntry[]> {
    const rows = await this.client.inventoryItemHistory.findMany({
      // Deleted items are excluded: the dashboard shows current activity, and an entry
      // pointing at an item nobody can open is a dead end.
      where: { item: { deletedAt: null } },
      include: {
        actor: { select: { firstName: true, lastName: true } },
        // Joined only here. A per-item history already knows its item; the feed does not.
        item: { select: { name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });

    return rows.map((row) => this.toEntry(row));
  }

  private toEntry(row: HistoryRowWithActor): InventoryHistoryEntry {
    const actorName =
      row.actor === null ? null : `${row.actor.firstName} ${row.actor.lastName}`.trim();

    return {
      id: row.id,
      itemId: row.itemId,
      action: toDomainHistoryAction(row.action),
      quantityBefore: nullableDecimalToNumber(row.quantityBefore),
      quantityAfter: nullableDecimalToNumber(row.quantityAfter),
      changes: toFieldChanges(row.changes),
      note: row.note,
      actorId: row.actorId,
      actorName,
      itemName: row.item?.name ?? null,
      createdAt: row.createdAt,
    };
  }
}
