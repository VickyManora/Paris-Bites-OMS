import type { InventoryCategory, InventoryUnit } from '../enums/inventory.enum.js';
import { GstTreatment, stateNameFor } from '../enums/purchase.enum.js';

export interface PurchaseLineProps {
  readonly id: string;
  readonly itemId: string;
  /** Snapshot taken at invoice time — see the schema comment. */
  readonly itemName: string;
  readonly unit: InventoryUnit;
  readonly category: InventoryCategory;

  readonly quantity: number;
  readonly unitRate: number;
  readonly hsnCode: string | null;
  readonly gstRatePercent: number;

  readonly taxableAmount: number;
  readonly cgstAmount: number;
  readonly sgstAmount: number;
  readonly igstAmount: number;
  readonly lineTotal: number;
}

export interface PurchaseInvoiceFileProps {
  readonly fileName: string;
  readonly storedName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksum: string;
  readonly uploadedAt: Date;
}

export interface PurchaseProps {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly invoiceDate: Date;

  readonly supplierId: string;
  readonly supplierName: string | null;
  readonly supplierGstin: string | null;
  readonly supplierStateCode: string;
  readonly gstTreatment: GstTreatment;

  readonly subtotal: number;
  readonly totalCgst: number;
  readonly totalSgst: number;
  readonly totalIgst: number;
  readonly totalTax: number;
  readonly totalAmount: number;

  readonly notes: string | null;

  /** Null until a bill is uploaded. All-or-nothing — the database enforces it. */
  readonly invoiceFile: PurchaseInvoiceFileProps | null;

  readonly recordedById: string | null;
  readonly recordedByName: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  readonly lines: readonly PurchaseLineProps[];
}

/**
 * A recorded supplier invoice.
 *
 * Owns no state machine, which is the substantive difference from `StockTransfer`: a
 * purchase is not requested and approved, it is *recorded* after the fact. By the time a
 * row exists the goods have arrived and stock has already gone up, in the same
 * transaction.
 *
 * That is also why it is immutable. There are no mutators here and no update path in the
 * repository — a purchase that could be edited after moving stock would let the invoice
 * and the stock ledger disagree with no record of which changed. Corrections go through an
 * inventory adjustment, which is itself audited.
 */
export class Purchase {
  private constructor(private readonly props: PurchaseProps) {}

  static fromPersistence(props: PurchaseProps): Purchase {
    return new Purchase(props);
  }

  get id(): string {
    return this.props.id;
  }

  get invoiceNumber(): string {
    return this.props.invoiceNumber;
  }

  get invoiceDate(): Date {
    return this.props.invoiceDate;
  }

  get supplierId(): string {
    return this.props.supplierId;
  }

  get gstTreatment(): GstTreatment {
    return this.props.gstTreatment;
  }

  get supplierStateName(): string {
    return stateNameFor(this.props.supplierStateCode);
  }

  get totalAmount(): number {
    return this.props.totalAmount;
  }

  get lines(): readonly PurchaseLineProps[] {
    return this.props.lines;
  }

  get lineCount(): number {
    return this.props.lines.length;
  }

  get invoiceFile(): PurchaseInvoiceFileProps | null {
    return this.props.invoiceFile;
  }

  get hasInvoiceFile(): boolean {
    return this.props.invoiceFile !== null;
  }

  /** Whether any tax was charged. False for every unregistered-supplier purchase. */
  get hasTax(): boolean {
    return this.props.totalTax > 0;
  }

  get isIntraState(): boolean {
    return this.props.gstTreatment === GstTreatment.INTRA_STATE;
  }

  /**
   * Total units added to stock by this invoice.
   *
   * Summed across lines regardless of unit, so it is a document-level count for display
   * — "7 items" — and not a physical quantity. Mixing kg and pieces into one number would
   * be meaningless as a measure, which is why nothing derives stock from it.
   */
  get totalQuantity(): number {
    return this.props.lines.reduce((total, line) => total + line.quantity, 0);
  }

  toProps(): PurchaseProps {
    return this.props;
  }
}
