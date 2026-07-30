/**
 * Audit actions for consumption entries.
 *
 * These sit alongside `ConsumptionEntryRevision`, which is the entry's *own* history and
 * is what its screen renders. The audit log answers a different question — "what did this
 * user do across the system" — and is queried by actor and time rather than by entry.
 */
export const ConsumptionAuditAction = {
  RECORDED: 'consumption.recorded',
  UPDATED: 'consumption.updated',
  VOIDED: 'consumption.voided',
} as const;

export type ConsumptionAuditAction =
  (typeof ConsumptionAuditAction)[keyof typeof ConsumptionAuditAction];

export const CONSUMPTION_ENTITY_TYPE = 'ConsumptionEntry';
