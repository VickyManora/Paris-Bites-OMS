/** Mirrors the daily sales DTOs from the API. */

export const SalesChannel = {
  WALK_IN: 'WALK_IN',
  ZOMATO: 'ZOMATO',
  SWIGGY: 'SWIGGY',
} as const;

export type SalesChannel = (typeof SalesChannel)[keyof typeof SalesChannel];

export const SalesPaymentMode = {
  CASH: 'CASH',
  ONLINE: 'ONLINE',
} as const;

export type SalesPaymentMode = (typeof SalesPaymentMode)[keyof typeof SalesPaymentMode];

export const DailySalesRevisionAction = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
} as const;

export type DailySalesRevisionAction =
  (typeof DailySalesRevisionAction)[keyof typeof DailySalesRevisionAction];

/**
 * The four buckets a day is entered as.
 *
 * Mirrors `DAILY_SALES_BUCKETS` on the server, and the order here is the order the form
 * and the history table use. The aggregators have no cash bucket: they settle to the
 * bank, so offering one would invite a figure nobody can reconcile.
 */
export const SALES_BUCKETS: readonly {
  readonly key: string;
  readonly channel: SalesChannel;
  readonly paymentMode: SalesPaymentMode;
  readonly label: string;
  readonly shortLabel: string;
  readonly icon: string;
  readonly hint: string;
}[] = [
  {
    key: 'WALK_IN:CASH',
    channel: SalesChannel.WALK_IN,
    paymentMode: SalesPaymentMode.CASH,
    label: 'Walk-in — cash',
    shortLabel: 'Cash',
    icon: 'payments',
    hint: 'Notes and coins counted at the cart',
  },
  {
    key: 'WALK_IN:ONLINE',
    channel: SalesChannel.WALK_IN,
    paymentMode: SalesPaymentMode.ONLINE,
    label: 'Walk-in — online',
    shortLabel: 'Online',
    icon: 'qr_code_2',
    hint: 'UPI and card taken at the cart',
  },
  {
    key: 'ZOMATO:ONLINE',
    channel: SalesChannel.ZOMATO,
    paymentMode: SalesPaymentMode.ONLINE,
    label: 'Zomato',
    shortLabel: 'Zomato',
    icon: 'delivery_dining',
    hint: 'Order value before commission',
  },
  {
    key: 'SWIGGY:ONLINE',
    channel: SalesChannel.SWIGGY,
    paymentMode: SalesPaymentMode.ONLINE,
    label: 'Swiggy',
    shortLabel: 'Swiggy',
    icon: 'two_wheeler',
    hint: 'Order value before commission',
  },
];

export const SALES_CHANNEL_LABELS: Readonly<Record<SalesChannel, string>> = {
  WALK_IN: 'Walk-in',
  ZOMATO: 'Zomato',
  SWIGGY: 'Swiggy',
};

export interface DailySalesLine {
  readonly id: string;
  readonly channel: SalesChannel;
  readonly channelLabel: string;
  readonly paymentMode: SalesPaymentMode;
  readonly paymentModeLabel: string;
  readonly bucket: string;
  readonly amount: number;
}

/** Frozen JSON written when the day was recorded or corrected. */
export interface DailySalesSnapshot {
  readonly totalAmount: number;
  /** Present only on a correction — what the day said before. */
  readonly previousTotal?: number;
  readonly lines: readonly {
    readonly channel: SalesChannel;
    readonly paymentMode: SalesPaymentMode;
    readonly amount: number;
  }[];
}

export interface DailySalesRevision {
  readonly id: string;
  readonly revision: number;
  readonly action: DailySalesRevisionAction;
  readonly actionLabel: string;
  readonly snapshot: DailySalesSnapshot;
  readonly note: string | null;
  readonly actorName: string | null;
  readonly createdAt: string;
}

export interface DailySalesEntry {
  readonly id: string;
  /** `YYYY-MM-DD`. A calendar day, not an instant. */
  readonly entryDate: string;
  readonly totalAmount: number;
  readonly notes: string | null;

  readonly revision: number;
  readonly isEdited: boolean;

  readonly lines: readonly DailySalesLine[];
  /** Every bucket, including the ones that took nothing. Keyed by `CHANNEL:MODE`. */
  readonly amounts: Readonly<Record<string, number>>;

  readonly walkInTotal: number;
  readonly aggregatorTotal: number;
  readonly cashTotal: number;
  readonly onlineTotal: number;
  /** Null on a day with no trade — not zero, which would be a different statement. */
  readonly aggregatorSharePercent: number | null;
  readonly activeChannels: string;

  readonly revisions: readonly DailySalesRevision[];

  readonly recordedByName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DailySalesSummary {
  readonly days: number;
  readonly totalAmount: number;
  readonly cashTotal: number;
  readonly onlineTotal: number;
  readonly byChannel: Readonly<Record<SalesChannel, number>>;
  readonly averagePerDay: number | null;
  readonly bestDay: { readonly date: string; readonly amount: number } | null;
}

export interface DailySalesAmount {
  readonly channel: SalesChannel;
  readonly paymentMode: SalesPaymentMode;
  readonly amount: number;
}

export interface RecordDailySalesRequest {
  readonly entryDate: string;
  readonly notes?: string | undefined;
  readonly amounts: readonly DailySalesAmount[];
}

export interface UpdateDailySalesRequest {
  readonly notes?: string | undefined;
  readonly amounts: readonly DailySalesAmount[];
  readonly reason: string;
}

export type DailySalesSortField = 'entryDate' | 'totalAmount';

export interface DailySalesQuery {
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
  readonly fromDate?: string | undefined;
  readonly toDate?: string | undefined;
  readonly channel?: SalesChannel | undefined;
  readonly sortField?: DailySalesSortField | undefined;
  readonly sortDirection?: 'asc' | 'desc' | undefined;
}

/** `YYYY-MM-DD` for a `Date`, in local terms — what a date input expects. */
export function toDateInput(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
