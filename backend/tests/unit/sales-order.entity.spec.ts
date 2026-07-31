import { describe, expect, it } from 'vitest';
import {
  checkTenders,
  computeTotals,
  effectiveDiscountPercent,
  priceLines,
  SalesOrder,
  type PricedOrderLine,
} from '../../src/core/domain/entities/sales-order.entity.js';
import {
  canTransition,
  DiscountType,
  OrderStatus,
  PaymentMethod,
  STORE_MANAGER_MAX_DISCOUNT_PERCENT,
} from '../../src/core/domain/enums/pos.enum.js';
import { SalesChannel } from '../../src/core/domain/enums/sales.enum.js';

const MENU = {
  deathByChocolate: { productId: 'p1', productName: 'Death By Chocolate', unitPrice: 149 },
  nutellaBliss: { productId: 'p2', productName: 'Nutella Bliss', unitPrice: 239 },
};

describe('priceLines', () => {
  it('multiplies out each line', () => {
    const lines = priceLines([{ ...MENU.deathByChocolate, quantity: 2 }]);

    expect(lines[0]?.lineTotal).toBe(298);
  });

  /**
   * The snapshot is the point: repricing the menu next month must not rewrite tonight's
   * takings, so the name and price are copied onto the line rather than read through a
   * relation.
   */
  it('snapshots the name and price onto the line', () => {
    const lines = priceLines([{ ...MENU.deathByChocolate, quantity: 1 }]);

    expect(lines[0]?.productName).toBe('Death By Chocolate');
    expect(lines[0]?.unitPrice).toBe(149);
  });
});

describe('computeTotals', () => {
  const cart: PricedOrderLine[] = priceLines([
    { ...MENU.deathByChocolate, quantity: 2 },
    { ...MENU.nutellaBliss, quantity: 1 },
  ]);

  it('sums the lines', () => {
    expect(computeTotals(cart, DiscountType.NONE, 0).subtotal).toBe(537);
  });

  it('takes a percentage off', () => {
    const totals = computeTotals(cart, DiscountType.PERCENTAGE, 10);

    expect(totals.discountAmount).toBe(53.7);
    expect(totals.grandTotal).toBe(483.3);
  });

  it('takes a flat amount off', () => {
    const totals = computeTotals(cart, DiscountType.FLAT, 37);

    expect(totals.discountAmount).toBe(37);
    expect(totals.grandTotal).toBe(500);
  });

  /**
   * The failure this prevents: a ₹500 flat discount on a ₹300 order produces a negative
   * grand total, which every downstream sum then quietly absorbs — the day's revenue comes
   * out lower than it should and nothing looks broken.
   */
  it('never lets a discount exceed the subtotal', () => {
    const totals = computeTotals(cart, DiscountType.FLAT, 10_000);

    expect(totals.discountAmount).toBe(537);
    expect(totals.grandTotal).toBe(0);
  });

  it('ignores a negative discount', () => {
    const totals = computeTotals(cart, DiscountType.FLAT, -50);

    expect(totals.discountAmount).toBe(0);
    expect(totals.grandTotal).toBe(537);
  });

  it('keeps the arithmetic adding up on awkward percentages', () => {
    const single = priceLines([{ ...MENU.nutellaBliss, quantity: 3 }]);
    const totals = computeTotals(single, DiscountType.PERCENTAGE, 33);

    // 717 - 236.61 = 480.39, and the parts must reconstruct the whole exactly.
    expect(totals.subtotal).toBe(717);
    expect(totals.discountAmount).toBe(236.61);
    expect(totals.grandTotal).toBe(480.39);
    expect(totals.discountAmount + totals.grandTotal).toBe(totals.subtotal);
  });

  it('totals an empty cart to zero rather than throwing', () => {
    expect(computeTotals([], DiscountType.NONE, 0)).toEqual({
      subtotal: 0,
      comboDiscount: 0,
      discountAmount: 0,
      grandTotal: 0,
    });
  });

  it('takes the combo saving before the staff discount', () => {
    // Two KitKat bowls: 338 subtotal, 39 combo saving, then 10% of the remaining 299.
    const lines = priceLines([
      { productId: 'p1', productName: 'KitKat Break', unitPrice: 169, quantity: 2 },
    ]);

    const totals = computeTotals(lines, DiscountType.PERCENTAGE, 10, 39);

    expect(totals.subtotal).toBe(338);
    expect(totals.comboDiscount).toBe(39);
    // 10% of 299, not of 338 — the customer was never going to pay 338.
    expect(totals.discountAmount).toBe(29.9);
    expect(totals.grandTotal).toBe(269.1);
  });

  it('never lets a combo and a discount together exceed the order', () => {
    const lines = priceLines([
      { productId: 'p1', productName: 'KitKat Break', unitPrice: 169, quantity: 2 },
    ]);

    // A ₹500 flat discount on what is left after a ₹39 combo saving.
    const totals = computeTotals(lines, DiscountType.FLAT, 500, 39);

    expect(totals.grandTotal).toBe(0);
    expect(totals.comboDiscount + totals.discountAmount).toBe(totals.subtotal);
  });
});

