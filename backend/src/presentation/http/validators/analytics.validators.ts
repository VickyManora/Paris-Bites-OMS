import { z } from 'zod';
import { ALL_ANALYTICS_GRANULARITIES } from '../../../core/domain/repositories/analytics.repository.js';
import { ALL_REPORT_FORMATS } from '../../../core/domain/enums/report.enum.js';

/** A calendar day, parsed as UTC midnight — never a timestamp. */
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
 * Both dates are required.
 *
 * No implicit default range. Analytics with an unstated period is the easiest number in
 * the app to misread — someone quotes a revenue figure without knowing whether it covers
 * a week or a year — so the caller has to say, and the answer echoes the range back.
 */
export const analyticsQuerySchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
  granularity: z.enum(ALL_ANALYTICS_GRANULARITIES as [string, ...string[]]).default('day'),
});

export const analyticsExportQuerySchema = analyticsQuerySchema.extend({
  format: z.enum(ALL_REPORT_FORMATS as [string, ...string[]]),
});

export type AnalyticsQueryInput = z.infer<typeof analyticsQuerySchema>;
export type AnalyticsExportQueryInput = z.infer<typeof analyticsExportQuerySchema>;
