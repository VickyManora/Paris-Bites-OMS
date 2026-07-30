import { z } from 'zod';
import { paginationQuerySchema } from './common.validators.js';

/**
 * Notification query validation.
 *
 * There is no `recipientId` anywhere in this file, and that is the point: the recipient
 * is always the authenticated caller, read from the verified token in the controller.
 * Accepting one from the client would be an inbox-wide read for any signed-in user.
 */

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  /**
   * Query parameters are strings, so the literal `'true'` is the opt-in and anything
   * else — including absence — means "all". Coercing with `z.coerce.boolean()` would
   * make `?unreadOnly=false` truthy, which is the opposite of what it says.
   */
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

/** Bounded so the bell cannot be used to page the whole table in one request. */
export const notificationFeedQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(20).default(10),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type NotificationFeedQuery = z.infer<typeof notificationFeedQuerySchema>;
