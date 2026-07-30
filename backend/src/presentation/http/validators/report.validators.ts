import { z } from 'zod';
import { ALL_REPORT_FORMATS, ALL_REPORT_IDS } from '../../../core/domain/enums/report.enum.js';
import { ALL_INVENTORY_LOCATIONS } from '../../../core/domain/enums/inventory.enum.js';
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

export const reportIdParamSchema = z.object({
  id: z.enum(ALL_REPORT_IDS as [string, ...string[]]),
});

/**
 * Shared filter shape.
 *
 * One schema for every report rather than six: the reports differ in which filters they
 * *honour*, which the definition already states, and a filter that a report ignores is
 * harmless. Six near-identical schemas would drift.
 *
 * `sortField` is a free string here and resolved against the report's own closed set in
 * the use case — validating it at this layer would need the schema to know which report
 * is being run, which the router does not yet.
 */
export const reportQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  fromDate: dateOnlySchema.optional(),
  toDate: dateOnlySchema.optional(),
  location: z.enum(ALL_INVENTORY_LOCATIONS as [string, ...string[]]).optional(),
  supplierId: uuidSchema.optional(),
  sortField: z.string().trim().max(40).optional(),
  sortDirection: z.enum(['asc', 'desc']).optional(),
});

export const reportExportQuerySchema = reportQuerySchema.extend({
  format: z.enum(ALL_REPORT_FORMATS as [string, ...string[]]),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type ReportExportQuery = z.infer<typeof reportExportQuerySchema>;