describe('effectiveDiscountPercent', () => {
  /**
   * This is what the Store Manager ceiling is checked against, and why it exists: "₹200 off"
   * on a ₹250 order is an 80% discount however it was keyed in. A cap that only inspected
   * percentage discounts would be bypassed by typing the same reduction as a flat figure.
   */
  it('expresses a flat discount as a percentage', () => {
    expect(effectiveDiscountPercent(250, 200)).toBe(80);
  });

  it('exceeds the Store Manager ceiling for a large flat discount', () => {
    expect(effectiveDiscountPercent(250, 200)).toBeGreaterThan(
      STORE_MANAGER_MAX_DISCOUNT_PERCENT,
    );
  });

  it('stays within the ceiling for a small one', () => {
    expect(effectiveDiscountPercent(500, 50)).toBeLessThanOrEqual(
      STORE_MANAGER_MAX_DISCOUNT_PERCENT,
    );
  });

  it('is zero on an empty order rather than dividing by zero', () => {
    expect(effectiveDiscountPercent(0, 0)).toBe(0);
  });
});

describe('order status transitions', () => {
  it('lets the counter take payment', () => {
    expect(canTransition(OrderStatus.DRAFT, OrderStatus.PENDING_PAYMENT)).toBe(true);
    expect(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.PAID)).toBe(true);
  });

  /** The customer changing their mind at the QR is the most common abandonment. */
  it('lets an abandoned payment go back to the counter', () => {
    expect(canTransition(OrderStatus.PENDING_PAYMENT, OrderStatus.DRAFT)).toBe(true);
  });

  it('allows a paid order to be cancelled — a refund at the cart', () => {
    expect(canTransition(OrderStatus.PAID, OrderStatus.CANCELLED)).toBe(true);
  });

  it('treats cancelled as terminal', () => {
    expect(canTransition(OrderStatus.CANCELLED, OrderStatus.PAID)).toBe(false);
    expect(canTransition(OrderStatus.CANCELLED, OrderStatus.DRAFT)).toBe(false);
  });

  it('does not let a paid order go back to draft', () => {
    expect(canTransition(OrderStatus.PAID, OrderStatus.DRAFT)).toBe(false);
  });
});

