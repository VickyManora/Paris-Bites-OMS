import {
  computeTotals,
  effectiveDiscountPercent,
  priceLines,
  type SalesOrder,
} from '../../../domain/entities/sales-order.entity.js';
import {
  DiscountType,
  OrderStatus,
  STORE_MANAGER_MAX_DISCOUNT_PERCENT,
  type PaymentMethod,
} from '../../../domain/enums/pos.enum.js';
import { Permission } from '../../../domain/enums/permission.enum.js';
import { SalesChannel } from '../../../domain/enums/sales.enum.js';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
} from '../../../domain/errors/domain-error.js';
import type { IAuditLogRepository } from '../../../domain/repositories/audit-log.repository.js';
import type {
  IPosOrderRepository,
  IProductRepository,
} from '../../../domain/repositories/pos.repository.js';
import type { RequestContext } from '../../dtos/auth.dto.js';
import type { OrderDto } from '../../dtos/pos.dto.js';
import { PosMapper } from '../../mappers/pos.mapper.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';

const ENTITY_TYPE = 'SalesOrder';

export const PosAuditAction = {
  ORDER_PLACED: 'pos.order.placed',
  PAYMENT_RECEIVED: 'pos.payment.received',
  ORDER_CANCELLED: 'pos.order.cancelled',
} as const;

/** Most units of one product on a single order. A guard against a stuck finger on `+`. */
const MAX_LINE_QUANTITY = 99;

/** Most distinct products on one order. A cart of a dessert stall does not exceed this. */
const MAX_LINES = 40;

export interface PlaceOrderLineInput {
  readonly productId: string;
  readonly quantity: number;
}

export interface PlaceOrderInput extends RequestContext {
  readonly actorId: string;
  readonly permissions: readonly Permission[];
  readonly lines: readonly PlaceOrderLineInput[];
  readonly discountType: DiscountType;
  readonly discountValue: number;
  readonly discountReason?: string | undefined;
  readonly notes?: string | undefined;
  readonly customer?: { readonly name?: string | undefined; readonly phone?: string | undefined } | undefined;
  /**
   * Present when the money is already in hand — cash taken, or UPI confirmed on the phone.
   *
   * Optional so the counter can also total an order and leave it awaiting payment while the
   * customer finds their wallet.
   */
  readonly payment?:
    | { readonly method: PaymentMethod; readonly reference?: string | undefined }
    | undefined;
  /**
   * Per-attempt key from the client, held across its retries.
   *
   * Absent when the caller did not send one, which keeps this endpoint usable by anything that
   * has no retry story of its own.
   */
  readonly idempotencyKey?: string | undefined;
}

/**
 * Takes an order.
 *
 * Three things this owns, and none of them can be moved to the client:
 *
 * **Pricing.** The request carries product ids and quantities — never prices. Every line is
 * priced from the live product row and the price is snapshotted onto the line. A POS that
 * accepts a browser-supplied total can be talked into any total.
 *
 * **The discount ceiling.** A Store Manager may take at most
 * `STORE_MANAGER_MAX_DISCOUNT_PERCENT` off; an admin is unlimited. Checked against the
 * *effective* percentage, so keying "₹200 off" on a ₹250 order is caught the same way "80%"
 * would be.
 *
 * **Status.** An order arrives paid only if a payment came with it, so unbacked revenue
 * cannot be asserted into the day's figures.
 *
 * A fourth property is owned jointly with the database: **placing an order twice with the same
 * `idempotencyKey` places it once.** The counter runs on mobile data, where a reply can be lost
 * after the write succeeded, and the natural reaction to that error is another tap.
 */
