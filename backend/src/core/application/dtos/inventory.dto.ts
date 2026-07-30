import type {
  InventoryCategory,
  InventoryHistoryAction,
  InventoryItemStatus,
  InventoryLocation,
  InventoryUnit,
  StockStatus,
} from '../../domain/enums/inventory.enum.js';
import type { FieldChange } from '../../domain/repositories/inventory-item-history.repository.js';
import type {
  InventoryItemFilter,
  InventorySortField,
} from '../../domain/repositories/inventory-item.repository.js';
import type { RequestContext } from './auth.dto.js';

/**
 * Outbound representation of an inventory item.
 *
 * `stockStatus`, `needsRestocking`, `shortfall` and `displayQuantity` are **derived**
 * and sent to the client so the UI does not re-implement the low-stock rule. The
 * server stays the single definition of it.
 *
 * Dates are ISO strings because that is what crosses the wire.
 */
export interface InventoryItemDto {
  readonly id: string;
  readonly name: string;
  readonly category: InventoryCategory;
  readonly categoryLabel: string;
  readonly unit: InventoryUnit;
  readonly unitAbbreviation: string;
  readonly location: InventoryLocation;
  readonly locationLabel: string;
  readonly currentQuantity: number;
  readonly openingQuantity: number;
  readonly minimumQuantity: number;
  readonly purchasePrice: number | null;
  readonly supplierId: string | null;
  /** Resolved server-side so every consumer shows the same wording. */
  readonly supplierName: string | null;
  readonly lowStockAlertEnabled: boolean;
  readonly batchNumber: string | null;
  /** Date only, `YYYY-MM-DD` — expiry is a calendar day, not an instant. */
  readonly expiryDate: string | null;
  readonly status: InventoryItemStatus;
  readonly notes: string | null;

  readonly stockStatus: StockStatus;
  readonly needsRestocking: boolean;
  /**
   * Whether this item should actually raise an alert — `needsRestocking` filtered by
   * the item's own alert toggle and lifecycle. Sent separately so the UI can show a
   * silenced item as low on stock without also shouting about it.
   */
  readonly shouldAlertLowStock: boolean;
  readonly shortfall: number;
  readonly displayQuantity: string;
  /** `currentQuantity x purchasePrice`, or null when the item has no price. */
  readonly stockValue: number | null;

  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InventoryHistoryEntryDto {
  readonly id: string;
  readonly itemId: string;
  readonly action: InventoryHistoryAction;
  readonly actionLabel: string;
  readonly quantityBefore: number | null;
  readonly quantityAfter: number | null;
  /** Signed change, null for metadata-only edits. */
  readonly delta: number | null;
  readonly changes: Readonly<Record<string, FieldChange>> | null;
  readonly note: string | null;
  readonly actorName: string | null;
  readonly createdAt: string;
}

export interface InventorySummaryDto {
  readonly totalItems: number;
  readonly activeItems: number;
  readonly lowStockItems: number;
  readonly outOfStockItems: number;
  readonly byLocation: Readonly<Record<InventoryLocation, number>>;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateInventoryItemInput extends RequestContext {
  readonly actorId: string;
  readonly name: string;
  readonly category: InventoryCategory;
  readonly unit: InventoryUnit;
  readonly location: InventoryLocation;
  readonly currentQuantity: number;
  /**
   * Defaults to `currentQuantity` when omitted.
   *
   * At creation the two describe the same moment, so asking the user for both would
   * be asking the same question twice — but it stays overridable for an item being
   * entered after the fact, where the opening figure is not what is on the shelf now.
   */
  readonly openingQuantity?: number | undefined;
  readonly minimumQuantity: number;
  readonly purchasePrice?: number | undefined;
  readonly supplierId?: string | undefined;
  /** Defaults to true — an item is worth alerting on unless someone says otherwise. */
  readonly lowStockAlertEnabled?: boolean | undefined;
  readonly batchNumber?: string | undefined;
  /** Already parsed to midnight UTC by the validator. */
  readonly expiryDate?: Date | undefined;
  readonly status?: InventoryItemStatus | undefined;
  readonly notes?: string | undefined;
}

/**
 * Metadata edits only.
 *
 * `currentQuantity` is deliberately absent: stock levels change through
 * `AdjustInventoryQuantityUseCase`, which records a quantity-specific history entry
 * and is gated on a different permission. Allowing an edit form to silently
 * overwrite a stock level would make the history unreliable and bypass that gate.
 */
export interface UpdateInventoryItemInput extends RequestContext {
  readonly actorId: string;
  readonly id: string;
  readonly name?: string | undefined;
  readonly category?: InventoryCategory | undefined;
  readonly unit?: InventoryUnit | undefined;
  readonly location?: InventoryLocation | undefined;
  readonly minimumQuantity?: number | undefined;
  // `null` clears the field; `undefined` leaves it untouched.
  readonly purchasePrice?: number | null | undefined;
  readonly supplierId?: string | null | undefined;
  readonly lowStockAlertEnabled?: boolean | undefined;
  readonly batchNumber?: string | null | undefined;
  /** Already parsed to midnight UTC by the validator; null clears it. */
  readonly expiryDate?: Date | null | undefined;
  readonly status?: InventoryItemStatus | undefined;
  readonly notes?: string | null | undefined;
}

/**
 * Either a signed `delta` (add or remove) or an absolute `quantity` (a stocktake
 * correction) — never both. Enforced by the validator and re-checked in the use case.
 */
export interface AdjustInventoryQuantityInput extends RequestContext {
  readonly actorId: string;
  readonly id: string;
  readonly delta?: number | undefined;
  readonly quantity?: number | undefined;
  readonly note?: string | undefined;
}

export interface DeleteInventoryItemInput extends RequestContext {
  readonly actorId: string;
  readonly id: string;
}

export interface ListInventoryItemsInput {
  readonly filter: InventoryItemFilter;
  readonly page: number;
  readonly pageSize: number;
  readonly sortField: InventorySortField;
  readonly sortDirection: 'asc' | 'desc';
}

export interface GetInventoryHistoryInput {
  readonly itemId: string;
  readonly page: number;
  readonly pageSize: number;
}
