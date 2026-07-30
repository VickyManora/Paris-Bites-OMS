import type { Page, PageRequest } from '../../../shared/pagination.js';
import type { DailySalesEntry } from '../entities/daily-sales-entry.entity.js';
import type { SalesChannel, SalesPaymentMode } from '../enums/sales.enum.js';

/** One bucket's takings, as submitted. */
export interface DailySalesLineData {
  readonly channel: SalesChannel;
  readonly paymentMode: SalesPaymentMode;
  readonly amount: number;
}

export interface RecordDailySalesData {
  readonly entryDate: Date;
  readonly notes: string | undefined;
  readonly recordedById: string;
  readonly lines: readonly DailySalesLineData[];
}

export interface UpdateDailySalesData {
  readonly notes: string | undefined;
  readonly lines: readonly DailySalesLineData[];
  readonly actorId: string;
  /** Why the figure changed. Required — a silent correction is not auditable. */
  readonly note: string;
}

export type DailySalesSortField = 'entryDate' | 'totalAmount';

export interface DailySalesFilter {
  readonly fromDate?: Date | undefined;
  readonly toDate?: Date | undefined;
  /** Restrict to days that took money through this channel. */
  readonly channel?: SalesChannel | undefined;
  readonly sortField?: DailySalesSortField | undefined;
  readonly sortDirection?: 'asc' | 'desc' | undefined;
}

/** Totals over the same filter as the list, so the two can never disagree. */
export interface DailySalesSummary {
  readonly days: number;
  readonly totalAmount: number;
  readonly cashTotal: number;
  readonly onlineTotal: number;
  readonly byChannel: Readonly<Record<SalesChannel, number>>;
  /** Mean takings per **recorded** day, not per calendar day. Null when none. */
  readonly averagePerDay: number | null;
  readonly bestDay: { readonly date: string; readonly amount: number } | null;
}

/**
 * Port for daily sales persistence.
 *
 * `record` and `update` both take the complete set of lines rather than a delta. A day's
 * takings is a single statement about that day — "walk-in cash was 4,200, Zomato 1,100" —
 * and patching one bucket at a time would make a half-applied edit representable.
 */
export interface IDailySalesRepository {
  findById(id: string): Promise<DailySalesEntry | null>;

  /** The live entry for a calendar day, if one exists. Drives the one-per-day rule. */
  findByDate(entryDate: Date): Promise<DailySalesEntry | null>;

  findMany(filter: DailySalesFilter, page: PageRequest): Promise<Page<DailySalesEntry>>;

  /**
   * Writes the day and its lines in one transaction.
   *
   * Throws `ConflictError` if a live entry already exists for that date. The partial
   * unique index is the real guard — a read-then-write in the use case would let two
   * concurrent submissions both pass the check and double-count the day.
   */
  record(data: RecordDailySalesData): Promise<DailySalesEntry>;

  /** Replaces the lines and appends a revision, in one transaction. */
  update(id: string, data: UpdateDailySalesData): Promise<DailySalesEntry>;

  /** Soft delete, so the date becomes free again and the row stays explicable. */
  softDelete(id: string): Promise<void>;

  summary(filter: DailySalesFilter): Promise<DailySalesSummary>;
}
