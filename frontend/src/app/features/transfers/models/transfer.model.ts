import type {
  InventoryCategory,
  InventoryLocation,
  InventoryUnit,
} from '../../inventory/models/inventory.model';

/**
 * Mirrors the stock transfer DTOs.
 *
 * The status labels and the `canApprove` / `canReject` / `canComplete` flags are **sent by
 * the server**, derived from the same transition table it enforces. Nothing here
 * re-implements the state machine, so the UI's available actions cannot drift from the ones
 * the API accepts.
 */

import type { BadgeTone } from '../../../shared/components/status-badge/status-badge.component';
export const StockTransferStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED',
} as const;

export type StockTransferStatus = (typeof StockTransferStatus)[keyof typeof StockTransferStatus];

/** Only for the status filter dropdown, which needs labels for values no row may have. */
export const TRANSFER_STATUS_LABELS: Readonly<Record<StockTransferStatus, string>> = {
  PENDING: 'Pending approval',
  APPROVED: 'In transit',
  REJECTED: 'Rejected',
  COMPLETED: 'Completed',
};

/**
 * The severity each transfer status carries, for the badge in the list.
 *
 * `APPROVED` is **info, not success**, because its label is "In transit": the goods have left and
 * have not arrived, which is a state to track rather than a job finished. `COMPLETED` is the green
 * one. Getting that pair the wrong way round would tell a manager the stock is on the shelf when it
 * is still in a van.
 */
export const TRANSFER_STATUS_TONES: Readonly<Record<StockTransferStatus, BadgeTone>> = {
  PENDING: 'warning',
  APPROVED: 'info',
  REJECTED: 'danger',
  COMPLETED: 'success',
};

export const TRANSFER_STATUS_OPTIONS = (
  Object.keys(TRANSFER_STATUS_LABELS) as StockTransferStatus[]
).map((value) => ({ value, label: TRANSFER_STATUS_LABELS[value] }));

export interface StockTransferLine {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly quantity: number;
  readonly unit: InventoryUnit;
  readonly unitAbbreviation: string;
  readonly category: InventoryCategory;
  readonly categoryLabel: string;
  readonly displayQuantity: string;
}

export interface StockTransfer {
  readonly id: string;
  readonly reference: string;
  readonly fromLocation: InventoryLocation;
  readonly fromLocationLabel: string;
  readonly toLocation: InventoryLocation;
  readonly toLocationLabel: string;
  readonly status: StockTransferStatus;
  readonly statusLabel: string;
  readonly notes: string | null;

  /** Server-derived: what this transfer can do next. */
  readonly canApprove: boolean;
  readonly canReject: boolean;
  readonly canComplete: boolean;
  readonly isInTransit: boolean;

  readonly lineCount: number;
  readonly lines: readonly StockTransferLine[];

  readonly requestedByName: string | null;
  readonly requestedAt: string;
  readonly reviewedByName: string | null;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
  readonly completedByName: string | null;
  readonly completedAt: string | null;
}

/** What a stock leg did to one item — returned by approve and complete. */
export interface TransferStockEffect {
  readonly itemId: string;
  readonly itemName: string;
  readonly quantityBefore: number;
  readonly quantityAfter: number;
}

export interface TransferResult {
  readonly transfer: StockTransfer;
  readonly effects: readonly TransferStockEffect[];
}

export interface TransferSummary {
  readonly pending: number;
  readonly inTransit: number;
  readonly completed: number;
  readonly rejected: number;
}

export interface CreateTransferLineRequest {
  readonly itemId: string;
  readonly quantity: number;
}

export interface CreateTransferRequest {
  readonly lines: readonly CreateTransferLineRequest[];
  readonly notes?: string;
}

export const TRANSFER_SORT_FIELDS = [
  'reference',
  'status',
  'requestedAt',
  'reviewedAt',
  'completedAt',
] as const;

export type TransferSortField = (typeof TRANSFER_SORT_FIELDS)[number];

export interface TransferQuery {
  readonly status?: StockTransferStatus;
  readonly search?: string;
  readonly page: number;
  readonly pageSize: number;
  readonly sortField: TransferSortField;
  readonly sortDirection: 'asc' | 'desc';
}
