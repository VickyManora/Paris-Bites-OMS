import type { Page, PageRequest } from '../../../shared/pagination.js';
import type { ConsumptionEntry } from '../entities/consumption-entry.entity.js';
import type { ConsumptionSortField } from '../enums/consumption.enum.js';
import type { InventoryLocation, InventoryUnit } from '../enums/inventory.enum.js';

/** One line as the caller wants it to end up. Quantity is in the item's own unit. */
export interface ConsumptionLineData {
  readonly itemId: string;
  readonly quantity: number;
  readonly notes?: string | undefined;
}

export interface CreateConsumptionData {
  readonly entryDate: Date;
  readonly location: InventoryLocation;
  readonly notes?: string | undefined;
  readonly recordedById: string | null;
  readonly lines: readonly ConsumptionLineData[];
}

/**
 * The complete desired state of an entry, not a patch.
 *
 * Lines are replaced wholesale rather than added and removed individually, because the
 * stock effect of an edit is a *diff* against what is currently recorded — and computing
 * that diff from a partial instruction would mean reconstructing the caller's intent.
 * "Here is what the sheet should say" is unambiguous; "remove line 2" is not.
 */
export interface UpdateConsumptionData {
  readonly entryDate: Date;
  readonly location: InventoryLocation;
  readonly notes?: string | undefined;
  readonly lines: readonly ConsumptionLineData[];
  readonly actorId: string | null;
  /** Why the correction was made. Optional, but recorded on the revision when given. */
  readonly note?: string | undefined;
}

export interface VoidConsumptionData {
  readonly actorId: string | null;
  /** Required. A reversal without a reason is not auditable. */
  readonly reason: string;
}

/**
 * What one item's stock did as a result of the operation.
 *
 * Returned so the caller can report "Dark Chocolate 5 → 3.8 kg" without a request per
 * line — the same shape purchases and transfers return.
 */
export interface ConsumptionStockEffect {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: InventoryUnit;
  readonly quantityBefore: number;
  readonly quantityAfter: number;
}

export interface ConsumptionResult {
  readonly entry: ConsumptionEntry;
  readonly effects: readonly ConsumptionStockEffect[];
}

export interface ConsumptionFilter {
  /** Free text over item names and the entry's notes. */
  readonly search?: string | undefined;
  readonly location?: InventoryLocation | undefined;
  readonly itemId?: string | undefined;
  readonly fromDate?: Date | undefined;
  readonly toDate?: Date | undefined;
  /** Defaults to false — voided entries are hidden unless asked for. */
  readonly includeVoided?: boolean | undefined;
}

export interface ConsumptionSort {
  readonly field: ConsumptionSortField;
  readonly direction: 'asc' | 'desc';
}

/** Totals for the same filter as the list, so the two cannot disagree. */
export interface ConsumptionSummary {
  readonly entryCount: number;
  readonly lineCount: number;
  readonly itemCount: number;
  readonly voidedCount: number;
}

/**
 * Port for consumption persistence, owned by the domain.
 *
 * Every mutating method moves stock **and** records it in one transaction. They are
 * shaped as whole operations rather than as a generic save for the same reason
 * `adjustQuantity` is: the row lock, the arithmetic and the history entry have to happen
 * together or the ledger stops reconstructing.
 */
export interface IConsumptionRepository {
  findById(id: string): Promise<ConsumptionEntry | null>;
  findMany(
    filter: ConsumptionFilter,
    page: PageRequest,
    sort: ConsumptionSort,
  ): Promise<Page<ConsumptionEntry>>;
  summary(filter: ConsumptionFilter): Promise<ConsumptionSummary>;

  /**
   * Records the sheet and deducts every line from stock.
   *
   * Throws `BusinessRuleError` if any line would take an item below zero — the whole
   * entry fails rather than recording part of a day's usage, because a half-applied
   * sheet is harder to notice and harder to correct than a rejected one.
   */
  record(data: CreateConsumptionData): Promise<ConsumptionResult>;

  /**
   * Replaces the entry's contents and applies the **difference** to stock.
   *
   * For each item the stock change is `previousQuantity - newQuantity`: consuming more
   * takes more off the shelf, consuming less puts some back, and an item dropped from the
   * sheet has its whole quantity returned. Appends a revision recording the change.
   */
  update(id: string, data: UpdateConsumptionData): Promise<ConsumptionResult>;

  /**
   * Reverses the entry, returning every line's stock, and marks it voided.
   *
   * The row survives so the stock increase is explicable. An entry that simply vanished
   * would leave an unattributed rise in the item history.
   */
  void(id: string, data: VoidConsumptionData): Promise<ConsumptionResult>;
}
