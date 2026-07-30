import { z } from 'zod';
import { PAGINATION } from '../../../config/constants.js';

/**
 * Building blocks reused by feature validators, so rules like "email is
 * lowercased and trimmed" or "page size is capped" are defined once.
 */

export const uuidSchema = z.string().uuid('Must be a valid UUID.');

export const idParamSchema = z.object({
  id: uuidSchema,
});

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Email is required.')
  .email('Must be a valid email address.')
  .max(255, 'Email must be at most 255 characters.');

/**
 * Password policy. Length is the dominant factor in resistance to guessing, so
 * the floor is 10 rather than 8; the character-class rules are secondary and
 * kept mild to avoid pushing users toward predictable substitutions.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .regex(/[a-z]/, 'Password must contain a lowercase letter.')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter.')
  .regex(/\d/, 'Password must contain a number.');

/** Query parameters arrive as strings, so numbers are coerced then bounded. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(PAGINATION.defaultPage),
  pageSize: z.coerce
    .number()
    .int()
    .positive()
    .max(PAGINATION.maxPageSize)
    .default(PAGINATION.defaultPageSize),
});

export const searchQuerySchema = z.object({
  search: z.string().trim().min(1).max(120).optional(),
});

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
