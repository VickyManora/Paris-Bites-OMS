/** Mirrors the POS DTOs. */

import type { PbIconName } from '../../../shared/components/icon/icon-registry';

import type { BadgeTone } from '../../../shared/components/status-badge/status-badge.component';

export const OrderStatus = {
  DRAFT: 'DRAFT',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const PaymentMethod = {
  CASH: 'CASH',
  UPI: 'UPI',
  CARD: 'CARD',
} as const;

export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const DiscountType = {
  NONE: 'NONE',
  FLAT: 'FLAT',
  PERCENTAGE: 'PERCENTAGE',
} as const;

export type DiscountType = (typeof DiscountType)[keyof typeof DiscountType];

/**
 * Icon and tone per status, so every surface renders one the same way.
 *
 * ## Why this carries a tone rather than a class string
 *
 * It used to hold Tailwind classes, and they named theme roles: `tertiary-container` for paid,
 * `error-container` for cancelled. This app's palette is **rose**, so both of those are pink — a
 * paid order and a cancelled one rendered as near-identical pink chips on the orders list and in
 * the order dialog, separated only by the icon. `success` and `danger` are the design system's
 * fixed green and red, chosen outside the brand precisely so state never collides with it.
 *
 * Naming the *meaning* also means the two call sites no longer hand-build the pill geometry — they
 * pass this to `pb-status-badge`, whose own docstring already listed this map as one of the five
 * drifted copies it was written to replace.
 */
export const ORDER_STATUS_STYLE: Readonly<
  Record<OrderStatus, { readonly icon: PbIconName; readonly tone: BadgeTone }>
> = {
  DRAFT: { icon: 'edit', tone: 'neutral' },
  PENDING_PAYMENT: { icon: 'clock', tone: 'warning' },
  PAID: { icon: 'ok', tone: 'success' },
  CANCELLED: { icon: 'transferRejected', tone: 'danger' },
};

/**
 * What the counter may take: cash, or UPI against the printed QR.
 *
 * The store does not accept card, so it is not offered — and the API rejects it too, rather than
 * relying on this list being the only way to ask. `PaymentMethod` still *contains* `CARD`
 * because a stored payment may hold it and a past order has to remain readable; what may be
 * taken and what may be read are different questions.
 */
export const PAYMENT_METHODS: readonly {
  readonly value: PaymentMethod;
  readonly label: string;
  readonly icon: string;
}[] = [
  { value: PaymentMethod.CASH, label: 'Cash', icon: 'payments' },
  { value: PaymentMethod.UPI, label: 'UPI', icon: 'qr_code_2' },
];

export interface Product {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly price: number;
  readonly imageUrl: string | null;
  readonly isAvailable: boolean;
}

export interface MenuCategory {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly products: readonly Product[];
}

export interface OrderItem {
  readonly id: string;
  readonly productId: string;
  readonly productName: string;
  readonly unitPrice: number;
  readonly quantity: number;
  readonly lineTotal: number;
}

export interface OrderPayment {
  readonly id: string;
  readonly method: PaymentMethod;
  readonly methodLabel: string;
  readonly amount: number;
  readonly reference: string | null;
  readonly confirmedByName: string | null;
  readonly createdAt: string;
}

/**
 * How an order was paid, in one line.
 *
 * `Cash`, `Cash + UPI`, or `Unpaid`. The **methods only** — the amounts belong in the detail view,
 * where there is room to put each against its own figure, and a list column reading
 * "Cash ₹200.00 + UPI ₹247.00" would be wider than the product name beside it.
 *
 * Derived from `payments` rather than from `paymentMethod`, which the server sets to null for a
 * split by design. Reading that field alone is what made every split order show an em dash in the
 * orders list — the one place the new payment feature was visible and it said nothing.
 *
 * One definition, exported, so the list column and any future caller cannot word it differently.
 */
export function paymentSummaryOf(order: Pick<Order, 'payments'>): string {
  if (order.payments.length === 0) {
    return 'Unpaid';
  }

  // Ordered as taken. A cashier who keyed cash first reads it back the way they entered it.
  return order.payments.map((payment) => payment.methodLabel).join(' + ');
}

export interface Order {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly statusLabel: string;
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly subtotal: number;
  readonly discountType: DiscountType;
  readonly discountValue: number;
  readonly discountAmount: number;
  readonly discountReason: string | null;
  readonly grandTotal: number;
  readonly notes: string | null;
  readonly itemCount: number;
  readonly items: readonly OrderItem[];
  readonly summary: string;
  readonly payments: readonly OrderPayment[];
  readonly amountPaid: number;
  readonly amountDue: number;
  readonly paymentMethod: PaymentMethod | null;
  readonly paymentMethodLabel: string | null;
  readonly placedByName: string | null;
  readonly paidAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelledByName: string | null;
  readonly cancelReason: string | null;
  readonly createdAt: string;
}

export interface PosDaySummary {
  readonly date: string;
  readonly orderCount: number;
  readonly paidCount: number;
  readonly pendingCount: number;
  readonly cancelledCount: number;
  readonly pendingAmount: number;
  readonly itemsSold: number;

  /*
   * The day's takings, **absent for a caller without `POS_TAKINGS_READ`** — a Store Manager, today.
   *
   * Optional because the server omits them rather than sending zeros or nulls, so there is nothing
   * to hide client-side: the tiles that show these render only when the numbers arrived. `null` on
   * `averageOrderValue` is a different fact from absence — it means nothing has sold yet.
   */
  readonly revenue?: number;
  readonly averageOrderValue?: number | null;
  readonly byPaymentMethod?: Readonly<Record<PaymentMethod, number>>;
  /** `own` means these are the caller's takings, not the whole cart's. */
  readonly scope: 'all' | 'own';
}

/** One cart line. Prices are carried for display only — the server re-prices on submit. */
export interface CartLine {
  readonly product: Product;
  readonly quantity: number;
}

export interface PlaceOrderRequest {
  readonly lines: readonly { readonly productId: string; readonly quantity: number }[];
  readonly discountType: DiscountType;
  readonly discountValue: number;
  readonly discountReason?: string | undefined;
  readonly notes?: string | undefined;
  readonly customer?:
    { readonly name?: string | undefined; readonly phone?: string | undefined } | undefined;
  /**
   * One entry per tender the customer paid with.
   *
   * A split of one for the ordinary case — paying by cash alone is `[{ method: 'CASH', amount: total }]`
   * — so the client has no separate code path for "single method". The amounts must add up to the
   * order total, and the **server checks that**: it prices the order itself and refuses a set of
   * payments that does not match, so a wrong sum is a rejected order rather than a settled one that
   * is short.
   */
  readonly payments?: readonly OrderTenderRequest[] | undefined;
}

export interface OrderTenderRequest {
  readonly method: PaymentMethod;
  /** Rupees, at most two decimal places. */
  readonly amount: number;
  readonly reference?: string | undefined;
}

export interface OrderQuery {
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
  readonly search?: string | undefined;
  readonly fromDate?: string | undefined;
  readonly toDate?: string | undefined;
  readonly status?: OrderStatus | undefined;
  readonly paymentMethod?: PaymentMethod | undefined;
  readonly sortField?: 'createdAt' | 'grandTotal' | 'orderNumber' | undefined;
  readonly sortDirection?: 'asc' | 'desc' | undefined;
}

/**
 * The Store Manager discount ceiling, mirrored from the server.
 *
 * Used only to disable the control and explain why before a round trip — the server enforces
 * the real rule, and this copy existing does not make it authoritative.
 */
export const STORE_MANAGER_MAX_DISCOUNT_PERCENT = 20;