export class PlaceOrderUseCase implements IUseCase<PlaceOrderInput, OrderDto> {
  constructor(
    private readonly orders: IPosOrderRepository,
    private readonly products: IProductRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: PlaceOrderInput): Promise<OrderDto> {
    /*
     * A replay returns the original order and writes nothing.
     *
     * Deliberately before any validation: a retry of an order the server already took must
     * succeed even if the menu changed underneath it in the meantime. Re-pricing it would
     * either fail on a since-sold-out product or, worse, answer with a different total than
     * the one the customer already paid.
     *
     * No audit entry and no second log line either — one order happened, and a trail claiming
     * two would misreport the day.
     */
    if (input.idempotencyKey !== undefined) {
      const existing = await this.orders.findByIdempotencyKey(input.idempotencyKey);

      if (existing !== null) {
        this.logger.info('POS order placement replayed', {
          orderId: existing.id,
          orderNumber: existing.orderNumber,
          actorId: input.actorId,
        });

        return PosMapper.toOrderDto(existing);
      }
    }

    const lines = this.normaliseLines(input.lines);
    const resolved = await this.products.findForOrder(lines.map((line) => line.productId));
    const byId = new Map(resolved.map((product) => [product.id, product]));

    /*
     * Every product must exist and be available *now*.
     *
     * Named rather than reported as a count: a bowl that sold out while the order was being
     * built is the realistic case, and "Nutella Bliss is no longer available" tells the
     * person at the counter what to tell the customer.
     */
    const missing = lines.filter((line) => !byId.has(line.productId));

    if (missing.length > 0) {
      throw new BusinessRuleError(
        `${String(missing.length)} item${missing.length === 1 ? '' : 's'} on this order ${missing.length === 1 ? 'is' : 'are'} no longer available. Remove ${missing.length === 1 ? 'it' : 'them'} and try again.`,
        { lines: ['One or more products are unavailable.'] },
      );
    }

    const priced = priceLines(
      lines.map((line) => {
        const product = byId.get(line.productId);

        if (product === undefined) {
          throw new NotFoundError('Product', line.productId);
        }

        return {
          productId: product.id,
          productName: product.name,
          // From the product row, never the request.
          unitPrice: product.price,
          quantity: line.quantity,
        };
      }),
    );

    const totals = computeTotals(priced, input.discountType, input.discountValue);
    const reason = input.discountReason?.trim();

    if (totals.discountAmount > 0) {
      // A reduction with no stated reason is indistinguishable from undercharging a friend.
      if (reason === undefined || reason.length === 0) {
        throw new BusinessRuleError('Say why the discount is being given.', {
          discountReason: ['A reason is required for any discount.'],
        });
      }

      const percent = effectiveDiscountPercent(totals.subtotal, totals.discountAmount);

      if (
        percent > STORE_MANAGER_MAX_DISCOUNT_PERCENT &&
        !input.permissions.includes(Permission.POS_DISCOUNT_UNLIMITED)
      ) {
        throw new ForbiddenError(
          `That discount is ${String(percent)}% of the order. You may give up to ${String(STORE_MANAGER_MAX_DISCOUNT_PERCENT)}% — ask an administrator for more.`,
        );
      }
    }

    const order = await this.orders.create({
      channel: SalesChannel.WALK_IN,
      status: OrderStatus.PENDING_PAYMENT,
      subtotal: totals.subtotal,
      discountType: input.discountType,
      discountValue: input.discountType === DiscountType.NONE ? 0 : input.discountValue,
      discountAmount: totals.discountAmount,
      discountReason: totals.discountAmount > 0 ? reason : undefined,
      grandTotal: totals.grandTotal,
      notes: input.notes?.trim(),
      placedById: input.actorId,
      idempotencyKey: input.idempotencyKey,
      lines: priced,
      customer:
        input.customer === undefined
          ? undefined
          : { name: input.customer.name, phone: input.customer.phone },
      payment:
        input.payment === undefined
          ? undefined
          : {
              method: input.payment.method,
              // The server's total, not a client-supplied amount.
              amount: totals.grandTotal,
              reference: input.payment.reference?.trim(),
            },
    });

    await this.auditLog.record({
      actorId: input.actorId,
      action: PosAuditAction.ORDER_PLACED,
      entityType: ENTITY_TYPE,
      entityId: order.id,
      ip: input.ipAddress,
      metadata: {
        orderNumber: order.orderNumber,
        itemCount: order.itemCount,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        grandTotal: totals.grandTotal,
        paid: input.payment !== undefined,
        ...(totals.discountAmount > 0 ? { discountReason: reason } : {}),
      },
    });

    this.logger.info('POS order placed', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      grandTotal: totals.grandTotal,
      paid: input.payment !== undefined,
      actorId: input.actorId,
    });

