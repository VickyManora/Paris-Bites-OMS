/**
 * Audit actions for stock transfers.
 *
 * Separate from `AuditAction` in the auth domain so each area owns its own vocabulary, and
 * both write to the same append-only `audit_logs` table via `IAuditLogRepository` — whose
 * `action` column is typed as `string` precisely so features can add their own.
 *
 * These sit alongside the per-item `InventoryItemHistory` entries the stock legs write:
 * the audit log records **who decided what** about the transfer document, the item history
 * records **what happened to each item's stock**. Both are needed to reconstruct a move.
 */
export const TransferAuditAction = {
  CREATED: 'transfer.created',
  APPROVED: 'transfer.approved',
  REJECTED: 'transfer.rejected',
  COMPLETED: 'transfer.completed',
  /**
   * An approval attempt refused on business grounds — insufficient stock at the source, or
   * a transfer that was no longer in an approvable state.
   *
   * Deliberately not split by cause. The reason is carried in the entry's metadata, and a
   * cause-specific action name would mislabel the other cases: an earlier version recorded a
   * state-machine violation as "insufficient stock", which is worse than no detail at all.
   */
  APPROVAL_REFUSED: 'transfer.approval-refused',
} as const;

export type TransferAuditAction = (typeof TransferAuditAction)[keyof typeof TransferAuditAction];
