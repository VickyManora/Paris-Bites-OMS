import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { SalesOrder } from '../../../core/domain/entities/sales-order.entity.js';
import {
  ALL_PAYMENT_METHODS,
  OrderStatus,
  type PaymentMethod,
} from '../../../core/domain/enums/pos.enum.js';
import { BusinessRuleError, NotFoundError } from '../../../core/domain/errors/domain-error.js';
import type {
  CreateOrderData,
  IPosOrderRepository,
  OrderFilter,
  PosDaySummary,
  RecordPaymentData,
} from '../../../core/domain/repositories/pos.repository.js';
import { createPage, toSkipTake, type Page, type PageRequest } from '../../../shared/pagination.js';
import { ORDER_INCLUDE, PosPrismaMapper } from '../mappers/pos.prisma-mapper.js';
import { decimalToNumber } from '../mappers/inventory-item.prisma-mapper.js';

type Tx = Prisma.TransactionClient;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** `YYYY-MM-DD` in UTC. The trading day the order number and the day figures key on. */
function dateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/**
 * Order persistence.
 *
 * One transaction per mutation, and the order number is allocated **inside** it — see
 * `nextOrderNumber`. Everything the counter does in a single tap lands in a single
 * round trip, because the slowest part of a ten-second order is the network.
 */
