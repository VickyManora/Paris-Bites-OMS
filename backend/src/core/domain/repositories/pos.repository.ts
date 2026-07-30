import type { Page, PageRequest } from '../../../shared/pagination.js';
import type { SalesOrder } from '../entities/sales-order.entity.js';
import type { DiscountType, OrderStatus, PaymentMethod } from '../enums/pos.enum.js';
import type { SalesChannel } from '../enums/sales.enum.js';

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ProductRow {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly price: number;
  readonly imageUrl: string | null;
  readonly isAvailable: boolean;
  readonly displayOrder: number;
}

export interface ProductCategoryRow {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly displayOrder: number;
  readonly products: readonly ProductRow[];
}

/**
 * Port for the sellable catalogue.
 *
 * Read-only for now. The POS needs the whole menu in one request — a dessert cart has
 * sixteen products, and paging a menu would cost a round trip per category for no benefit.
 */
export interface IProductRepository {
  /** Every live category with its products, in display order. */
  findMenu(includeUnavailable: boolean): Promise<readonly ProductCategoryRow[]>;

  /**
   * Prices a set of product ids.
   *
   * Returns only live, available products, so a caller can detect a missing one by
   * comparing counts — which is how an order for a withdrawn product is refused.
   */
  findForOrder(productIds: readonly string[]): Promise<readonly ProductRow[]>;

  setAvailability(id: string, isAvailable: boolean): Promise<ProductRow>;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface CreateOrderLineData {
  readonly productId: string;
  readonly productName: string;
  readonly unitPrice: number;
  readonly quantity: number;
  readonly lineTotal: number;
}

export interface CreateOrderData {
  readonly channel: SalesChannel;
  readonly status: OrderStatus;
  readonly subtotal: number;
  readonly discountType: DiscountType;
  readonly discountValue: number;
  readonly discountAmount: number;
  readonly discountReason: string | undefined;
  readonly grandTotal: number;
  readonly notes: string | undefined;
  readonly placedById: string;
  /**
   * Client-supplied key that makes a replayed placement safe. Absent for writes that have no
   * attempt to deduplicate, such as a seed.
   */
  readonly idempotencyKey: string | undefined;
  readonly lines: readonly CreateOrderLineData[];
  /** Absent for a guest. Matched on phone when given, so a regular is one row. */
  readonly customer: { readonly name: string | undefined; readonly phone: string | undefined } | undefined;
  /** Present when the order is paid in the same call — the common one-click path. */
  readonly payment:
    | { readonly method: PaymentMethod; readonly amount: number; readonly reference: string | undefined }
    | undefined;
}

export interface RecordPaymentData {
  readonly method: PaymentMethod;
  readonly amount: number;
  readonly reference: string | undefined;
  readonly confirmedById: string;
}

export type OrderSortField = 'createdAt' | 'grandTotal' | 'orderNumber';

export interface OrderFilter {
  readonly search?: string | undefined;
  readonly fromDate?: Date | undefined;
  readonly toDate?: Date | undefined;
  readonly status?: OrderStatus | undefined;
  readonly paymentMethod?: PaymentMethod | undefined;
  readonly channel?: SalesChannel | undefined;
  /**
   * Restricts to orders this user placed.
   *
   * How "today's orders" is scoped for someone without `POS_ORDER_READ_ALL`, applied in the
   * `where` clause rather than filtered afterwards so paging stays correct.
   */
  readonly placedById?: string | undefined;
  readonly sortField?: OrderSortField | undefined;
  readonly sortDirection?: 'asc' | 'desc' | undefined;
}

/** The POS home figures. Scoped to one day, and to one user when they lack read-all. */
export interface PosDaySummary {
  readonly date: string;
  readonly orderCount: number;
  readonly paidCount: number;
  readonly pendingCount: number;
  readonly cancelledCount: number;
  readonly revenue: number;
  readonly pendingAmount: number;
  readonly averageOrderValue: number | null;
  readonly byPaymentMethod: Readonly<Record<PaymentMethod, number>>;
  readonly itemsSold: number;
}

export interface IPosOrderRepository {
  /**
   * Writes the order, its lines, the customer and any payment in **one transaction**, and
   * allocates the order number inside it.
   *
   * One call rather than create-then-pay, because the counter's common path is a customer
   * handing over cash for a cart that is already totalled. Two round trips there would
   * double the slowest part of a ten-second order.
   */
  create(data: CreateOrderData): Promise<SalesOrder>;

  findById(id: string): Promise<SalesOrder | null>;
  findByNumber(orderNumber: string): Promise<SalesOrder | null>;

  /**
   * The order a previous attempt with this key already created, if there was one.
   *
   * Read before placing and again if the unique index rejects the insert, which is how two
   * taps landing at once resolve to one order instead of one order and one error.
   */
  findByIdempotencyKey(key: string): Promise<SalesOrder | null>;
  findMany(filter: OrderFilter, page: PageRequest): Promise<Page<SalesOrder>>;

  /** Adds a payment and settles the order when it covers the total. */
  recordPayment(id: string, data: RecordPaymentData): Promise<SalesOrder>;

  cancel(id: string, actorId: string, reason: string): Promise<SalesOrder>;

  summaryFor(day: Date, placedById: string | undefined): Promise<PosDaySummary>;
}
