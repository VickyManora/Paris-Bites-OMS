import type {
  DailySalesRevisionAction,
  SalesChannel,
  SalesPaymentMode,
} from '../../domain/enums/sales.enum.js';
import type {
  DailySalesFilter,
  DailySalesSortField,
} from '../../domain/repositories/daily-sales.repository.js';
import type { RequestContext } from './auth.dto.js';

export interface DailySalesLineDto {
  readonly id: string;
  readonly channel: SalesChannel;
  readonly channelLabel: string;
  readonly paymentMode: SalesPaymentMode;
  readonly paymentModeLabel: string;
  /** Stable `CHANNEL:MODE` key, so the form can address a bucket without matching pairs. */
  readonly bucket: string;
  readonly amount: number;
}

export interface DailySalesRevisionDto {
  readonly id: string;
  readonly revision: number;
  readonly action: DailySalesRevisionAction;
  readonly actionLabel: string;
  /** Frozen JSON: the lines and total as of this revision, plus the previous total. */
  readonly snapshot: unknown;
  readonly note: string | null;
  readonly actorName: string | null;
  readonly createdAt: string;
}

export interface DailySalesEntryDto {
  readonly id: string;
  /** `YYYY-MM-DD`. A calendar day, not an instant. */
  readonly entryDate: string;
  readonly totalAmount: number;
  readonly notes: string | null;

  readonly revision: number;
  /** True once corrected at least once — worth flagging in a list. */
  readonly isEdited: boolean;

  readonly lines: readonly DailySalesLineDto[];
  /** Per-bucket amounts keyed by `CHANNEL:MODE`, including the ones that took nothing. */
  readonly amounts: Readonly<Record<string, number>>;

  readonly walkInTotal: number;
  readonly aggregatorTotal: number;
  readonly cashTotal: number;
  readonly onlineTotal: number;
  /** Null on a day with no trade — see the entity. */
  readonly aggregatorSharePercent: number | null;
  readonly activeChannels: string;

  /** Newest first. Present on a single-entry read; empty in a list. */
  readonly revisions: readonly DailySalesRevisionDto[];

  readonly recordedByName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DailySalesSummaryDto {
  readonly days: number;
  readonly totalAmount: number;
  readonly cashTotal: number;
  readonly onlineTotal: number;
  readonly byChannel: Readonly<Record<SalesChannel, number>>;
  readonly averagePerDay: number | null;
  readonly bestDay: { readonly date: string; readonly amount: number } | null;
}

/** One bucket as submitted. Absent buckets are treated as zero. */
export interface DailySalesAmountInput {
  readonly channel: SalesChannel;
  readonly paymentMode: SalesPaymentMode;
  readonly amount: number;
}

export interface RecordDailySalesInput extends RequestContext {
  readonly actorId: string;
  /** `YYYY-MM-DD`, already parsed as UTC midnight by the validator. */
  readonly entryDate: Date;
  readonly notes?: string | undefined;
  readonly amounts: readonly DailySalesAmountInput[];
}

export interface UpdateDailySalesInput extends RequestContext {
  readonly actorId: string;
  readonly id: string;
  readonly notes?: string | undefined;
  readonly amounts: readonly DailySalesAmountInput[];
  /**
   * Why the figure changed. Required for a correction, absent when merely completing a day —
   * see `UpdateDailySalesUseCase`.
   */
  readonly reason?: string | undefined;
}

export interface ListDailySalesInput {
  readonly filter: DailySalesFilter;
  readonly page: number;
  readonly pageSize: number;
  readonly sortField?: DailySalesSortField | undefined;
  readonly sortDirection?: 'asc' | 'desc' | undefined;
}
