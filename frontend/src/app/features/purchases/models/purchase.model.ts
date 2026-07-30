import type { InventoryCategory, InventoryUnit } from '../../inventory/models/inventory.model';

/**
 * Mirrors the purchase DTOs and vocabulary from the API.
 *
 * Every money figure the server sends is already computed and rounded — the client
 * re-derives totals only for the *live preview* in the record form, never for display of
 * something already saved. A filed invoice shows the numbers it was filed with.
 */

export const GstTreatment = {
  INTRA_STATE: 'INTRA_STATE',
  INTER_STATE: 'INTER_STATE',
  UNREGISTERED: 'UNREGISTERED',
} as const;

export type GstTreatment = (typeof GstTreatment)[keyof typeof GstTreatment];

export const GST_TREATMENT_LABELS: Readonly<Record<GstTreatment, string>> = {
  INTRA_STATE: 'Intra-state (CGST + SGST)',
  INTER_STATE: 'Inter-state (IGST)',
  UNREGISTERED: 'Unregistered supplier',
};

/** Compact form for a table cell, where the parenthetical would not fit. */
export const GST_TREATMENT_SHORT_LABELS: Readonly<Record<GstTreatment, string>> = {
  INTRA_STATE: 'CGST + SGST',
  INTER_STATE: 'IGST',
  UNREGISTERED: 'No GST',
};

export const GST_TREATMENT_OPTIONS = (Object.keys(GST_TREATMENT_LABELS) as GstTreatment[]).map(
  (value) => ({ value, label: GST_TREATMENT_LABELS[value] }),
);

/**
 * The GST rates that exist in India.
 *
 * A fixed list rather than a free number, because a typo'd 1.8% instead of 18% is a
 * ten-fold tax error nothing downstream would catch. The fractional rates are real —
 * 0.25% on rough diamonds, 1.5% on job work — so the list is the schedule, not a subset.
 */
export const GST_RATES: readonly number[] = [0, 0.25, 1.5, 3, 5, 12, 18, 28];

export interface PurchaseLine {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: InventoryUnit;
  readonly unitAbbreviation: string;
  readonly category: InventoryCategory;
  readonly categoryLabel: string;

  readonly quantity: number;
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

export interface PurchaseInvoiceFile {
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly uploadedAt: string;
  /** A relative API path — the storage adapter is not the client's business. */
  readonly downloadUrl: string;
}

export interface Purchase {
  readonly id: string;
  readonly invoiceNumber: string;
  /** `YYYY-MM-DD`. A calendar day — never parse it as local time. */
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

  readonly invoiceFile: PurchaseInvoiceFile | null;
  readonly hasInvoiceFile: boolean;

  readonly lineCount: number;
  readonly lines: readonly PurchaseLine[];

