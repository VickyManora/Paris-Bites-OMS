import type { Prisma } from '../../../generated/prisma/client.js';
import {
  SalesOrder,
  type PaymentProps,
  type SalesOrderItemProps,
} from '../../../core/domain/entities/sales-order.entity.js';
import { DiscountType, OrderStatus, PaymentMethod } from '../../../core/domain/enums/pos.enum.js';
import { SalesChannel } from '../../../core/domain/enums/sales.enum.js';
import { decimalToNumber } from './inventory-item.prisma-mapper.js';

/** Joined on every order read: an order without its lines is not an order. */
export const ORDER_INCLUDE = {
  items: { orderBy: { createdAt: 'asc' } },
  payments: {
    orderBy: { createdAt: 'asc' },
    include: { confirmedBy: { select: { firstName: true, lastName: true } } },
  },
  customer: { select: { id: true, name: true, phone: true } },
  placedBy: { select: { firstName: true, lastName: true } },
  cancelledBy: { select: { firstName: true, lastName: true } },
} as const satisfies Prisma.SalesOrderInclude;

export type OrderRow = Prisma.SalesOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/**
 * Prisma enums to domain enums.
 *
 * Exhaustive switches with no `default`, so a value added to the Prisma enum without a
 * domain counterpart stops the build.
 */
function toStatus(value: OrderRow['status']): OrderStatus {
  switch (value) {
    case 'DRAFT':
      return OrderStatus.DRAFT;
    case 'PENDING_PAYMENT':
      return OrderStatus.PENDING_PAYMENT;
    case 'PAID':
      return OrderStatus.PAID;
    case 'CANCELLED':
      return OrderStatus.CANCELLED;
  }
}

function toMethod(value: OrderRow['payments'][number]['method']): PaymentMethod {
  switch (value) {
    case 'CASH':
      return PaymentMethod.CASH;
    case 'UPI':
      return PaymentMethod.UPI;
    case 'CARD':
      return PaymentMethod.CARD;
  }
}

function toDiscountType(value: OrderRow['discountType']): DiscountType {
  switch (value) {
    case 'NONE':
      return DiscountType.NONE;
    case 'FLAT':
      return DiscountType.FLAT;
    case 'PERCENTAGE':
      return DiscountType.PERCENTAGE;
  }
}

function toChannel(value: OrderRow['channel']): SalesChannel {
  switch (value) {
    case 'WALK_IN':
      return SalesChannel.WALK_IN;
    case 'ZOMATO':
      return SalesChannel.ZOMATO;
    case 'SWIGGY':
      return SalesChannel.SWIGGY;
  }
}

function fullName(person: { firstName: string; lastName: string } | null | undefined): string | null {
  return person == null ? null : `${person.firstName} ${person.lastName}`;
}

export const PosPrismaMapper = {
  toDomain(row: OrderRow): SalesOrder {
    const items: SalesOrderItemProps[] = row.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      unitPrice: decimalToNumber(item.unitPrice),
      quantity: item.quantity,
      lineTotal: decimalToNumber(item.lineTotal),
    }));

    const payments: PaymentProps[] = row.payments.map((payment) => ({
      id: payment.id,
      method: toMethod(payment.method),
      amount: decimalToNumber(payment.amount),
      reference: payment.reference,
      confirmedByName: fullName(payment.confirmedBy),
      createdAt: payment.createdAt,
    }));

    return SalesOrder.fromPersistence({
      id: row.id,
      orderNumber: row.orderNumber,
      channel: toChannel(row.channel),
      status: toStatus(row.status),
      customerId: row.customerId,
      customerName: row.customer?.name ?? null,
      customerPhone: row.customer?.phone ?? null,
      subtotal: decimalToNumber(row.subtotal),
      discountType: toDiscountType(row.discountType),
      discountValue: decimalToNumber(row.discountValue),
      discountAmount: decimalToNumber(row.discountAmount),
      comboDiscountAmount: decimalToNumber(row.comboDiscountAmount),
      comboCount: row.comboCount,
      discountReason: row.discountReason,
      grandTotal: decimalToNumber(row.grandTotal),
      notes: row.notes,
      placedById: row.placedById,
      placedByName: fullName(row.placedBy),
      paidAt: row.paidAt,
      cancelledAt: row.cancelledAt,
      cancelledByName: fullName(row.cancelledBy),
      cancelReason: row.cancelReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      items,
      payments,
    });
  },

  toDomainList(rows: readonly OrderRow[]): SalesOrder[] {
    return rows.map((row) => PosPrismaMapper.toDomain(row));
  },
} as const;
