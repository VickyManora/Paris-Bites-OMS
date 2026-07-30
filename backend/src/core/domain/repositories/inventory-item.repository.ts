import type { Page, PageRequest } from '../../../shared/pagination.js';
import type { InventoryItem, InventoryItemProps } from '../entities/inventory-item.entity.js';
import type {
  InventoryCategory,
  InventoryHistoryAction,
  InventoryItemStatus,
  InventoryLocation,
  InventoryUnit,
} from '../enums/inventory.enum.js';

/** `supplierName` is omitted: it is a read projection the repository resolves, not input. */
export type CreateInventoryItemData = Omit<
  InventoryItemProps,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'supplierName'
>;

/**
 * Fields a caller may change. Absent keys are left untouched.
 *
 * `currentQuantity` and `openingQuantity` are absent on purpose. Stock moves only
 * through `adjustQuantity`, and the opening figure is a statement about the moment
 * the item was set up — a later edit to it would be a rewrite of history, not a
 * correction.
 */
export type UpdateInventoryItemData = Partial<
  Pick<
    InventoryItemProps,
    | 'name'
    | 'category'
    | 'unit'
    | 'location'
    | 'minimumQuantity'
    | 'purchasePrice'
    | 'supplierId'
    | 'lowStockAlertEnabled'
    | 'batchNumber'
    | 'expiryDate'
    | 'status'
    | 'notes'
  >
>;

/** Sortable columns. A closed set, so a caller cannot sort by an unindexed column. */
export const INVENTORY_SORT_FIELDS = [
  'name',
  'category',
  'location',
  'currentQuantity',
  'minimumQuantity',
  'status',
  'updatedAt',
  'createdAt',
] as const;

export type InventorySortField = (typeof INVENTORY_SORT_FIELDS)[number];

export interface InventoryItemFilter {
  /** Free text over name and notes. */
  readonly search?: string | undefined;
  readonly category?: InventoryCategory | undefined;
  readonly location?: InventoryLocation | undefined;
  readonly unit?: InventoryUnit | undefined;
  readonly status?: InventoryItemStatus | undefined;
  /**
   * Restrict to items needing restocking.
   *
   * Applied in SQL by comparing two columns rather than filtering in memory: a
   * page-local filter would return fewer rows than the page size and make the
   * total count wrong.
   */
  readonly needsRestocking?: boolean | undefined;
  /** Defaults to false — soft-deleted rows are hidden unless asked for. */
  readonly includeDeleted?: boolean | undefined;
}

export interface InventoryItemSort {
  readonly field: InventorySortField;
  readonly direction: 'asc' | 'desc';
}

/**
 * The history entry written alongside a quantity change.
 *
 * Narrower than `CreateInventoryHistoryData`: `itemId` and the quantities are supplied
 * by the repository from the values it committed, so a caller cannot record an entry
 * that disagrees with the write it describes.
 */
export interface AdjustmentHistory {
  readonly action: InventoryHistoryAction;
  readonly note?: string | undefined;
  readonly actorId?: string | undefined;
}

/** Aggregate counts for dashboards and the list page header. */
export interface InventorySummary {
  readonly totalItems: number;
  readonly activeItems: number;
  readonly lowStockItems: number;
  readonly outOfStockItems: number;
  readonly byLocation: Readonly<Record<InventoryLocation, number>>;
}

/**
 * Port for inventory item persistence, owned by the domain and implemented in
 * `infrastructure/database/repositories`.
 */
export interface IInventoryItemRepository {
  findById(id: string): Promise<InventoryItem | null>;
  /** Case-insensitive, scoped to live rows — mirrors the partial unique index. */
  findByNameAndLocation(name: string, location: InventoryLocation): Promise<InventoryItem | null>;
  findMany(
    filter: InventoryItemFilter,
    page: PageRequest,
    sort: InventoryItemSort,
  ): Promise<Page<InventoryItem>>;
  create(data: CreateInventoryItemData): Promise<InventoryItem>;
  update(id: string, data: UpdateInventoryItemData): Promise<InventoryItem>;

  /**
   * Changes an item's quantity **and records its history entry in one transaction**.
   *
   * Shaped this way — rather than `setQuantity(id, value)` — for two reasons:
   *
   * 1. A stock adjustment is a read-modify-write. With a plain setter, two staff each
   *    removing 5 kg from 20 kg could both read 20 and both write 15, losing one
   *    withdrawal. The implementation locks the row so the second sees 15, not 20.
   *
   * 2. The quantity and its history entry must commit or fail together. Writing the
   *    history after the transaction means a crash, a timeout or an exhausted
   *    connection pool between the two leaves stock changed with no record of who
   *    changed it — which is precisely the failure an audit trail exists to prevent.
   *
   * `apply` receives the quantity read under the lock and the item's unit, so the caller
   * needs no separate read. It may throw — an over-withdrawal, a fractional count of a
   * discrete unit — and the transaction then rolls back with nothing written.
   *
   * `buildHistory` returns the entry to record, or `null` to record nothing (a stocktake
   * that confirms the existing figure is not a change).
   *
   * Throws `NotFoundError` if no live item has this id.
   */
  adjustQuantity(
    id: string,
    apply: (currentQuantity: number, unit: InventoryUnit) => number,
    buildHistory: (previousQuantity: number, nextQuantity: number) => AdjustmentHistory | null,
  ): Promise<{ item: InventoryItem; previousQuantity: number }>;
  /** Soft delete — stamps `deletedAt` rather than removing the row. */
  softDelete(id: string): Promise<void>;
  restore(id: string): Promise<InventoryItem>;
  summary(): Promise<InventorySummary>;

  /**
   * Every live item at or below its reorder level, unpaginated.
   *
   * Separate from `findMany({ needsRestocking: true })` because the alert scan wants the
   * whole set at once and a page would silently alert about the first 25 only. Both use
   * the same SQL predicate, so the scan and the list can never disagree about what "low"
   * means.
   *
   * Excludes items with alerts switched off — unlike the list and the reorder report,
   * which must keep showing them. Silencing an alert is a statement about being told,
   * not about the stock level.
   */
  findLowStockForAlert(): Promise<InventoryItem[]>;

  /**
   * Live items holding stock that expires on or before `date`.
   *
   * Items with no expiry never match — most of this inventory (bowls, spoons, stickers)
   * genuinely does not expire. Nor do items at zero: stock that does not exist cannot be
   * thrown away, and alerting on it would bury the cases where something is at risk.
   */
  findExpiringOnOrBefore(date: Date): Promise<InventoryItem[]>;
}
