import { z } from 'zod';
import {
  CONSUMPTION_SORT_FIELDS,
  MAX_CONSUMPTION_LINES,
} from '../../../core/domain/enums/consumption.enum.js';
import { ALL_INVENTORY_LOCATIONS } from '../../../core/domain/enums/inventory.enum.js';
import { QUANTITY_MAX } from '../../../core/domain/value-objects/inventory-quantity.js';
import { paginationQuerySchema, sortOrderSchema, uuidSchema } from './common.validators.js';

const locationSchema = z.enum(ALL_INVENTORY_LOCATIONS as [string, ...string[]]);

/**
 * A calendar day, parsed to midnight UTC — the same treatment `invoiceDate` gets.
 *
 * A full timestamp is rejected rather than truncated: accepting one would mean silently
 * choosing a timezone on the caller's behalf, and on a *daily* sheet that can file a whole
 * day's usage under the wrong heading.
 *
 * The final check rejects days that parse but do not exist: `new Date('2026-02-30')` rolls
 * forward to 2 March rather than failing.
 */
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
 * Consumed quantity.
 *
 * Strictly positive: zero is not a consumption, and a negative one would be a stock
 * increase wearing a consumption record's clothes. The unit-specific rules — whole numbers
 * for packets and bottles — live in `InventoryQuantity`, which knows the item's unit.
 */
const quantitySchema = z.coerce
  .number({ message: 'Enter a valid number.' })
  .finite('Enter a valid number.')
  .positive('Quantity must be greater than zero.')
  .max(QUANTITY_MAX, `Must be ${QUANTITY_MAX} or less.`);

const lineSchema = z.object({
  itemId: uuidSchema,
  quantity: quantitySchema,
  notes: z.string().trim().max(500, 'Note must be at most 500 characters.').optional(),
});

const notesSchema = z.string().trim().max(1000, 'Notes must be at most 1000 characters.');

const linesSchema = z
  .array(lineSchema)
  .min(1, 'Add at least one item to the sheet.')
  .max(MAX_CONSUMPTION_LINES, `At most ${String(MAX_CONSUMPTION_LINES)} items.`);

export const recordConsumptionSchema = z.object({
  entryDate: dateOnlySchema,
  location: locationSchema,
  notes: notesSchema.optional(),
  lines: linesSchema,
});

/**
 * The whole sheet, not a patch.
 *
 * The stock effect of an edit is a diff against what is currently recorded, and computing
 * that from a partial instruction would mean reconstructing the caller's intent. "Here is
 * what the sheet should say" is unambiguous; "remove line 2" is not.
 */
export const updateConsumptionSchema = z.object({
  entryDate: dateOnlySchema,
  location: locationSchema,
  notes: notesSchema.optional(),
  lines: linesSchema,
  note: z.string().trim().max(500, 'Note must be at most 500 characters.').optional(),
});

export const voidConsumptionSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Give a reason for voiding this entry.')
    .max(500, 'Reason must be at most 500 characters.'),
});

export const listConsumptionQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  location: locationSchema.optional(),
  itemId: uuidSchema.optional(),
  fromDate: dateOnlySchema.optional(),
  // The column is a DATE, so an inclusive upper bound is the date itself — no end-of-day
  // adjustment is needed here, unlike the timestamp ranges on purchases.
  toDate: dateOnlySchema.optional(),
  includeVoided: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  sortField: z.enum(CONSUMPTION_SORT_FIELDS).default('entryDate'),
  sortDirection: sortOrderSchema.default('desc'),
});

export type RecordConsumptionBody = z.infer<typeof recordConsumptionSchema>;
export type UpdateConsumptionBody = z.infer<typeof updateConsumptionSchema>;
export type VoidConsumptionBody = z.infer<typeof voidConsumptionSchema>;
export type ListConsumptionQuery = z.infer<typeof listConsumptionQuerySchema>;
