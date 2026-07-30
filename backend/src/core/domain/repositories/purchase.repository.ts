import type { Page, PageRequest } from '../../../shared/pagination.js';
import type { Purchase, PurchaseInvoiceFileProps } from '../entities/purchase.entity.js';
import type { InventoryCategory, InventoryUnit } from '../enums/inventory.enum.js';
import type { GstTreatment, PurchaseSortField } from '../enums/purchase.enum.js';

/**
 * What a line's stock goes into: an item that exists, or one to create.
 *
 * A discriminated union rather than an optional `itemId`, because the creation has to
 * happen **inside the purchase transaction**. Creating it beforehand and passing an id
 * would leave an orphaned inventory item behind whenever the purchase then failed — a
 * duplicate invoice number, a deadlock, a lost connection — and an item nobody asked for,
 * at zero quantity, is silent litter in the one list the user browses most.
 */
export type PurchaseLineTarget =
  | { readonly kind: 'existing'; readonly itemId: string }
  | { readonly kind: 'new'; readonly minimumQuantity: number };

/**
 * One line, fully priced.
 *
 * The tax amounts arrive already computed rather than being worked out in the repository:
 * the arithmetic is a domain rule (`Gst`), and a repository that recalculated it would be
 * a second place for the rounding to be wrong.
 *
 * `itemName`, `unit` and `category` are present for both kinds — for an existing item they
 * are the snapshot taken at invoice time, and for a new one they are what it is created
 * with.
 */
export interface CreatePurchaseLineData {
  readonly target: PurchaseLineTarget;
  readonly itemName: string;
  readonly unit: InventoryUnit;
  readonly category: InventoryCategory;

  readonly quantity: number;
  readonly unitRate: number;
  readonly hsnCode?: string | undefined;
  readonly gstRatePercent: number;

  readonly taxableAmount: number;
  readonly cgstAmount: number;
  readonly sgstAmount: number;
  readonly igstAmount: number;
  readonly lineTotal: number;
}

export interface CreatePurchaseData {
  readonly invoiceNumber: string;
  readonly invoiceDate: Date;

  readonly supplierId: string;
  readonly supplierGstin: string | null;
  readonly supplierStateCode: string;
  readonly gstTreatment: GstTreatment;

  readonly subtotal: number;
  readonly totalCgst: number;
  readonly totalSgst: number;
  readonly totalIgst: number;
  readonly totalTax: number;
  readonly totalAmount: number;

  readonly notes?: string | undefined;
  readonly recordedById: string | null;

  readonly lines: readonly CreatePurchaseLineData[];
}

/** What one line did to its item's stock, for reporting back to the client. */
export interface PurchaseStockEffect {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: InventoryUnit;
  readonly quantityBefore: number;
  readonly quantityAfter: number;
}

export interface PurchaseFilter {
  /** Matches invoice number and supplier name. */
  readonly search?: string | undefined;
  readonly supplierId?: string | undefined;
  readonly gstTreatment?: GstTreatment | undefined;
  /** Inclusive date bounds on `invoiceDate`. */
  readonly fromDate?: Date | undefined;
  readonly toDate?: Date | undefined;
  readonly hasInvoiceFile?: boolean | undefined;
}

export interface PurchaseSort {
  readonly field: PurchaseSortField;
  readonly direction: 'asc' | 'desc';
}

export interface PurchaseSummary {
  readonly purchaseCount: number;
  readonly totalValue: number;
  readonly totalTax: number;
  /** Invoices with no bill attached — the ones an auditor will ask about. */
  readonly missingInvoiceFiles: number;
}

/**
 * Port for purchase persistence.
 *
 * Note what is **absent**: there is no `update`. A purchase has already moved stock by the
 * time it exists, so editing one would let the invoice and the stock ledger disagree with
 * no record of which changed. The only mutation is attaching an invoice file, which
 * touches no financial field.
 */
export interface IPurchaseRepository {
  findById(id: string): Promise<Purchase | null>;
  findMany(filter: PurchaseFilter, page: PageRequest, sort: PurchaseSort): Promise<Page<Purchase>>;
  summary(filter: PurchaseFilter): Promise<PurchaseSummary>;

  /**
   * Records the invoice, **creates any new items**, and adds the stock — one transaction.
   *
   * The three must not be separable. A purchase row without its stock increase is an
   * invoice for goods the system says never arrived; stock without the purchase is
   * unexplained inventory; an item created for a purchase that then failed is litter.
   * Doing all of it under one commit is the only arrangement where a crash leaves none of
   * them.
   *
   * Implementations must lock the affected item rows in a deterministic order — the same
   * discipline the transfer legs follow — so two purchases touching the same item cannot
   * lose an update, and two touching overlapping items in different orders cannot
   * deadlock.
   *
   * Returns the per-item before/after so the client can report what changed without a
   * follow-up request per line.
   */
  create(data: CreatePurchaseData): Promise<{
    readonly purchase: Purchase;
    readonly effects: readonly PurchaseStockEffect[];
  }>;

  /** Whether this supplier already has an invoice with this number. */
  existsByInvoiceNumber(supplierId: string, invoiceNumber: string): Promise<boolean>;

  /**
   * Attaches or replaces the invoice file metadata.
   *
   * Returns the **stored name of the file it replaced**, or null if there was none, so the
   * caller can unlink the orphaned bytes. Just the name rather than the whole metadata:
   * that is all a deletion needs, and returning a full record would invite a caller to
   * treat a superseded file as if it were still retrievable.
   *
   * The repository deliberately does not touch the filesystem. Mixing a non-transactional
   * unlink into a database write means a rollback cannot put the file back.
   */
  attachInvoiceFile(id: string, file: PurchaseInvoiceFileProps): Promise<string | null>;
}
