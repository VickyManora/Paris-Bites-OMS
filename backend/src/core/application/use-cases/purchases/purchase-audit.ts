/**
 * Audit actions for purchases.
 *
 * A purchase is immutable, so there is deliberately no `UPDATED` here — the vocabulary
 * would advertise an operation that does not exist. Corrections appear in the audit trail
 * as inventory adjustments instead, under their own action.
 */
export const PurchaseAuditAction = {
  /** An invoice was recorded and its stock added. */
  RECORDED: 'purchase.recorded',
  /** A bill was attached, or replaced. */
  INVOICE_UPLOADED: 'purchase.invoice-uploaded',
} as const;

export type PurchaseAuditAction =
  (typeof PurchaseAuditAction)[keyof typeof PurchaseAuditAction];
