import { z } from 'zod';

/**
 * Dashboard query.
 *
 * `date` is the **caller's** calendar day, not the server's. The database runs in UTC and
 * the business does not: at 02:00 in Mumbai it is still the previous day in UTC, so a
 * server-computed "today" would show yesterday's figures for five and a half hours every
 * night. The browser knows its own date; it sends it.
 *
 * Defaulted rather than required, so a curl against this endpoint still works.
 */
export const dashboardQuerySchema = z.object({
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD.')
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
    }, 'Enter a valid date.')
    .transform((value) => new Date(`${value}T00:00:00.000Z`))
    .optional(),

  /**
   * Trailing window for the charts and the usage ranking.
   *
   * Bounded: a year of daily points is unreadable on a dashboard card and is a report,
   * not a summary.
   */
  windowDays: z.coerce.number().int().min(7).max(90).default(14),
});

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
