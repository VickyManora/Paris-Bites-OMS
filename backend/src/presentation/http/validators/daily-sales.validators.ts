import { z } from 'zod';
import {
  ALL_SALES_CHANNELS,
  ALL_SALES_PAYMENT_MODES,
} from '../../../core/domain/enums/sales.enum.js';
import { paginationQuerySchema } from './common.validators.js';

/**
 * A calendar day, parsed as UTC midnight.
 *
 * Never a timestamp. The column is a `DATE` and a value carrying a local offset can land
 * on the previous day once Postgres casts it, which would file a Monday's takings under
 * Sunday for anyone east of UTC — including here.
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
 * One bucket's takings.
 *
 * Two decimal places, non-negative, finite. The cap is a slipped-decimal guard rather
 * than a business limit; the use case enforces the same bound so it holds for any caller.
 */
const amountSchema = z
  .number()
  .finite('Enter a valid amount.')
  .min(0, 'Takings cannot be negative.')
  .max(10_000_000, 'That figure looks like a slipped decimal point.')
  .refine((value) => Math.round(value * 100) === value * 100, 'Use at most two decimal places.');

const amountEntrySchema = z.object({
  channel: z.enum(ALL_SALES_CHANNELS as [string, ...string[]]),
  paymentMode: z.enum(ALL_SALES_PAYMENT_MODES as [string, ...string[]]),
  amount: amountSchema,
});

/**
 * The whole day, in one submission.
 *
 * `amounts` is the complete set of buckets — a replace, not a patch. A day's takings is
 * one statement about that day, and accepting a partial update would make "walk-in was
 * corrected but Zomato is from the old version" a representable state.
 */
export const recordDailySalesSchema = z.object({
  entryDate: dateOnlySchema,
  notes: z.string().trim().max(500).optional(),
  amounts: z.array(amountEntrySchema).min(1, 'Enter the takings for at least one channel.').max(8),
});

export const updateDailySalesSchema = z.object({
  notes: z.string().trim().max(500).optional(),
  amounts: z.array(amountEntrySchema).min(1, 'Enter the takings for at least one channel.').max(8),
  /** Required: a corrected revenue figure with no explanation is not auditable. */
  reason: z
    .string()
    .trim()
    .min(3, 'Say why the figure changed.')
    .max(300),
});

export const listDailySalesQuerySchema = paginationQuerySchema.extend({
  fromDate: dateOnlySchema.optional(),
  toDate: dateOnlySchema.optional(),
  channel: z.enum(ALL_SALES_CHANNELS as [string, ...string[]]).optional(),
  sortField: z.enum(['entryDate', 'totalAmount']).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

/** The summary takes the same filters as the list, minus paging. */
export const dailySalesSummaryQuerySchema = z.object({
  fromDate: dateOnlySchema.optional(),
  toDate: dateOnlySchema.optional(),
  channel: z.enum(ALL_SALES_CHANNELS as [string, ...string[]]).optional(),
});

export const dailySalesDateParamSchema = z.object({
  date: dateOnlySchema,
});

export type RecordDailySalesBody = z.infer<typeof recordDailySalesSchema>;
export type UpdateDailySalesBody = z.infer<typeof updateDailySalesSchema>;
export type ListDailySalesQuery = z.infer<typeof listDailySalesQuerySchema>;
export type DailySalesSummaryQuery = z.infer<typeof dailySalesSummaryQuerySchema>;
