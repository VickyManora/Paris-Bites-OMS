/**
 * Audit actions for suppliers.
 *
 * Separate from the auth and transfer vocabularies so each area owns its own, all writing
 * to the same append-only `audit_logs` table — whose `action` column is typed as `string`
 * precisely so features can add their own.
 */
export const SupplierAuditAction = {
  CREATED: 'supplier.created',
  UPDATED: 'supplier.updated',
  DELETED: 'supplier.deleted',
  /**
   * A delete that became a deactivation because the supplier had purchase history.
   *
   * Recorded distinctly from `DELETED` on purpose: the row is still there and still
   * resolvable from its invoices, and an investigator reading "deleted" would waste time
   * looking for something that was never removed.
   */
  DEACTIVATED: 'supplier.deactivated',
} as const;

export type SupplierAuditAction =
  (typeof SupplierAuditAction)[keyof typeof SupplierAuditAction];
