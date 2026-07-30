/**
 * Daily-consumption vocabulary, owned by the domain.
 *
 * Not re-exported from Prisma's generated enums: the domain must not depend on the
 * persistence layer. `ConsumptionPrismaMapper` bridges the two with exhaustive switches
 * that stop compiling if they diverge.
 */

export const ConsumptionRevisionAction = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  VOIDED: 'VOIDED',
} as const;

export type ConsumptionRevisionAction =
  (typeof ConsumptionRevisionAction)[keyof typeof ConsumptionRevisionAction];

export const CONSUMPTION_REVISION_ACTION_LABELS: Readonly<
  Record<ConsumptionRevisionAction, string>
> = {
  [ConsumptionRevisionAction.CREATED]: 'Recorded',
  [ConsumptionRevisionAction.UPDATED]: 'Edited',
  [ConsumptionRevisionAction.VOIDED]: 'Voided',
};

/** Sortable columns. A closed set, so a caller cannot sort by an unindexed column. */
export const CONSUMPTION_SORT_FIELDS = ['entryDate', 'createdAt'] as const;

export type ConsumptionSortField = (typeof CONSUMPTION_SORT_FIELDS)[number];

/**
 * The most lines one entry may hold.
 *
 * A day's sheet is a handful of ingredients. A hundred is a sign something is wrong with
 * the caller, and each line locks an inventory row for the transaction's duration.
 */
export const MAX_CONSUMPTION_LINES = 100;
