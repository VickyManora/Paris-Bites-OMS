import type { DiscountType, OrderStatus, PaymentMethod } from '../../domain/enums/pos.enum.js';
import type { SalesChannel } from '../../domain/enums/sales.enum.js';
import type { OrderFilter, OrderSortField } from '../../domain/repositories/pos.repository.js';

export interface ProductDto {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly price: number;
  readonly imageUrl: string | null;
  readonly isAvailable: boolean;
}

export interface MenuCategoryDto {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly products: readonly ProductDto[];
}

export interface OrderItemDto {
  readonly id: string;
  readonly productId: string;
  /** Snapshot from the moment of sale — not the product's current name. */
  readonly productName: string;
  readonly unitPrice: number;
  readonly quantity: number;
  readonly lineTotal: number;
}

export interface OrderPaymentDto {
  readonly id: string;
  readonly method: PaymentMethod;
  readonly methodLabel: string;
  readonly amount: number;
  readonly reference: string | null;
  readonly confirmedByName: string | null;
  readonly createdAt: string;
}

export interface OrderDto {
  readonly id: string;
  readonly orderNumber: string;
  readonly channel: SalesChannel;
  readonly status: OrderStatus;
  readonly statusLabel: string;

  readonly customerName: string | null;
  readonly customerPhone: string | null;

  readonly subtotal: number;
  readonly discountType: DiscountType;
  readonly discountValue: number;
  readonly discountAmount: number;
  /**
   * What the automatic "any 2" offers took off, and how many pairs matched.
   *
   * Exposed separately from `discountAmount` so a receipt can say "Combo saving ₹79" rather than
   * folding the shop's own offer into a line that reads as staff discretion.
   */
  readonly comboDiscountAmount: number;
  readonly comboCount: number;
  readonly discountReason: string | null;
  readonly grandTotal: number;

  readonly notes: string | null;

  readonly itemCount: number;
  readonly items: readonly OrderItemDto[];
  /** "Death By Chocolate ×2, Oreo Licious" — for a list row. */
  readonly summary: string;

  readonly payments: readonly OrderPaymentDto[];
  readonly amountPaid: number;
  readonly amountDue: number;
  /** Null for a split payment or an unpaid order. */
  readonly paymentMethod: PaymentMethod | null;
  readonly paymentMethodLabel: string | null;

  readonly placedByName: string | null;
  readonly paidAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelledByName: string | null;
  readonly cancelReason: string | null;

  readonly createdAt: string;
}

export interface PosDaySummaryDto {
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
  /**
   * Whether these figures cover everyone or only the caller.
   *
   * Someone without `POS_ORDER_READ_ALL` sees their own takings, and a tile that did not say
   * so would read as the whole cart's.
   */
  readonly scope: 'all' | 'own';
}

export interface ListOrdersInput {
  readonly filter: OrderFilter;
  readonly page: number;
  readonly pageSize: number;
  readonly sortField?: OrderSortField | undefined;
  readonly sortDirection?: 'asc' | 'desc' | undefined;
}
