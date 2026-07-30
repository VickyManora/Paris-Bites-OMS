import type { Page, PageRequest } from '../../../shared/pagination.js';
import type { InventoryHistoryAction } from '../enums/inventory.enum.js';

/** One before/after pair for a changed field. */
export interface FieldChange {
  readonly from: string | number | null;
  readonly to: string | number | null;
}

export interface InventoryHistoryEntry {
  readonly id: string;
  readonly itemId: string;
  readonly action: InventoryHistoryAction;
  readonly quantityBefore: number | null;
  readonly quantityAfter: number | null;
  readonly changes: Readonly<Record<string, FieldChange>> | null;
  readonly note: string | null;
  readonly actorId: string | null;
  /** Denormalised for display, so listing history needs no second query. */
  readonly actorName: string | null;
  /**
   * Likewise denormalised. Null only when the caller did not join the item — a per-item
   * history already knows which item it is showing, so it does not pay for the join.
   *
   * The activity feed does need it: "Consumed" without saying *what* was consumed is a
   * line nobody can act on.
   */
  readonly itemName: string | null;
  readonly createdAt: Date;
}

export interface CreateInventoryHistoryData {
  readonly itemId: string;
  readonly action: InventoryHistoryAction;
  readonly quantityBefore?: number | undefined;
  readonly quantityAfter?: number | undefined;
  readonly changes?: Readonly<Record<string, FieldChange>> | undefined;
  readonly note?: string | undefined;
  readonly actorId?: string | undefined;
}

/**
 * Append-only history for inventory items.
 *
 * There is deliberately no update or delete method: a history that can be rewritten
 * is not a record of anything.
 */
export interface IInventoryItemHistoryRepository {
  record(data: CreateInventoryHistoryData): Promise<void>;
  findByItem(itemId: string, page: PageRequest): Promise<Page<InventoryHistoryEntry>>;
  /** Recent activity across all items, for the dashboard. */
  findRecent(limit: number): Promise<readonly InventoryHistoryEntry[]>;
}