export class PosOrderPrismaRepository implements IPosOrderRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(data: CreateOrderData): Promise<SalesOrder> {
    try {
      return await this.insert(data);
    } catch (error) {
      /*
       * Two taps that raced past the use case's pre-check.
       *
       * The unique index on `idempotency_key` is what actually holds here — the read in
       * `PlaceOrderUseCase` narrows the window but cannot close it, because both requests can
       * read "no such order" before either writes. The loser of that race must not surface an
       * error: from the counter's point of view the order was taken, and it was.
       *
       * **Deliberately not conditioned on the driver's error code.** The obvious version of this
       * checks for P2002, and that is what was written first — it passes in-process and then
       * fails through the running server, which surfaces the same collision under a different
       * code once a connection pool and PGlite's session multiplexing are in the path. Whatever
       * the driver called it, the question worth asking is the same one: *is there now an order
       * under this key?* If there is, that order is the answer, and the error describes only how
       * this particular attempt lost.
       *
       * An unrelated failure still propagates, because then the re-read finds nothing.
       */
      const key = data.idempotencyKey;

      if (key !== undefined) {
        try {
          const existing = await this.findByIdempotencyKey(key);

          if (existing !== null) {
            return existing;
          }
        } catch {
          /*
           * The recovery read failed as well, so fall through and rethrow the original.
           *
           * This is not defensive padding — it is the difference between the caller getting a
           * 409 that names the collision and getting a 500 that names nothing. A recovery
           * attempt is allowed to fail to improve the outcome; it is never allowed to replace a
           * meaningful error with its own.
           */
        }
      }

      throw error;
    }
  }

  private async insert(data: CreateOrderData): Promise<SalesOrder> {
    const created = await this.client.$transaction(async (tx) => {
      const now = new Date();
      const orderNumber = await this.nextOrderNumber(tx, now);
      const customerId = await this.resolveCustomer(tx, data.customer);

      // Paid when *any* tender came with the order. One or three, the rule is the same.
      const paid = data.payments.length > 0;

      const order = await tx.salesOrder.create({
        data: {
          orderNumber,
          channel: data.channel,
          // The payment decides the status, not the caller: an order created with money
          // attached is paid, and one without is awaiting it. Letting the client assert
          // "PAID" with no payment row would put unbacked revenue in the day's figures.
          status: paid ? OrderStatus.PAID : data.status,
          customerId,
          subtotal: data.subtotal,
          discountType: data.discountType,
          discountValue: data.discountValue,
          discountAmount: data.discountAmount,
          discountReason: data.discountReason ?? null,
          comboDiscountAmount: data.comboDiscountAmount,
          comboCount: data.comboCount,
          grandTotal: data.grandTotal,
          notes: data.notes ?? null,
          placedById: data.placedById,
          idempotencyKey: data.idempotencyKey ?? null,
          paidAt: paid ? now : null,
          items: { create: data.lines.map((line) => ({ ...line })) },
          // One row per tender. Prisma's nested create takes an array, so a split costs no extra
          // round trip and lands inside the same transaction as the order and its lines — a
          // half-written split would be an order whose payments do not sum to its total.
          ...(paid
            ? {
                payments: {
                  create: data.payments.map((payment) => ({
                    method: payment.method,
                    amount: payment.amount,
                    reference: payment.reference ?? null,
                    confirmedById: data.placedById,
                  })),
                },
              }
            : {}),
        },
        include: ORDER_INCLUDE,
      });

      return order;
    });

    return PosPrismaMapper.toDomain(created);
  }

  async findById(id: string): Promise<SalesOrder | null> {
    const row = await this.client.salesOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
    return row === null ? null : PosPrismaMapper.toDomain(row);
  }

  async findByNumber(orderNumber: string): Promise<SalesOrder | null> {
    const row = await this.client.salesOrder.findUnique({
      where: { orderNumber },
      include: ORDER_INCLUDE,
    });

    return row === null ? null : PosPrismaMapper.toDomain(row);
  }

  async findByIdempotencyKey(key: string): Promise<SalesOrder | null> {
    const row = await this.client.salesOrder.findUnique({
      where: { idempotencyKey: key },
      include: ORDER_INCLUDE,
    });

    return row === null ? null : PosPrismaMapper.toDomain(row);
  }

  async findMany(filter: OrderFilter, page: PageRequest): Promise<Page<SalesOrder>> {
    const where = this.buildWhere(filter);
    const { skip, take } = toSkipTake(page);

    // One transaction so the count and the slice describe the same snapshot — otherwise an
    // order taken between the two makes the last page look short.
    const [rows, total] = await this.client.$transaction([
      this.client.salesOrder.findMany({
        where,
        skip,
        take,
        orderBy: this.buildOrderBy(filter),
        include: ORDER_INCLUDE,
      }),
      this.client.salesOrder.count({ where }),
    ]);

    return createPage(PosPrismaMapper.toDomainList(rows), total, page);
  }

  async recordPayment(id: string, data: RecordPaymentData): Promise<SalesOrder> {
    const updated = await this.client.$transaction(async (tx) => {
      const existing = await tx.salesOrder.findUnique({
        where: { id },
        select: { id: true, status: true, grandTotal: true, payments: { select: { amount: true } } },
      });

      if (existing === null) {
        throw new NotFoundError('Order', id);
      }

      if (existing.status === OrderStatus.CANCELLED) {
        throw new BusinessRuleError('A cancelled order cannot take payment.');
      }

      await tx.payment.create({
        data: {
          orderId: id,
          method: data.method,
          amount: data.amount,
          reference: data.reference ?? null,
          confirmedById: data.confirmedById,
        },
      });

      /*
       * Settled only when the payments cover the total.
       *
       * Computed from the rows rather than trusting this one payment to be the whole amount,
       * so a split payment settles on the last part and not the first.
       */
      const paidSoFar = round(
        existing.payments.reduce((sum, payment) => sum + decimalToNumber(payment.amount), 0) +
          data.amount,
      );
      const settled = paidSoFar >= decimalToNumber(existing.grandTotal);

      return tx.salesOrder.update({
        where: { id },
        data: settled ? { status: OrderStatus.PAID, paidAt: new Date() } : { status: OrderStatus.PENDING_PAYMENT },
        include: ORDER_INCLUDE,
      });
    });

    return PosPrismaMapper.toDomain(updated);
  }

  async cancel(id: string, actorId: string, reason: string): Promise<SalesOrder> {
    const updated = await this.client.$transaction(async (tx) => {
      const existing = await tx.salesOrder.findUnique({ where: { id }, select: { status: true } });

      if (existing === null) {
        throw new NotFoundError('Order', id);
      }

      if (existing.status === OrderStatus.CANCELLED) {
        throw new BusinessRuleError('That order is already cancelled.');
      }

      /*
       * The payment rows are left in place.
       *
       * Deleting them would make a refunded order indistinguishable from one that never
       * took money, and the day's cash count needs to explain both. The status is what
       * excludes it from revenue.
       */
      return tx.salesOrder.update({
        where: { id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: actorId,
          cancelReason: reason,
        },
        include: ORDER_INCLUDE,
      });
    });

    return PosPrismaMapper.toDomain(updated);
  }

  async summaryFor(day: Date, placedById: string | undefined): Promise<PosDaySummary> {
    const start = dateOnly(day);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const where: Prisma.SalesOrderWhereInput = {
      createdAt: { gte: start, lt: end },
      ...(placedById === undefined ? {} : { placedById }),
    };

    /*
     * Explicit counts rather than a `groupBy` over status.
     *
     * Four counts read more plainly than a grouped result the caller then has to search,
     * and they go in one transaction so every figure on the POS home screen describes the
     * same instant.
     */
    const [orderCount, pendingCount, cancelledCount, revenue, pending, methods, items] =
      await this.client.$transaction([
        this.client.salesOrder.count({ where }),
        this.client.salesOrder.count({ where: { ...where, status: OrderStatus.PENDING_PAYMENT } }),
        this.client.salesOrder.count({ where: { ...where, status: OrderStatus.CANCELLED } }),
        this.client.salesOrder.aggregate({
          where: { ...where, status: OrderStatus.PAID },
          _sum: { grandTotal: true },
          _count: true,
        }),
        this.client.salesOrder.aggregate({
          where: { ...where, status: OrderStatus.PENDING_PAYMENT },
          _sum: { grandTotal: true },
        }),
        this.client.payment.groupBy({
          by: ['method'],
          where: { order: { ...where, status: OrderStatus.PAID } },
          _sum: { amount: true },
          orderBy: [{ method: 'asc' }],
        }),
        this.client.salesOrderItem.aggregate({
          where: { order: { ...where, status: OrderStatus.PAID } },
          _sum: { quantity: true },
        }),
      ]);

    const paidCount = revenue._count;
    const total = round(decimalToNumber(revenue._sum.grandTotal ?? 0));

    /*
     * Every representable method, not only the two the counter now takes.
     *
     * A day's figures have to add up to what the database holds. Dropping CARD here would
     * silently omit any card payment taken before the store stopped accepting them, and the
     * breakdown would no longer reconcile with the revenue total beside it.
     */
    const byPaymentMethod = Object.fromEntries(
      ALL_PAYMENT_METHODS.map((method) => [
        method,
        round(
          methods
            .filter((row) => row.method === method)
            .reduce((sum, row) => sum + decimalToNumber(row._sum?.amount ?? 0), 0),
        ),
      ]),
    ) as Record<PaymentMethod, number>;

    return {
      date: start.toISOString().slice(0, 10),
      orderCount,
      paidCount,
      pendingCount,
      cancelledCount,
      revenue: total,
      pendingAmount: round(decimalToNumber(pending._sum.grandTotal ?? 0)),
      // Over paid orders only, and null rather than zero when there are none — a zero
      // average order value on a quiet morning reads as a broken figure.
      averageOrderValue: paidCount === 0 ? null : round(total / paidCount),
      byPaymentMethod,
      itemsSold: items._sum.quantity ?? 0,
    };
  }

  /**
   * Allocates the next number for the day, inside the caller's transaction.
   *
   * `PB-20260728-0001`, restarting at 1 each day so staff can call out "order forty-two".
   *
   * The obvious implementation — `SELECT count(*) + 1 FROM sales_orders WHERE created_at::date
   * = today` — hands the same number to two tills taking an order in the same instant, and
   * the unique index then rejects one of them with a customer waiting. This uses an atomic
   * upsert-and-increment on a per-day counter row instead: the row is locked for the rest of
   * the transaction, so a concurrent order queues behind it and gets the next number.
   */
  private async nextOrderNumber(tx: Tx, now: Date): Promise<string> {
    const day = dateOnly(now);

    const sequence = await tx.orderSequence.upsert({
      where: { day },
      create: { day, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
      select: { lastNumber: true },
    });

    const stamp = day.toISOString().slice(0, 10).replace(/-/g, '');

    return `PB-${stamp}-${String(sequence.lastNumber).padStart(4, '0')}`;
  }

  /**
   * Finds or creates the customer.
   *
   * Matched on phone, which is the practical identity at a cart. A name with no phone
   * creates a fresh row rather than trying to match on it — two customers called Priya are
   * two customers, and merging them would attach one person's history to another.
   */
  private async resolveCustomer(
    tx: Tx,
    customer: CreateOrderData['customer'],
  ): Promise<string | null> {
    if (customer === undefined) {
      return null;
    }

    const name = customer.name?.trim();
    const phone = customer.phone?.trim();

    if ((name === undefined || name.length === 0) && (phone === undefined || phone.length === 0)) {
      return null;
    }

    if (phone !== undefined && phone.length > 0) {
      const existing = await tx.customer.findFirst({
        where: { phone, deletedAt: null },
        select: { id: true, name: true },
      });

      if (existing !== null) {
        // A name given this time fills in one we did not have. It never overwrites.
        if (existing.name === null && name !== undefined && name.length > 0) {
          await tx.customer.update({ where: { id: existing.id }, data: { name } });
        }

        return existing.id;
      }
    }

    const created = await tx.customer.create({
      data: { name: name ?? null, phone: phone ?? null },
      select: { id: true },
    });

    return created.id;
  }

  private buildWhere(filter: OrderFilter): Prisma.SalesOrderWhereInput {
    const where: Prisma.SalesOrderWhereInput = {};

    if (filter.fromDate !== undefined || filter.toDate !== undefined) {
      const end = filter.toDate === undefined ? undefined : dateOnly(filter.toDate);

      if (end !== undefined) {
        end.setUTCDate(end.getUTCDate() + 1);
      }

      where.createdAt = {
        ...(filter.fromDate === undefined ? {} : { gte: dateOnly(filter.fromDate) }),
        ...(end === undefined ? {} : { lt: end }),
      };
    }

    if (filter.status !== undefined) {
      where.status = filter.status;
    }
    if (filter.channel !== undefined) {
      where.channel = filter.channel;
    }
    if (filter.placedById !== undefined) {
      where.placedById = filter.placedById;
    }
    if (filter.paymentMethod !== undefined) {
      where.payments = { some: { method: filter.paymentMethod } };
    }

    const search = filter.search?.trim();

    if (search !== undefined && search.length > 0) {
      /*
       * Order number, customer and product name.
       *
       * The product search reaches through the line snapshots rather than the product table,
       * so searching "Nutella" still finds an order placed before the item was renamed.
       */
      where.OR = [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { customer: { phone: { contains: search } } },
        { items: { some: { productName: { contains: search, mode: 'insensitive' } } } },
      ];
    }

    return where;
  }

  private buildOrderBy(filter: OrderFilter): Prisma.SalesOrderOrderByWithRelationInput[] {
    const direction = filter.sortDirection ?? 'desc';

    // `orderNumber` is appended as a tiebreaker: it embeds the sequence, so it is a stable
    // total order and paging cannot show a row twice.
    switch (filter.sortField) {
      case 'grandTotal':
        return [{ grandTotal: direction }, { orderNumber: 'desc' }];
      case 'orderNumber':
        return [{ orderNumber: direction }];
      default:
        return [{ createdAt: direction }, { orderNumber: 'desc' }];
    }
  }
}
