import type { Page, PageRequest } from '../../../shared/pagination.js';
import type { StockTransfer } from '../entities/stock-transfer.entity.js';
import type { InventoryLocation } from '../enums/inventory.enum.js';
import type { StockTransferStatus, TransferSortField } from '../enums/stock-transfer.enum.js';

/** One requested line. Quantities are validated against the item's unit before this. */
export interface CreateTransferLineData {
  readonly itemId: string;
  readonly quantity: number;
}

export interface CreateStockTransferData {
  readonly fromLocation: InventoryLocation;
  readonly toLocation: InventoryLocation;
  readonly requestedById: string;
  readonly notes?: string | undefined;
  readonly lines: readonly CreateTransferLineData[];
}

export interface StockTransferFilter {
  readonly status?: StockTransferStatus | undefined;
  /** Matches the reference, or any line's item name. */
  readonly search?: string | undefined;
  readonly requestedById?: string | undefined;
}

export interface StockTransferSort {
  readonly field: TransferSortField;
  readonly direction: 'asc' | 'desc';
}

/** What one stock leg did to one item, for history and for the response. */
export interface TransferStockEffect {
  readonly itemId: string;
  readonly itemName: string;
  readonly quantityBefore: number;
  readonly quantityAfter: number;
}

export interface TransferSummary {
  readonly pending: number;
  readonly inTransit: number;
  readonly completed: number;
  readonly rejected: number;
}

/**
 * Port for stock transfer persistence.
 *
 * The three mutating operations each run as **one database transaction** spanning the
 * transfer, its lines, the affected inventory items and their history. Partial application
 * is the failure mode that matters here: deducting the warehouse without recording the
 * transfer, or crediting the cart twice, both corrupt stock in ways nobody can reconstruct
 * afterwards.
 */
export interface IStockTransferRepository {
  findById(id: string): Promise<StockTransfer | null>;
  findByReference(reference: string): Promise<StockTransfer | null>;
  findMany(
    filter: StockTransferFilter,
    page: PageRequest,
    sort: StockTransferSort,
  ): Promise<Page<StockTransfer>>;
  summary(): Promise<TransferSummary>;

  /** Creates a PENDING transfer. No stock moves. */
  create(data: CreateStockTransferData): Promise<StockTransfer>;

  /**
   * Approves and dispatches: **deducts the source location** and marks the transfer
   * `APPROVED`.
   *
   * In one transaction it locks every source row (in a deterministic order, so two
   * concurrent approvals cannot deadlock), re-checks availability against the locked
   * quantities, writes the deductions, records a `TRANSFER_OUT` history entry per item, and
   * updates the transfer.
   *
   * Availability is re-checked here rather than only in the use case because the earlier
   * read is stale by the time the lock is taken — stock may have been consumed in between.
   *
   * @throws BusinessRuleError naming the short items if any line cannot be satisfied. The
   *   transaction rolls back, so a partially-applied transfer is impossible.
   */
  approve(
    transferId: string,
    actorId: string,
    note?: string,
  ): Promise<{ transfer: StockTransfer; effects: readonly TransferStockEffect[] }>;

  /** Rejects a pending transfer. No stock moves; the reason is mandatory. */
  reject(transferId: string, actorId: string, reason: string): Promise<StockTransfer>;

  /**
   * Completes: **credits the destination location** and marks the transfer `COMPLETED`.
   *
   * Creates the destination item when none exists yet — transferring an ingredient the cart
   * has never stocked is normal, and failing on it would make the feature unusable. The new
   * item inherits the line's unit and category snapshot with a zero reorder threshold.
   */
  complete(
    transferId: string,
    actorId: string,
  ): Promise<{ transfer: StockTransfer; effects: readonly TransferStockEffect[] }>;
}
