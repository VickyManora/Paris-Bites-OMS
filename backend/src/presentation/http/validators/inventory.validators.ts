import { z } from 'zod';
import {
  ALL_INVENTORY_CATEGORIES,
  ALL_INVENTORY_ITEM_STATUSES,
  ALL_INVENTORY_LOCATIONS,
  ALL_INVENTORY_UNITS,
} from '../../../core/domain/enums/inventory.enum.js';
import { INVENTORY_SORT_FIELDS } from '../../../core/domain/repositories/inventory-item.repository.js';
import { QUANTITY_MAX } from '../../../core/domain/value-objects/inventory-quantity.js';
import { paginationQuerySchema, uuidSchema } from './common.validators.js';

/**
 * Enum schemas built from the domain's own arrays, so adding a category or unit needs
 * no change here and the two can never disagree about what is valid.
 *
 * `z.enum` needs a non-empty tuple, hence the cast — the arrays are non-empty by
 * construction.
 */
const categorySchema = z.enum(ALL_INVENTORY_CATEGORIES as [string, ...string[]]);
const unitSchema = z.enum(ALL_INVENTORY_UNITS as [string, ...string[]]);
const locationSchema = z.enum(ALL_INVENTORY_LOCATIONS as [string, ...string[]]);
const statusSchema = z.enum(ALL_INVENTORY_ITEM_STATUSES as [string, ...string[]]);

/**
 * Quantity input.
 *
 * Bounds and finiteness are checked here so a malformed body is a 422 before any
 * database work. The unit-specific rules — whole numbers for pieces and boxes — live in
 * `InventoryQuantity`, because they depend on the item's unit, which the validator does
 * not know.
 */
const quantitySchema = z.coerce
  .number({ message: 'Enter a valid number.' })
  .finite('Enter a valid number.')
  .min(0, 'Quantity cannot be negative.')
  .max(QUANTITY_MAX, `Must be ${QUANTITY_MAX} or less.`);

const itemNameSchema = z
  .string()
  .trim()
  .min(2, 'Name must be at least 2 characters.')
  .max(120, 'Name must be at most 120 characters.');

const notesSchema = z.string().trim().max(1000, 'Notes must be at most 1000 characters.');

/**
 * Cost per unit, excluding tax.
 *
 * Zero is allowed — a free sample is a real thing — but negative is not: a negative
 * purchase price is never a discount, it is a typo that would make every valuation
 * report wrong. The 4-decimal ceiling matches `PurchaseLine.unitRate`, so a price
 * captured here can be reused on an invoice without rounding.
 */
const purchasePriceSchema = z.coerce
  .number({ message: 'Enter a valid amount.' })
  .finite('Enter a valid amount.')
  .min(0, 'Purchase price cannot be negative.')
  .max(99_999_999.9999, 'Purchase price is too large.');

const batchNumberSchema = z
  .string()
  .trim()
  .max(60, 'Batch number must be at most 60 characters.');

/**
 * `YYYY-MM-DD`, parsed to midnight UTC — the same treatment `invoiceDate` gets.
 *
 * A full timestamp is rejected rather than truncated: accepting one would mean silently
 * choosing a timezone on the caller's behalf, and "expires 2026-08-01T23:00Z" is a
 * different day depending on who reads it.
 *
 * The final check catches dates that parse but do not exist: `new Date('2026-02-30')`
 * rolls forward to 2 March rather than failing, so a shape-only regex would accept an
 * expiry the user never typed. Comparing the round trip is what rejects it.
 */
/**
 * Whether `YYYY-MM-DD` names a day that exists.
 *
 * Written defensively because Zod runs every string check and then the refinement, even
 * once the regex has already failed — so this receives arbitrary input, not just
 * well-shaped input. Calling `toISOString()` on the resulting Invalid Date would throw a
 * RangeError out of the validator and surface as a 500 instead of a 422, which is exactly
 * the bug this guard exists to prevent.
 */
function isRealCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  // Round-trip equality is what rejects 2026-02-30, which parses as 2 March.
  return parsed.toISOString().startsWith(value);
}

const expiryDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD.')
  .refine(isRealCalendarDate, 'Enter a valid date.')
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

export const createInventoryItemSchema = z.object({
  name: itemNameSchema,
  category: categorySchema,
  unit: unitSchema,
  location: locationSchema,
  currentQuantity: quantitySchema.default(0),
  // No default: the use case falls back to `currentQuantity`, which it knows and this
  // schema does not have access to at field level.
  openingQuantity: quantitySchema.optional(),
  minimumQuantity: quantitySchema.default(0),
  purchasePrice: purchasePriceSchema.optional(),
  supplierId: uuidSchema.optional(),
  lowStockAlertEnabled: z.boolean().optional(),
  batchNumber: batchNumberSchema.optional(),
  expiryDate: expiryDateSchema.optional(),
  status: statusSchema.optional(),
  notes: notesSchema.optional(),
});

/**
 * Every field optional, but at least one required.
 *
 * Without the `refine`, an empty body would be a valid no-op request that still looks
 * like a successful edit to the client.
 *
 * `currentQuantity` is deliberately absent: stock changes go through
 * `PATCH /:id/quantity`. Accepting it here would bypass the `STOCK_ADJUST` permission
 * and record the wrong kind of history entry.
 */
export const updateInventoryItemSchema = z
  .object({
    name: itemNameSchema.optional(),
    category: categorySchema.optional(),
    unit: unitSchema.optional(),
    location: locationSchema.optional(),
    minimumQuantity: quantitySchema.optional(),
    // Nullable throughout so a client can clear an optional field; `undefined` means
    // "leave unchanged". Without the distinction there would be no way to remove a
    // batch number or an expiry date once one had been entered.
    purchasePrice: purchasePriceSchema.nullable().optional(),
    supplierId: uuidSchema.nullable().optional(),
    lowStockAlertEnabled: z.boolean().optional(),
    batchNumber: batchNumberSchema.nullable().optional(),
    expiryDate: expiryDateSchema.nullable().optional(),
    status: statusSchema.optional(),
    // Nullable so a client can clear the notes; `undefined` means "leave unchanged".
    notes: notesSchema.nullable().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Provide at least one field to update.',
  });

/**
 * Either a signed `delta` or an absolute `quantity`, never both and never neither.
 *
 * Enforced here so the ambiguity never reaches the use case, and re-checked there
 * because the use case is also callable from a script or a job.
 */
export const adjustQuantitySchema = z
  .object({
    delta: z.coerce
      .number({ message: 'Enter a valid number.' })
      .finite('Enter a valid number.')
      .min(-QUANTITY_MAX)
      .max(QUANTITY_MAX)
      .optional(),
    quantity: quantitySchema.optional(),
    note: z.string().trim().max(500, 'Note must be at most 500 characters.').optional(),
  })
  .refine((data) => (data.delta === undefined) !== (data.quantity === undefined), {
    message: 'Provide either an adjustment (delta) or an exact quantity, not both.',
    path: ['delta'],
  })
  .refine((data) => data.delta !== 0, {
    message: 'Adjustment cannot be zero.',
    path: ['delta'],
  });

/**
 * List query.
 *
 * Sort field is restricted to a closed set from the domain, so a caller cannot sort by
 * an arbitrary — and therefore unindexed — column and turn a list request into a table
 * scan.
 */
export const listInventoryQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  category: categorySchema.optional(),
  location: locationSchema.optional(),
  unit: unitSchema.optional(),
  status: statusSchema.optional(),
  // Query params arrive as strings, so the boolean is parsed from 'true'/'false'.
  needsRestocking: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  sortField: z.enum(INVENTORY_SORT_FIELDS).default('name'),
  sortDirection: z.enum(['asc', 'desc']).default('asc'),
});

export const historyQuerySchema = paginationQuerySchema;

export type CreateInventoryItemBody = z.infer<typeof createInventoryItemSchema>;
export type UpdateInventoryItemBody = z.infer<typeof updateInventoryItemSchema>;
export type AdjustQuantityBody = z.infer<typeof adjustQuantitySchema>;
export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