  readonly recordedByName: string | null;
  readonly createdAt: string;
}

export interface PurchaseSummary {
  readonly purchaseCount: number;
  readonly totalValue: number;
  readonly totalTax: number;
  readonly missingInvoiceFiles: number;
}

/** What one line did to stock, so the client can report it without a request per line. */
export interface PurchaseStockEffect {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: InventoryUnit;
  readonly quantityBefore: number;
  readonly quantityAfter: number;
}

export interface PurchaseResult {
  readonly purchase: Purchase;
  readonly effects: readonly PurchaseStockEffect[];
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface NewInventoryItemRequest {
  readonly name: string;
  readonly category: InventoryCategory;
  readonly unit: InventoryUnit;
  readonly minimumQuantity?: number;
}

/** Exactly one of `itemId` and `newItem`. Both, or neither, is rejected. */
export interface CreatePurchaseLineRequest {
  readonly itemId?: string;
  readonly newItem?: NewInventoryItemRequest;
  readonly quantity: number;
  readonly unitRate: number;
  readonly hsnCode?: string;
  readonly gstRatePercent: number;
}

export interface CreatePurchaseRequest {
  readonly supplierId: string;
  readonly invoiceNumber: string;
  /** `YYYY-MM-DD`. */
  readonly invoiceDate: string;
  readonly notes?: string;
  readonly lines: readonly CreatePurchaseLineRequest[];
}

export const PURCHASE_SORT_FIELDS = [
  'invoiceDate',
  'invoiceNumber',
  'supplierName',
  'totalAmount',
  'createdAt',
] as const;

export type PurchaseSortField = (typeof PURCHASE_SORT_FIELDS)[number];

export interface PurchaseQuery {
  readonly search?: string;
  readonly supplierId?: string;
  readonly gstTreatment?: GstTreatment;
  /** `YYYY-MM-DD`, inclusive. */
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly hasInvoiceFile?: boolean;
  readonly page: number;
  readonly pageSize: number;
  readonly sortField: PurchaseSortField;
  readonly sortDirection: 'asc' | 'desc';
}

// ---------------------------------------------------------------------------
// Live totals for the record form
// ---------------------------------------------------------------------------

export interface GstTotals {
  readonly subtotal: number;
  readonly cgst: number;
  readonly sgst: number;
  readonly igst: number;
  readonly tax: number;
  readonly total: number;
}

export const EMPTY_GST_TOTALS: GstTotals = {
  subtotal: 0,
  cgst: 0,
  sgst: 0,
  igst: 0,
  tax: 0,
  total: 0,
};

/** Currency scale. Money is never carried at more precision than it is paid at. */
function toMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The invoice totals a form should display *before* saving.
 *
 * This duplicates the server's arithmetic, which is a deliberate and bounded trade: a
 * purchase form that cannot show a running total until it is submitted is one the user
 * cannot check against the paper bill in their hand. The server remains authoritative —
 * what it returns is what is stored and displayed afterwards.
 *
 * Rounding happens **per line**, matching the server, because rounding only the total
 * would drift from the sum of the lines shown above it by a paisa or two — exactly the
 * discrepancy that makes someone distrust the whole screen.
 *
 * An unregistered supplier charges no tax regardless of the rates entered, so the rates
 * are ignored rather than applied and then zeroed.
 */
export function computeGstTotals(
  lines: readonly { quantity: number; unitRate: number; gstRatePercent: number }[],
  treatment: GstTreatment | null,
): GstTotals {
  let subtotal = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  for (const line of lines) {
    const quantity = Number.isFinite(line.quantity) ? line.quantity : 0;
    const rate = Number.isFinite(line.unitRate) ? line.unitRate : 0;
    const taxable = toMoney(quantity * rate);

    subtotal = toMoney(subtotal + taxable);

    if (treatment === null || treatment === GstTreatment.UNREGISTERED) {
      continue;
    }

    const gstRate = Number.isFinite(line.gstRatePercent) ? line.gstRatePercent : 0;
    const lineTax = toMoney((taxable * gstRate) / 100);

    if (treatment === GstTreatment.INTRA_STATE) {
      // Halved per line and rounded, so the two halves always re-add to the line's tax.
      const half = toMoney(lineTax / 2);
      cgst = toMoney(cgst + half);
      sgst = toMoney(sgst + (lineTax - half));
    } else {
      igst = toMoney(igst + lineTax);
    }
  }

  const tax = toMoney(cgst + sgst + igst);

  return { subtotal, cgst, sgst, igst, tax, total: toMoney(subtotal + tax) };
}

/**
 * Predicts the treatment from the supplier, mirroring `resolveGstTreatment` on the server.
 *
 * Used only to render the preview and to label the totals. The server decides what is
 * actually stored, from the supplier row rather than from anything the client sends.
 *
 * Unregistered wins over the state comparison: a supplier with no GSTIN charges no GST
 * even when they are next door.
 */
export function predictGstTreatment(
  supplierGstin: string | null,
  supplierStateCode: string,
  businessStateCode: string,
): GstTreatment {
  if (supplierGstin === null || supplierGstin.length === 0) {
    return GstTreatment.UNREGISTERED;
  }

  return supplierStateCode === businessStateCode
    ? GstTreatment.INTRA_STATE
    : GstTreatment.INTER_STATE;
}