    return PosMapper.toOrderDto(order);
  }

  /**
   * Collapses duplicate products and bounds the quantities.
   *
   * Tapping a card twice is the normal way to order two bowls, and the client sends the
   * merged cart — but a caller that sends the same product twice gets them added rather than
   * hitting the unique index on (order, product) at the database.
   */
  private normaliseLines(lines: readonly PlaceOrderLineInput[]): PlaceOrderLineInput[] {
    if (lines.length === 0) {
      throw new BusinessRuleError('Add at least one item to the order.', {
        lines: ['The cart is empty.'],
      });
    }

    const merged = new Map<string, number>();

    for (const line of lines) {
      if (!Number.isInteger(line.quantity) || line.quantity < 1) {
        throw new BusinessRuleError('Every quantity must be a whole number of at least one.', {
          lines: ['Check the quantities.'],
        });
      }

      merged.set(line.productId, (merged.get(line.productId) ?? 0) + line.quantity);
    }

    if (merged.size > MAX_LINES) {
      throw new BusinessRuleError(`An order cannot hold more than ${String(MAX_LINES)} products.`);
    }

    for (const [productId, quantity] of merged) {
      if (quantity > MAX_LINE_QUANTITY) {
        throw new BusinessRuleError(
          `That is ${String(quantity)} of one item. The most on a single line is ${String(MAX_LINE_QUANTITY)}.`,
          { lines: ['Check the quantities.'] },
        );
      }

      merged.set(productId, quantity);
    }

    return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));
  }
}

export interface ReceivePaymentInput extends RequestContext {
  readonly actorId: string;
  readonly orderId: string;
  readonly method: PaymentMethod;
  readonly reference?: string | undefined;
}

/**
 * Confirms money received against an order already totalled.
 *
 * The amount is **not** a parameter: it is whatever the order still owes. There is no
 * gateway — UPI shows a static QR and a person says the money arrived — so what this records
 * is a human assertion, and letting that human also type the figure would make the assertion
 * worthless.
 */
export class ReceivePaymentUseCase implements IUseCase<ReceivePaymentInput, OrderDto> {
  constructor(
    private readonly orders: IPosOrderRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: ReceivePaymentInput): Promise<OrderDto> {
    const existing = await this.orders.findById(input.orderId);

    if (existing === null) {
      throw new NotFoundError('Order', input.orderId);
    }

    if (existing.isCancelled) {
      throw new BusinessRuleError('A cancelled order cannot take payment.');
    }

    if (existing.amountDue <= 0) {
      throw new BusinessRuleError(`${existing.orderNumber} is already settled.`);
    }

    const order = await this.orders.recordPayment(input.orderId, {
      method: input.method,
      amount: existing.amountDue,
      reference: input.reference?.trim(),
      confirmedById: input.actorId,
    });

    await this.auditLog.record({
      actorId: input.actorId,
      action: PosAuditAction.PAYMENT_RECEIVED,
      entityType: ENTITY_TYPE,
      entityId: order.id,
      ip: input.ipAddress,
      metadata: {
        orderNumber: order.orderNumber,
        method: input.method,
        amount: existing.amountDue,
        status: order.status,
      },
    });

    this.logger.info('POS payment received', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      method: input.method,
      actorId: input.actorId,
    });

    return PosMapper.toOrderDto(order);
  }
}

export interface CancelOrderInput extends RequestContext {
  readonly actorId: string;
  readonly orderId: string;
  readonly reason: string;
}

/**
 * Voids an order.
 *
 * Admin-only at the route, and a reason is required. Cancelling a paid order removes money
 * from the day's takings, so the person who took the payment should not also be the one who
 * can quietly reverse it — and whoever does needs to say why.
 *
 * The payment rows survive: a refunded order and an order that never took money have to be
 * distinguishable when the cash is counted.
 */
export class CancelOrderUseCase implements IUseCase<CancelOrderInput, OrderDto> {
  constructor(
    private readonly orders: IPosOrderRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: CancelOrderInput): Promise<OrderDto> {
    const reason = input.reason.trim();

    if (reason.length === 0) {
      throw new BusinessRuleError('Say why the order is being cancelled.', {
        reason: ['A reason is required.'],
      });
    }

    const existing = await this.orders.findById(input.orderId);

    if (existing === null) {
      throw new NotFoundError('Order', input.orderId);
    }

    const order = await this.orders.cancel(input.orderId, input.actorId, reason);

    await this.auditLog.record({
      actorId: input.actorId,
      action: PosAuditAction.ORDER_CANCELLED,
      entityType: ENTITY_TYPE,
      entityId: order.id,
      ip: input.ipAddress,
      metadata: {
        orderNumber: order.orderNumber,
        // Both, so the audit entry alone says what was reversed.
        grandTotal: order.grandTotal,
        wasPaid: existing.isPaid,
        reason,
      },
    });

    this.logger.info('POS order cancelled', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      wasPaid: existing.isPaid,
      actorId: input.actorId,
    });

    return PosMapper.toOrderDto(order);
  }
}

export type { SalesOrder };
