import { z } from 'zod';
import {
  ALL_TRANSFER_STATUSES,
  TRANSFER_SORT_FIELDS,
} from '../../../core/domain/enums/stock-transfer.enum.js';
import { QUANTITY_MAX } from '../../../core/domain/value-objects/inventory-quantity.js';
import { paginationQuerySchema, uuidSchema } from './common.validators.js';

const statusSchema = z.enum(ALL_TRANSFER_STATUSES as [string, ...string[]]);

/**
 * A transfer line.
 *
 * The quantity must be strictly positive — a zero line is not a transfer, and a negative one
 * would be a transfer in the opposite direction expressed by accident. Unit-specific rules
 * (whole numbers for pieces and boxes) are applied in the use case, which knows each item's
 * unit; the validator does not.
 */
const lineSchema = z.object({
  itemId: uuidSchema,
  quantity: z.coerce
    .number({ message: 'Enter a valid number.' })
    .finite('Enter a valid number.')
    .positive('Quantity must be greater than zero.')
    .max(QUANTITY_MAX, `Must be ${QUANTITY_MAX} or less.`),
});

export const createTransferSchema = z.object({
  // Bounded: a transfer document with hundreds of lines is a data-entry mistake, and each
  // line locks an inventory row on approval.
  lines: z
    .array(lineSchema)
    .min(1, 'Add at least one item to transfer.')
    .max(50, 'A transfer can hold at most 50 items.'),
  notes: z.string().trim().max(1000, 'Notes must be at most 1000 characters.').optional(),
});

/** Approval note is optional — approving needs no justification, refusing does. */
export const approveTransferSchema = z.object({
  note: z.string().trim().max(500, 'Note must be at most 500 characters.').optional(),
});

/**
 * Rejection requires a reason.
 *
 * Enforced here, in the use case, and by a database CHECK. A refusal the requester cannot
 * act on just produces a second identical request.
 */
export const rejectTransferSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Give a reason of at least 3 characters.')
    .max(500, 'Reason must be at most 500 characters.'),
});

/** Completion takes no body: it records receipt of what was already dispatched. */
export const completeTransferSchema = z.object({}).optional();

export const listTransfersQuerySchema = paginationQuerySchema.extend({
  status: statusSchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
  sortField: z.enum(TRANSFER_SORT_FIELDS).default('requestedAt'),
  // Newest first: the list is a work queue.
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateTransferBody = z.infer<typeof createTransferSchema>;
export type ApproveTransferBody = z.infer<typeof approveTransferSchema>;
export type RejectTransferBody = z.infer<typeof rejectTransferSchema>;
export type ListTransfersQuery = z.infer<typeof listTransfersQuerySchema>;
