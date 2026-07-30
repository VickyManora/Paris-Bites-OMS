import type {
  InventoryCategory,
  InventoryLocation,
  InventoryUnit,
} from '../../domain/enums/inventory.enum.js';
import type {
  StockTransferStatus,
  TransferSortField,
} from '../../domain/enums/stock-transfer.enum.js';
import type { TransferStockEffect } from '../../domain/repositories/stock-transfer.repository.js';
import type { RequestContext } from './auth.dto.js';

export interface StockTransferLineDto {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly quantity: number;
  readonly unit: InventoryUnit;
  readonly unitAbbreviation: string;
  readonly category: InventoryCategory;
  readonly categoryLabel: string;
  /** `12.5 kg` — a bare number invites reading kilograms as pieces. */
  readonly displayQuantity: string;
}

export interface StockTransferDto {
  readonly id: string;
  readonly reference: string;
  readonly fromLocation: InventoryLocation;
  readonly fromLocationLabel: string;
  readonly toLocation: InventoryLocation;
  readonly toLocationLabel: string;
  readonly status: StockTransferStatus;
  readonly statusLabel: string;
  readonly notes: string | null;

  /** Derived so the UI does not re-implement the state machine. */
  readonly canApprove: boolean;
  readonly canReject: boolean;
  readonly canComplete: boolean;
  readonly isInTransit: boolean;

  readonly lineCount: number;
  readonly lines: readonly StockTransferLineDto[];

  readonly requestedByName: string | null;
  readonly requestedAt: string;
  readonly reviewedByName: string | null;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
  readonly completedByName: string | null;
  readonly completedAt: string | null;
}

export interface TransferSummaryDto {
  readonly pending: number;
  readonly inTransit: number;
  readonly completed: number;
  readonly rejected: number;
}

/**
 * The transfer plus what the stock legs actually did.
 *
 * Returned from approve and complete so the client can report the outcome — "Butter
 * 12.5 → 4.5 kg" — without a follow-up request per affected item.
 */
export interface TransferResultDto {
  readonly transfer: StockTransferDto;
  readonly effects: readonly TransferStockEffect[];
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateTransferLineInput {
  readonly itemId: string;
  readonly quantity: number;
}

export interface CreateStockTransferInput extends RequestContext {
  readonly actorId: string;
  readonly notes?: string | undefined;
  readonly lines: readonly CreateTransferLineInput[];
}

export interface ApproveTransferInput extends RequestContext {
  readonly actorId: string;
  readonly id: string;
  readonly note?: string | undefined;
}

export interface RejectTransferInput extends RequestContext {
  readonly actorId: string;
  readonly id: string;
  /** Mandatory: a refusal without a reason is not actionable. */
  readonly reason: string;
}

export interface CompleteTransferInput extends RequestContext {
  readonly actorId: string;
  readonly id: string;
}

export interface ListStockTransfersInput {
  readonly status?: StockTransferStatus | undefined;
  readonly search?: string | undefined;
  readonly page: number;
  readonly pageSize: number;
  readonly sortField: TransferSortField;
  readonly sortDirection: 'asc' | 'desc';
}
