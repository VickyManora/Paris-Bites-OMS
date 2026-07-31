import type { SalesOrder } from '../../domain/entities/sales-order.entity.js';
import { PAYMENT_METHOD_LABELS } from '../../domain/enums/pos.enum.js';
import type {
  MenuCategoryDto,
  OrderDto,
  OrderItemDto,
  OrderPaymentDto,
  PosDaySummaryDto,
  ProductDto,
} from '../dtos/pos.dto.js';
import type {
  PosDaySummary,
  ProductCategoryRow,
} from '../../domain/repositories/pos.repository.js';

export const PosMapper = {
  toOrderDto(order: SalesOrder): OrderDto {
    const props = order.toProps();

    const items: OrderItemDto[] = props.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    }));

    const payments: OrderPaymentDto[] = props.payments.map((payment) => ({
      id: payment.id,
      method: payment.method,
      methodLabel: PAYMENT_METHOD_LABELS[payment.method],
      amount: payment.amount,
      reference: payment.reference,
      confirmedByName: payment.confirmedByName,
      createdAt: payment.createdAt.toISOString(),
    }));

    const method = order.paymentMethod;

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      channel: props.channel,
      status: props.status,
      statusLabel: order.statusLabel,
      customerName: props.customerName,
      customerPhone: props.customerPhone,
      subtotal: props.subtotal,
      discountType: props.discountType,
      discountValue: props.discountValue,
      discountAmount: props.discountAmount,
      comboDiscountAmount: props.comboDiscountAmount,
      comboCount: props.comboCount,
      discountReason: props.discountReason,
      grandTotal: props.grandTotal,
      notes: props.notes,
      itemCount: order.itemCount,
      items,
      summary: order.summary,
      payments,
      amountPaid: order.amountPaid,
      amountDue: order.amountDue,
      paymentMethod: method,
      paymentMethodLabel: method === null ? null : PAYMENT_METHOD_LABELS[method],
      placedByName: props.placedByName,
      paidAt: props.paidAt?.toISOString() ?? null,
      cancelledAt: props.cancelledAt?.toISOString() ?? null,
      cancelledByName: props.cancelledByName,
      cancelReason: props.cancelReason,
      createdAt: props.createdAt.toISOString(),
    };
  },

  toOrderDtoList(orders: readonly SalesOrder[]): OrderDto[] {
    return orders.map((order) => PosMapper.toOrderDto(order));
  },

  toMenuDto(categories: readonly ProductCategoryRow[]): MenuCategoryDto[] {
    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      icon: category.icon,
      products: category.products.map(
        (product): ProductDto => ({
          id: product.id,
          name: product.name,
          description: product.description,
          price: product.price,
          imageUrl: product.imageUrl,
          isAvailable: product.isAvailable,
        }),
      ),
    }));
  },

  toSummaryDto(summary: PosDaySummary, scope: 'all' | 'own'): PosDaySummaryDto {
    return { ...summary, scope };
  },
} as const;
