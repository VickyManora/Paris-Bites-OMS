import type {
  InventoryCategory,
  InventoryUnit,
} from '../../domain/enums/inventory.enum.js';
import type { GstTreatment, PurchaseSortField } from '../../domain/enums/purchase.enum.js';
import type { PurchaseStockEffect } from '../../domain/repositories/purchase.repository.js';
import type { RequestContext } from './auth.dto.js';

export interface PurchaseLineDto {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: InventoryUnit;
  readonly unitAbbreviation: string;
  readonly category: InventoryCategory;
  readonly categoryLabel: string;

  readonly quantity: number;
  /** `12.5 kg` — a bare number invites reading kilograms as pieces. */
  readonly displayQuantity: string;
  readonly unitRate: number;
  readonly hsnCode: string | null;
  readonly gstRatePercent: number;

  readonly taxableAmount: number;
  readonly cgstAmount: number;
  readonly sgstAmount: number;
  readonly igstAmount: number;
  readonly lineTotal: number;
}

export interface PurchaseInvoiceFileDto {
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly uploadedAt: string;
  /**
   * Where to fetch the bytes. A relative API path, not a filesystem path or a signed
   * URL — the storage adapter is an implementation detail the client must not learn.
   */
  readonly downloadUrl: string;
}

export interface PurchaseDto {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly invoiceDate: string;

  readonly supplierId: string;
  readonly supplierName: string | null;
  readonly supplierGstin: string | null;
  readonly supplierStateCode: string;
  readonly supplierStateName: string;

  readonly gstTreatment: GstTreatment;
  readonly gstTreatmentLabel: string;

  readonly subtotal: number;
  readonly totalCgst: number;
  readonly totalSgst: number;
  readonly totalIgst: number;
  readonly totalTax: number;
  readonly totalAmount: number;

  readonly notes: string | null;

  readonly invoiceFile: PurchaseInvoiceFileDto | null;
  readonly hasInvoiceFile: boolean;

  readonly lineCount: number;
  readonly lines: readonly PurchaseLineDto[];

  readonly recordedByName: string | null;
  readonly createdAt: string;
}

export interface PurchaseSummaryDto {
  readonly purchaseCount: number;
  readonly totalValue: number;
  readonly totalTax: number;
  readonly missingInvoiceFiles: number;
}

/**
 * The purchase plus what it did to stock.
 *
 * Returned from create so the client can report "Almond flour 1500 → 2500 g" without a
 * follow-up request per line — the same shape the transfer legs return.
 */
export interface PurchaseResultDto {
  readonly purchase: PurchaseDto;
  readonly effects: readonly PurchaseStockEffect[];
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Details for an item that does not exist yet.
 *
 * Present so a bill can be entered in one pass. Discovering mid-invoice that an
 * ingredient was never set up, and having to leave for the inventory screen and come
 * back, is where data entry gets abandoned half-done.
 */
export interface NewInventoryItemInput {
  readonly name: string;
  readonly category: InventoryCategory;
  readonly unit: InventoryUnit;
  readonly minimumQuantity?: number | undefined;
}

/**
 * One line of the invoice being recorded.
 *
 * Exactly one of `itemId` and `newItem` must be set. Both, or neither, is a client bug
 * and is rejected rather than guessed at — silently preferring one would create a
 * duplicate item or price the wrong one.
 */
export interface CreatePurchaseLineInput {
  readonly itemId?: string | undefined;
  readonly newItem?: NewInventoryItemInput | undefined;
  readonly quantity: number;
  readonly unitRate: number;
  readonly hsnCode?: string | undefined;
  readonly gstRatePercent: number;
}

export interface CreatePurchaseInput extends RequestContext {
  readonly actorId: string;
  readonly supplierId: string;
  readonly invoiceNumber: string;
  readonly invoiceDate: Date;
  readonly notes?: string | undefined;
  readonly lines: readonly CreatePurchaseLineInput[];
}

export interface UploadPurchaseInvoiceInput extends RequestContext {
  readonly actorId: string;
  readonly id: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly bytes: Buffer;
}

export interface DownloadPurchaseInvoiceInput {
  readonly id: string;
}

export interface ListPurchasesInput {
  readonly search?: string | undefined;
  readonly supplierId?: string | undefined;
  readonly gstTreatment?: GstTreatment | undefined;
  readonly fromDate?: Date | undefined;
  readonly toDate?: Date | undefined;
  readonly hasInvoiceFile?: boolean | undefined;
  readonly page: number;
  readonly pageSize: number;
  readonly sortField: PurchaseSortField;
  readonly sortDirection: 'asc' | 'desc';
}