describe('SalesOrder', () => {
  function makeOrder(overrides: Partial<Parameters<typeof SalesOrder.fromPersistence>[0]> = {}) {
    return SalesOrder.fromPersistence({
      id: 'order-1',
      orderNumber: 'PB-20260728-0001',
      channel: SalesChannel.WALK_IN,
      status: OrderStatus.PAID,
      // No combo unless a test says otherwise, which is what almost every order is.
      comboDiscountAmount: 0,
      comboCount: 0,
      customerId: null,
      customerName: null,
      customerPhone: null,
      subtotal: 537,
      discountType: DiscountType.NONE,
      discountValue: 0,
      discountAmount: 0,
      discountReason: null,
      grandTotal: 537,
      notes: null,
      placedById: 'manager-1',
      placedByName: 'Store Manager',
      paidAt: new Date('2026-07-28T14:05:00Z'),
      cancelledAt: null,
      cancelledByName: null,
      cancelReason: null,
      createdAt: new Date('2026-07-28T14:04:00Z'),
      updatedAt: new Date('2026-07-28T14:05:00Z'),
      items: [
        { id: 'i1', productId: 'p1', productName: 'Death By Chocolate', unitPrice: 149, quantity: 2, lineTotal: 298 },
        { id: 'i2', productId: 'p2', productName: 'Nutella Bliss', unitPrice: 239, quantity: 1, lineTotal: 239 },
      ],
      payments: [
        { id: 'pay-1', method: PaymentMethod.UPI, amount: 537, reference: null, confirmedByName: 'Store Manager', createdAt: new Date() },
      ],
      ...overrides,
    });
  }

  it('counts units, not lines', () => {
    // Three bowls across two kinds — "3 items" is what the counter says.
    expect(makeOrder().itemCount).toBe(3);
    expect(makeOrder().lineCount).toBe(2);
  });

  it('reports nothing owed once settled', () => {
    expect(makeOrder().amountPaid).toBe(537);
    expect(makeOrder().amountDue).toBe(0);
  });

  it('never reports a negative amount due when overpaid', () => {
    const order = makeOrder({
      payments: [
        { id: 'pay-1', method: PaymentMethod.CASH, amount: 600, reference: null, confirmedByName: null, createdAt: new Date() },
      ],
    });

    expect(order.amountDue).toBe(0);
  });

  it('adds up split payments', () => {
    const order = makeOrder({
      payments: [
        { id: 'pay-1', method: PaymentMethod.CASH, amount: 300, reference: null, confirmedByName: null, createdAt: new Date() },
        { id: 'pay-2', method: PaymentMethod.UPI, amount: 237, reference: null, confirmedByName: null, createdAt: new Date() },
      ],
    });

    expect(order.amountPaid).toBe(537);
    expect(order.amountDue).toBe(0);
    // Ambiguous by design: a split order has no single method to name.
    expect(order.paymentMethod).toBeNull();
  });

  it('names the method when there is only one', () => {
    expect(makeOrder().paymentMethod).toBe(PaymentMethod.UPI);
  });

  it('summarises the cart for a list row', () => {
    expect(makeOrder().summary).toBe('Death By Chocolate ×2, Nutella Bliss');
  });

  it('reports an unpaid order as owing the whole total', () => {
    const order = makeOrder({ status: OrderStatus.PENDING_PAYMENT, payments: [], paidAt: null });

    expect(order.isPaid).toBe(false);
    expect(order.amountDue).toBe(537);
  });
});

describe('checkTenders', () => {
  const cash = (amount: number) => ({ method: PaymentMethod.CASH, amount });
  const upi = (amount: number) => ({ method: PaymentMethod.UPI, amount });

  it('accepts a single tender covering the whole order', () => {
    expect(checkTenders([cash(447)], 447)).toBeNull();
  });

  it('accepts a split that adds up', () => {
    expect(checkTenders([cash(200), upi(247)], 447)).toBeNull();
  });

  /**
   * The case the paise comparison exists for.
   *
   * 149.90 + 297.10 is 447.00000000000006 in binary floating point, so a naive `===` against 447
   * rejects a split the cashier keyed correctly — at the counter, with a queue.
   */
  it('accepts amounts that only sum exactly in paise', () => {
    expect(checkTenders([cash(149.9), upi(297.1)], 447)).toBeNull();
  });

  it('rejects a split that is short', () => {
    expect(checkTenders([cash(200), upi(200)], 447)).toBe('DOES_NOT_MATCH_TOTAL');
  });

  /**
   * Overpayment is refused as firmly as underpayment.
   *
   * Not because taking more money is a problem, but because this system has no way to express it:
   * the payments would sum past the order and no row would say the difference was change. Tendered
   * and change are a separate feature — see the note in the payment sheet.
   */
  it('rejects a split that overpays', () => {
    expect(checkTenders([cash(500), upi(247)], 447)).toBe('DOES_NOT_MATCH_TOTAL');
  });

  it('rejects a payment a single paisa short', () => {
    expect(checkTenders([cash(200), upi(246.99)], 447)).toBe('DOES_NOT_MATCH_TOTAL');
  });

  it('rejects the same method twice', () => {
    expect(checkTenders([cash(200), cash(247)], 447)).toBe('DUPLICATE_METHOD');
  });

  it('rejects a zero tender', () => {
    expect(checkTenders([cash(447), upi(0)], 447)).toBe('NON_POSITIVE_AMOUNT');
  });

  it('rejects a negative tender, which would be a refund', () => {
    expect(checkTenders([cash(500), upi(-53)], 447)).toBe('NON_POSITIVE_AMOUNT');
  });

  /** An unpaid order is legitimate; it is simply not settled. */
  it('accepts no tenders only against a zero total', () => {
    expect(checkTenders([], 0)).toBeNull();
    expect(checkTenders([], 447)).toBe('DOES_NOT_MATCH_TOTAL');
  });
});
