import type { SalesChannel } from '../enums/sales.enum.js';
import {
  canTransition,
  DiscountType,
  isRevenueStatus,
  ORDER_STATUS_LABELS,
  type OrderStatus,
  type PaymentMethod,
} from '../enums/pos.enum.js';
import { Money } from '../value-objects/money.js';

export interface SalesOrderItemProps {
  readonly id: string;
  readonly productId: string;
  /** Snapshot taken at the moment of sale, so a rename does not rewrite the past. */
  readonly productName: string;
  readonly unitPrice: number;
  readonly quantity: number;
  readonly lineTotal: number;
}

export interface PaymentProps {
  readonly id: string;
  readonly method: PaymentMethod;
  readonly amount: number;
  readonly reference: string | null;
  readonly confirmedByName: string | null;
  readonly createdAt: Date;
}

export interface SalesOrderProps {
  readonly id: string;
  readonly orderNumber: string;
  readonly channel: SalesChannel;
  readonly status: OrderStatus;

  readonly customerId: string | null;
  readonly customerName: string | null;
  readonly customerPhone: string | null;

  readonly subtotal: number;
  readonly discountType: DiscountType;
  readonly discountValue: number;
  readonly discountAmount: number;
  readonly discountReason: string | null;
  /** What the automatic "any 2" offers took off. Separate from the staff discount above. */
  readonly comboDiscountAmount: number;
  readonly comboCount: number;
  readonly grandTotal: number;

  readonly notes: string | null;

  readonly placedById: string | null;
  readonly placedByName: string | null;

  readonly paidAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancelledByName: string | null;
  readonly cancelReason: string | null;

  readonly createdAt: Date;
  readonly updatedAt: Date;

  readonly items: readonly SalesOrderItemProps[];
  readonly payments: readonly PaymentProps[];
}

/**
 * One order taken at the counter.
 *
 * The money rules live here rather than in the repository, so they can be tested with no
 * database and so every path that creates an order goes through the same arithmetic. The
 * server is the only thing that computes a total: a POS that accepts a browser-supplied
 * figure can be talked into any figure.
 */
export class SalesOrder {
  private constructor(private readonly props: SalesOrderProps) {}

  static fromPersistence(props: SalesOrderProps): SalesOrder {
    return new SalesOrder(props);
  }

  get id(): string {
    return this.props.id;
  }

  get orderNumber(): string {
    return this.props.orderNumber;
  }

  get channel(): SalesChannel {
    return this.props.channel;
  }

  get status(): OrderStatus {
    return this.props.status;
  }

  get statusLabel(): string {
    return ORDER_STATUS_LABELS[this.props.status];
  }

  get subtotal(): number {
    return this.props.subtotal;
  }

  get discountAmount(): number {
    return this.props.discountAmount;
  }

  get comboDiscountAmount(): number {
    return this.props.comboDiscountAmount;
  }

  get comboCount(): number {
    return this.props.comboCount;
  }

  get grandTotal(): number {
    return this.props.grandTotal;
  }

  get notes(): string | null {
    return this.props.notes;
  }

  get items(): readonly SalesOrderItemProps[] {
    return this.props.items;
  }

