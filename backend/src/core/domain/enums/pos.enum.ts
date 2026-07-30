/**
 * Point-of-sale vocabulary.
 *
 * Domain-owned, bridged to Prisma's generated enums by exhaustive switches in the mapper
 * that stop compiling if the two diverge.
 */

export const OrderStatus = {
  /** Being built at the counter. Not yet money. */
  DRAFT: 'DRAFT',
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const ALL_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.DRAFT,
  OrderStatus.PENDING_PAYMENT,
  OrderStatus.PAID,
  OrderStatus.CANCELLED,
];

export const ORDER_STATUS_LABELS: Readonly<Record<OrderStatus, string>> = {
  [OrderStatus.DRAFT]: 'Draft',
  [OrderStatus.PENDING_PAYMENT]: 'Awaiting payment',
  [OrderStatus.PAID]: 'Paid',
  [OrderStatus.CANCELLED]: 'Cancelled',
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && Object.hasOwn(OrderStatus, value);
}

/**
 * Every method the system can *represent*.
 *
 * `CARD` is retained deliberately even though the store no longer takes card. It is a value
 * that a stored row may hold, so the type has to admit it — dropping it would leave the mapper
 * unable to read a payment the database is perfectly happy to return. What the counter may
 * *take* is a shorter list; see `ACCEPTED_PAYMENT_METHODS`.
 */
export const PaymentMethod = {
  CASH: 'CASH',
  UPI: 'UPI',
  CARD: 'CARD',
} as const;

export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

/**
 * What may be **taken** at the counter: cash, or UPI against the printed QR.
 *
 * This is the list the API validates new payments against, so a request naming any other
 * method is rejected rather than quietly recorded.
 *
 * Separate from `ALL_PAYMENT_METHODS` because reading and writing want different sets. Narrowing
 * the filter to this list too would make a card payment taken in the past unfindable, which is
 * a reporting bug rather than a policy.
 */
export const ACCEPTED_PAYMENT_METHODS: readonly PaymentMethod[] = [
  PaymentMethod.CASH,
  PaymentMethod.UPI,
];

/** Every representable method. For reading and filtering only — never for offering a choice. */
export const ALL_PAYMENT_METHODS: readonly PaymentMethod[] = [
  PaymentMethod.CASH,
  PaymentMethod.UPI,
  PaymentMethod.CARD,
];

export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  [PaymentMethod.CASH]: 'Cash',
  [PaymentMethod.UPI]: 'UPI',
  [PaymentMethod.CARD]: 'Card',
};

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && Object.hasOwn(PaymentMethod, value);
}

export const DiscountType = {
  NONE: 'NONE',
  FLAT: 'FLAT',
  PERCENTAGE: 'PERCENTAGE',
} as const;

export type DiscountType = (typeof DiscountType)[keyof typeof DiscountType];

export const ALL_DISCOUNT_TYPES: readonly DiscountType[] = [
  DiscountType.NONE,
  DiscountType.FLAT,
  DiscountType.PERCENTAGE,
];

/**
 * How much a Store Manager may take off an order.
 *
 * A ceiling, not a suggestion — enforced in the use case so it applies to any caller, not
 * just the POS screen. Twenty percent is generous enough for a goodwill gesture on a spoiled
 * order and tight enough that giving a friend a free bowl needs an admin.
 *
 * Expressed as a percentage even for flat discounts, which are converted before the check:
 * "₹200 off" on a ₹250 order is an 80% discount however it was keyed in, and a cap that only
 * looked at percentages would be trivially bypassed.
 */
export const STORE_MANAGER_MAX_DISCOUNT_PERCENT = 20;

/**
 * Which statuses a status may move to.
 *
 * A table rather than scattered conditionals, the same shape the transfer state machine
 * uses — and the same reason: the server's guards and the buttons the UI offers are then
 * derived from one declaration instead of drifting apart.
 */
const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.DRAFT]: [OrderStatus.PENDING_PAYMENT, OrderStatus.PAID, OrderStatus.CANCELLED],
  // Payment can be abandoned back to the counter — the customer changes their mind at the QR
  // more often than any other point in the flow.
  [OrderStatus.PENDING_PAYMENT]: [OrderStatus.PAID, OrderStatus.DRAFT, OrderStatus.CANCELLED],
  // A paid order can still be cancelled (a refund at the cart), which is admin-only.
  [OrderStatus.PAID]: [OrderStatus.CANCELLED],
  // Terminal.
  [OrderStatus.CANCELLED]: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses that count as money taken. Used by the day's figures. */
export function isRevenueStatus(status: OrderStatus): boolean {
  return status === OrderStatus.PAID;
}
