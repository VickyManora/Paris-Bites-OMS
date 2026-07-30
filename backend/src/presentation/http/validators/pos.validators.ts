import { z } from 'zod';
import {
  ACCEPTED_PAYMENT_METHODS,
  ALL_DISCOUNT_TYPES,
  ALL_ORDER_STATUSES,
  ALL_PAYMENT_METHODS,
} from '../../../core/domain/enums/pos.enum.js';
import { ALL_SALES_CHANNELS } from '../../../core/domain/enums/sales.enum.js';
import { paginationQuerySchema, uuidSchema } from './common.validators.js';

const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD.')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, 'Enter a valid date.')
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

/**
 * One cart line.
 *
 * Notice what is absent: **no price**. The server prices every line from the product row, so
 * a request cannot influence what the customer is charged. Accepting a price here would make
 * the total a client assertion.
 */
const orderLineSchema = z.object({
  productId: uuidSchema,
  quantity: z.number().int().min(1).max(99),
});

/**
 * The `Idempotency-Key` header on `POST /pos/orders`.
 *
 * A header rather than a body field, because it describes the *attempt* rather than the order —
 * the body is identical across retries and this is the one thing that must not be.
 *
 * Rejected rather than ignored when malformed. Silently dropping an unreadable key would leave
 * the client believing its retries are safe when they are not, and the failure would only show
 * up as a double charge at the counter.
 */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8, 'An idempotency key must be at least 8 characters.')
  .max(128, 'An idempotency key may not exceed 128 characters.')
  .regex(/^[A-Za-z0-9_-]+$/, 'An idempotency key may contain only letters, digits, - and _.');

export const placeOrderSchema = z
  .object({
    lines: z.array(orderLineSchema).min(1, 'The cart is empty.').max(40),
    discountType: z.enum(ALL_DISCOUNT_TYPES as [string, ...string[]]).default('NONE'),
    discountValue: z.number().finite().min(0).max(1_000_000).default(0),
    discountReason: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(500).optional(),
    customer: z
      .object({
        name: z.string().trim().max(120).optional(),
        // Deliberately permissive: a cart takes whatever the customer reads out, and
        // rejecting an unusual number would cost a sale over a validation rule.
        phone: z.string().trim().max(20).optional(),
      })
      .optional(),
    payment: z
      .object({
        // What may be taken, not what may be read: a request naming CARD is rejected.
        method: z.enum(ACCEPTED_PAYMENT_METHODS as [string, ...string[]]),
        reference: z.string().trim().max(60).optional(),
      })
      .optional(),
  })
  .refine(
    (body) => body.discountType === 'NONE' || body.discountValue > 0,
    { message: 'Enter a discount amount, or choose no discount.', path: ['discountValue'] },
  )
  .refine(
    // Caught here as well as in the use case: a 150% discount is nonsense whoever sends it.
    (body) => body.discountType !== 'PERCENTAGE' || body.discountValue <= 100,
    { message: 'A percentage discount cannot exceed 100%.', path: ['discountValue'] },
  );

export const receivePaymentSchema = z.object({
  method: z.enum(ACCEPTED_PAYMENT_METHODS as [string, ...string[]]),
  reference: z.string().trim().max(60).optional(),
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(3, 'Say why the order is being cancelled.').max(300),
});

export const listOrdersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  fromDate: dateOnlySchema.optional(),
  toDate: dateOnlySchema.optional(),
  status: z.enum(ALL_ORDER_STATUSES as [string, ...string[]]).optional(),
  paymentMethod: z.enum(ALL_PAYMENT_METHODS as [string, ...string[]]).optional(),
  channel: z.enum(ALL_SALES_CHANNELS as [string, ...string[]]).optional(),
  sortField: z.enum(['createdAt', 'grandTotal', 'orderNumber']).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

export const menuQuerySchema = z.object({
  /** Query strings are strings, so the literal 'true' is the opt-in. */
  includeUnavailable: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const posSummaryQuerySchema = z.object({
  date: dateOnlySchema.optional(),
});

export const productAvailabilitySchema = z.object({
  isAvailable: z.boolean(),
});

export type PlaceOrderBody = z.infer<typeof placeOrderSchema>;
export type ReceivePaymentBody = z.infer<typeof receivePaymentSchema>;
export type CancelOrderBody = z.infer<typeof cancelOrderSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
export type MenuQueryInput = z.infer<typeof menuQuerySchema>;
export type PosSummaryQuery = z.infer<typeof posSummaryQuerySchema>;
export type ProductAvailabilityBody = z.infer<typeof productAvailabilitySchema>;