  get payments(): readonly PaymentProps[] {
    return this.props.payments;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get paidAt(): Date | null {
    return this.props.paidAt;
  }

  /** Total units, not lines — "3 items" means three bowls, not three kinds of bowl. */
  get itemCount(): number {
    return this.props.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  get lineCount(): number {
    return this.props.items.length;
  }

  get isPaid(): boolean {
    return isRevenueStatus(this.props.status);
  }

  get isCancelled(): boolean {
    return this.props.status === 'CANCELLED';
  }

  get hasDiscount(): boolean {
    return this.props.discountAmount > 0;
  }

  /** How much has actually been received, across split payments. */
  get amountPaid(): number {
    return round(this.props.payments.reduce((sum, payment) => sum + payment.amount, 0));
  }

  /** What is still owed. Zero once settled; never negative. */
  get amountDue(): number {
    return Math.max(0, round(this.props.grandTotal - this.amountPaid));
  }

  /** The method used, when there is exactly one. Null for a split or unpaid order. */
  get paymentMethod(): PaymentMethod | null {
    const methods = [...new Set(this.props.payments.map((payment) => payment.method))];
    return methods.length === 1 ? (methods[0] ?? null) : null;
  }

  /** e.g. "Death By Chocolate ×2, Oreo Licious" — for a list row. */
  get summary(): string {
    return this.props.items
      .map((item) => (item.quantity > 1 ? `${item.productName} ×${String(item.quantity)}` : item.productName))
      .join(', ');
  }

  canMoveTo(status: OrderStatus): boolean {
    return canTransition(this.props.status, status);
  }

  /** Snapshot for mappers. Callers must not mutate it. */
  toProps(): SalesOrderProps {
    return this.props;
  }
}

/** One line as submitted, before it is priced. */
export interface OrderLineRequest {
  readonly productId: string;
  readonly quantity: number;
}

/** A line resolved against the live product and priced. */
export interface PricedOrderLine {
  readonly productId: string;
  readonly productName: string;
  readonly unitPrice: number;
  readonly quantity: number;
  readonly lineTotal: number;
}

export interface OrderTotals {
  readonly subtotal: number;
  /** Taken off by the automatic "any 2" offers, before any staff discount. */
  readonly comboDiscount: number;
  /** The discretionary reduction a staff member gave. Subject to a reason and the role ceiling. */
  readonly discountAmount: number;
  readonly grandTotal: number;
}

/**
 * Prices a set of lines.
 *
 * Pure, and the only place a line total is produced. `unitPrice` comes from the product the
 * caller resolved — never from the request — and is snapshotted onto the line so repricing
 * the menu next month cannot rewrite tonight's takings.
 */
export function priceLines(
  lines: readonly { productId: string; productName: string; unitPrice: number; quantity: number }[],
): PricedOrderLine[] {
  return lines.map((line) => ({
    productId: line.productId,
    productName: line.productName,
    unitPrice: round(line.unitPrice),
    quantity: line.quantity,
    lineTotal: round(line.unitPrice * line.quantity),
  }));
}

/** One tender against an order: a method and what was paid with it. */
export interface OrderTender {
  readonly method: PaymentMethod;
  readonly amount: number;
}

/** Why a set of tenders is not acceptable, or `null` when it is. */
export type TenderProblem = 'DUPLICATE_METHOD' | 'NON_POSITIVE_AMOUNT' | 'DOES_NOT_MATCH_TOTAL';

/**
 * Checks the tenders a customer paid with against what the order is worth.
 *
 * A domain rule rather than a validator, because it is the same rule wherever a split is recorded —
 * at the counter, by an import, by a correction — and because it is about money rather than about
 * the shape of a request.
 *
 * Three ways a split can be wrong, and each is a different mistake:
 *
 * - **A repeated method.** Two cash rows on one order describe nothing a counter can mean, and they
 *   make the per-method totals in reporting ambiguous — is that one payment recorded twice, or two?
 * - **A non-positive amount.** A zero tender is a method the cashier selected and did not use; a
 *   negative one is a refund, which is a different flow with its own audit trail.
 * - **A sum that is not the total.** This is the one that matters: accepting it would mark an order
 *   PAID against less money than it is worth, and the shortfall would never appear anywhere — the
 *   order reads as settled and the day's takings are simply lower than the day's sales.
 *
 * ## Compared in paise
 *
 * `0.1 + 0.2 !== 0.3`, so comparing rupee floats would reject a legitimate 200 + 247 on some inputs
 * and accept a payment a paisa short on others. `Money.sum` adds as integer minor units and both
 * sides are rounded to the stored scale before the equality.
 *
 * Returns the problem rather than throwing, so the caller decides how it surfaces — the use case
 * raises a `BusinessRuleError` with the two figures in it, and a future importer might collect them.
 */
export function checkTenders(
  tenders: readonly OrderTender[],
  grandTotal: number,
): TenderProblem | null {
  if (new Set(tenders.map((tender) => tender.method)).size !== tenders.length) {
    return 'DUPLICATE_METHOD';
  }

  if (tenders.some((tender) => !(tender.amount > 0))) {
    return 'NON_POSITIVE_AMOUNT';
  }

  const tendered = Money.sum(tenders.map((tender) => tender.amount));

  return Money.round(tendered) === Money.round(grandTotal) ? null : 'DOES_NOT_MATCH_TOTAL';
}

/**
 * Totals an order.
 *
 * The discount is resolved to rupees here whichever way it was expressed, and **clamped to
 * the subtotal**: a ₹500 flat discount on a ₹300 order is a data-entry mistake, and letting
 * it through would produce a negative grand total that every downstream sum would then
 * quietly absorb.
 */
export function computeTotals(
  lines: readonly PricedOrderLine[],
  discountType: DiscountType,
  discountValue: number,
  /**
   * What the automatic "any 2" offers already took off, from `applyCombos`.
   *
   * Applied **before** the staff discount and clamped separately, which is what keeps the two
   * kinds of reduction from being confused for each other. A percentage discount then works on
   * what is actually still owed rather than on a subtotal the customer was never going to pay —
   * "10% off" on a combo order means 10% off the combo price, which is what anyone would expect
   * standing at the counter.
   *
   * Defaults to zero so every existing caller and test is unaffected.
   */
  comboDiscount = 0,
): OrderTotals {
  const subtotal = round(lines.reduce((sum, line) => sum + line.lineTotal, 0));

  const combo = round(Math.min(Math.max(comboDiscount, 0), subtotal));
  const afterCombo = round(subtotal - combo);

  const raw =
    discountType === DiscountType.PERCENTAGE
      ? (afterCombo * discountValue) / 100
      : discountType === DiscountType.FLAT
        ? discountValue
        : 0;

  // Clamped to what remains after the combo, so the two together can never exceed the order.
  const discountAmount = round(Math.min(Math.max(raw, 0), afterCombo));

  return {
    subtotal,
    comboDiscount: combo,
    discountAmount,
    grandTotal: round(afterCombo - discountAmount),
  };
}

/**
 * The discount as a percentage of the subtotal, whichever way it was entered.
 *
 * What the Store Manager ceiling is checked against. A flat "₹200 off" on a ₹250 order is an
 * 80% discount however it was keyed in, and a cap that only inspected percentages would be
 * bypassed by typing the same reduction as a flat figure.
 */
export function effectiveDiscountPercent(subtotal: number, discountAmount: number): number {
  return subtotal <= 0 ? 0 : round((discountAmount / subtotal) * 100);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
