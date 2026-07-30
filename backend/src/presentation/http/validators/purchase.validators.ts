import { z } from 'zod';
import {
  ALL_INVENTORY_CATEGORIES,
  ALL_INVENTORY_UNITS,
} from '../../../core/domain/enums/inventory.enum.js';
import {
  ALL_GST_TREATMENTS,
  GST_RATES,
  GST_STATE_CODES,
  PURCHASE_SORT_FIELDS,
  SUPPLIER_SORT_FIELDS,
} from '../../../core/domain/enums/purchase.enum.js';
import { MONEY_MAX } from '../../../core/domain/value-objects/money.js';
import { QUANTITY_MAX } from '../../../core/domain/value-objects/inventory-quantity.js';
import { paginationQuerySchema, sortOrderSchema, uuidSchema } from './common.validators.js';

const stateCodeSchema = z
  .string()
  .refine((value) => Object.hasOwn(GST_STATE_CODES, value), 'Select a valid state.');

/**
 * GSTIN structure, position by position:
 *
 * ```
 *   27      AAPFU0939F      1        Z         V
 *   state   PAN (10)        entity   literal   checksum
 * ```
 *
 * The PAN itself is 5 letters, 4 digits, 1 letter. The entity code and the checksum are
 * both alphanumeric — an earlier version of this regex required digits there and rejected
 * `27AAPFU0939F1ZV`, which is the example in its own error message.
 *
 * The structure is validated but the checksum is not computed. A wrong-shaped GSTIN is a
 * typo worth catching at the boundary; verifying the check digit belongs with the GST
 * portal, and reimplementing it here would start failing valid numbers the day the
 * algorithm changes.
 */
const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/,
    'Enter a valid 15-character GSTIN, e.g. 27AAPFU0939F1ZV.',
  );

const gstRateSchema = z.coerce
  .number()
  .refine(
    (value) => GST_RATES.includes(value),
    `Select a GST rate: ${GST_RATES.join(', ')}.`,
  );

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1, 'Enter a supplier name.').max(160, 'Name is too long.'),
  gstin: gstinSchema.optional(),
  stateCode: stateCodeSchema,
  contactName: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').optional(),
  phone: z.string().trim().max(24).optional(),
  addressLine: z.string().trim().max(240).optional(),
  city: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(1000).optional(),
});

/**
 * Every field optional, and `gstin` is nullable rather than merely absent.
 *
 * The distinction is load-bearing on a PATCH: omitting `gstin` leaves it untouched, while
 * sending `null` clears it — which is how a supplier that deregistered is corrected. With
 * only `optional()` there would be no way to express "remove this".
 */
export const updateSupplierSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    gstin: gstinSchema.nullable().optional(),
    stateCode: stateCodeSchema.optional(),
    contactName: z.string().trim().max(120).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    phone: z.string().trim().max(24).optional(),
    addressLine: z.string().trim().max(240).optional(),
    city: z.string().trim().max(80).optional(),
    notes: z.string().trim().max(1000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (body) => Object.keys(body).length > 0,
    'Provide at least one field to update.',
  );

export const listSuppliersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  stateCode: stateCodeSchema.optional(),
  sortField: z.enum(SUPPLIER_SORT_FIELDS).default('name'),
  sortDirection: sortOrderSchema.default('asc'),
});

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

/**
 * Details for an item that does not exist yet.
 *
 * Present so a bill can be entered in one pass, without leaving for the inventory screen
 * when an unfamiliar ingredient turns up mid-invoice.
 */
const newItemSchema = z.object({
  name: z.string().trim().min(1, 'Enter an item name.').max(120, 'Name is too long.'),
  category: z.enum(ALL_INVENTORY_CATEGORIES as [string, ...string[]]),
  unit: z.enum(ALL_INVENTORY_UNITS as [string, ...string[]]),
  minimumQuantity: z.coerce.number().finite().min(0).max(QUANTITY_MAX).optional(),
});

/**
 * One invoice line.
 *
 * The either/or between `itemId` and `newItem` is enforced here as well as in the use
 * case. At this layer it produces a field-scoped message the form can attach to the right
 * row; the use case repeats it because it is a business rule, not a transport concern.
 */
const purchaseLineSchema = z
  .object({
    itemId: uuidSchema.optional(),
    newItem: newItemSchema.optional(),
    quantity: z.coerce
      .number({ message: 'Enter a valid number.' })
      .finite('Enter a valid number.')
      .positive('Quantity must be greater than zero.')
      .max(QUANTITY_MAX, `Must be ${QUANTITY_MAX} or less.`),
    unitRate: z.coerce
      .number({ message: 'Enter a valid rate.' })
      .finite('Enter a valid rate.')
      .min(0, 'Rate cannot be negative.')
      .max(MONEY_MAX, 'Rate is too large.'),
    // Four to eight digits, per the HSN/SAC schedule.
    hsnCode: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, 'An HSN code is 4 to 8 digits.')
      .optional(),
    gstRatePercent: gstRateSchema.default(0),
  })
  .refine(
    (line) => (line.itemId !== undefined) !== (line.newItem !== undefined),
    'Pick an existing item or fill in a new one, not both.',
  );

export const createPurchaseSchema = z.object({
  supplierId: uuidSchema,
  invoiceNumber: z
    .string()
    .trim()
    .min(1, 'Enter the supplier’s invoice number.')
    .max(64, 'Invoice number is too long.'),
  /**
   * A date-only string. Coerced from `YYYY-MM-DD` rather than accepting a full timestamp,
   * because a timestamp carries a timezone the browser picked — and "2026-07-27T00:00Z"
   * rendered in IST is the 27th, but in UTC-5 it is the 26th. The column is a DATE, so
   * only the date was ever meant.
   */
  invoiceDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD.')
    .transform((value) => new Date(`${value}T00:00:00.000Z`))
    .refine((date) => !Number.isNaN(date.getTime()), 'Enter a valid date.'),
  notes: z.string().trim().max(1000).optional(),
  // Bounded: an invoice with hundreds of lines is a data-entry mistake, and each line
  // locks an inventory row for the duration of the transaction.
  lines: z
    .array(purchaseLineSchema)
    .min(1, 'Add at least one line to the invoice.')
    .max(100, 'An invoice can hold at most 100 lines.'),
});

export const listPurchasesQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  supplierId: uuidSchema.optional(),
  gstTreatment: z.enum(ALL_GST_TREATMENTS as [string, ...string[]]).optional(),
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((value) => new Date(`${value}T00:00:00.000Z`))
    .optional(),
  // End of day, so a range whose bounds are the same date includes that date's invoices
  // rather than matching only exact midnight.
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((value) => new Date(`${value}T23:59:59.999Z`))
    .optional(),
  hasInvoiceFile: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  sortField: z.enum(PURCHASE_SORT_FIELDS).default('invoiceDate'),
  sortDirection: sortOrderSchema.default('desc'),
});

export type CreateSupplierBody = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierBody = z.infer<typeof updateSupplierSchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;
export type CreatePurchaseBody = z.infer<typeof createPurchaseSchema>;
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;
