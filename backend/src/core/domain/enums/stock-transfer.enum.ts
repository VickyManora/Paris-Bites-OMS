/**
 * Stock transfer vocabulary and its state machine.
 *
 * Domain-owned; `StockTransferPrismaMapper` bridges to Prisma's generated enum with an
 * exhaustive switch that stops compiling if the two diverge.
 */

export const StockTransferStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED',
} as const;

export type StockTransferStatus = (typeof StockTransferStatus)[keyof typeof StockTransferStatus];

export const ALL_TRANSFER_STATUSES: readonly StockTransferStatus[] = [
  StockTransferStatus.PENDING,
  StockTransferStatus.APPROVED,
  StockTransferStatus.REJECTED,
  StockTransferStatus.COMPLETED,
];

export const TRANSFER_STATUS_LABELS: Readonly<Record<StockTransferStatus, string>> = {
  [StockTransferStatus.PENDING]: 'Pending approval',
  // "In transit" rather than "Approved": the source stock has already left, which is what
  // the reader needs to know. The status name records the decision; the label describes
  // where the goods are.
  [StockTransferStatus.APPROVED]: 'In transit',
  [StockTransferStatus.REJECTED]: 'Rejected',
  [StockTransferStatus.COMPLETED]: 'Completed',
};

/**
 * The only legal transitions.
 *
 * ```
 *   PENDING ──approve──▶ APPROVED ──complete──▶ COMPLETED
 *      │
 *      └────reject────▶ REJECTED
 * ```
 *
 * `REJECTED` and `COMPLETED` are terminal. Expressing this as data rather than as
 * scattered `if` statements means every caller asks the same question, and adding a
 * transition (a cancellation, say) is one entry here.
 *
 * Crucially, `PENDING → COMPLETED` is **not** legal: skipping approval would move stock
 * with nobody having authorised it.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<StockTransferStatus, readonly StockTransferStatus[]>> = {
  [StockTransferStatus.PENDING]: [StockTransferStatus.APPROVED, StockTransferStatus.REJECTED],
  [StockTransferStatus.APPROVED]: [StockTransferStatus.COMPLETED],
  [StockTransferStatus.REJECTED]: [],
  [StockTransferStatus.COMPLETED]: [],
};

export function canTransition(from: StockTransferStatus, to: StockTransferStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** True once no further transition is possible. */
export function isTerminalStatus(status: StockTransferStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/**
 * True while the source stock has been deducted but the destination has not been credited.
 *
 * The one state where stock is neither in the warehouse nor on the cart, which is exactly
 * what "in transit" means — and why the two legs cannot be collapsed into one status.
 */
export function isInTransit(status: StockTransferStatus): boolean {
  return status === StockTransferStatus.APPROVED;
}

export function isTransferStatus(value: unknown): value is StockTransferStatus {
  return typeof value === 'string' && Object.hasOwn(ALLOWED_TRANSITIONS, value);
}

/** Sortable columns for the transfer list. A closed set, so no unindexed sort. */
export const TRANSFER_SORT_FIELDS = [
  'reference',
  'status',
  'requestedAt',
  'reviewedAt',
  'completedAt',
] as const;

export type TransferSortField = (typeof TRANSFER_SORT_FIELDS)[number];
