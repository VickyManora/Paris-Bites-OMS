/**
 * Sales vocabulary.
 *
 * Domain-owned, bridged to Prisma's generated enums by an exhaustive switch in the
 * mapper that stops compiling if the two diverge.
 */

export const SalesChannel = {
  /** The cart itself — money taken at the counter. */
  WALK_IN: 'WALK_IN',
  ZOMATO: 'ZOMATO',
  SWIGGY: 'SWIGGY',
} as const;

export type SalesChannel = (typeof SalesChannel)[keyof typeof SalesChannel];

export const ALL_SALES_CHANNELS: readonly SalesChannel[] = [
  SalesChannel.WALK_IN,
  SalesChannel.ZOMATO,
  SalesChannel.SWIGGY,
];

export function isSalesChannel(value: unknown): value is SalesChannel {
  return typeof value === 'string' && Object.hasOwn(SalesChannel, value);
}

export const SALES_CHANNEL_LABELS: Readonly<Record<SalesChannel, string>> = {
  [SalesChannel.WALK_IN]: 'Walk-in',
  [SalesChannel.ZOMATO]: 'Zomato',
  [SalesChannel.SWIGGY]: 'Swiggy',
};

/**
 * Whether a channel is an aggregator.
 *
 * Used for the "own counter versus platforms" split, which is the comparison the
 * business actually makes — aggregator revenue arrives net of commission and days later,
 * so adding it to counter takings without saying so overstates what is in the till.
 */
export function isAggregator(channel: SalesChannel): boolean {
  return channel !== SalesChannel.WALK_IN;
}

export const SalesPaymentMode = {
  CASH: 'CASH',
  ONLINE: 'ONLINE',
} as const;

export type SalesPaymentMode = (typeof SalesPaymentMode)[keyof typeof SalesPaymentMode];

export const ALL_SALES_PAYMENT_MODES: readonly SalesPaymentMode[] = [
  SalesPaymentMode.CASH,
  SalesPaymentMode.ONLINE,
];

export const SALES_PAYMENT_MODE_LABELS: Readonly<Record<SalesPaymentMode, string>> = {
  [SalesPaymentMode.CASH]: 'Cash',
  [SalesPaymentMode.ONLINE]: 'Online',
};

export const DailySalesRevisionAction = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
} as const;

export type DailySalesRevisionAction =
  (typeof DailySalesRevisionAction)[keyof typeof DailySalesRevisionAction];

/**
 * The buckets a day is entered as.
 *
 * Declared once, here, and used by the API's defaults, the form and the history table.
 * The aggregators appear as `ONLINE` because they settle to the bank — there is no cash
 * bucket for them to offer, and offering one would invite a figure nobody can reconcile.
 *
 * Order matters: it is the order the form presents and the table columns follow.
 */
export const DAILY_SALES_BUCKETS: readonly {
  readonly channel: SalesChannel;
  readonly paymentMode: SalesPaymentMode;
  readonly label: string;
}[] = [
  { channel: SalesChannel.WALK_IN, paymentMode: SalesPaymentMode.CASH, label: 'Walk-in · Cash' },
  { channel: SalesChannel.WALK_IN, paymentMode: SalesPaymentMode.ONLINE, label: 'Walk-in · Online' },
  { channel: SalesChannel.ZOMATO, paymentMode: SalesPaymentMode.ONLINE, label: 'Zomato' },
  { channel: SalesChannel.SWIGGY, paymentMode: SalesPaymentMode.ONLINE, label: 'Swiggy' },
];

/** Stable key for one bucket, used by the DTOs and the form. */
export function bucketKey(channel: SalesChannel, paymentMode: SalesPaymentMode): string {
  return `${channel}:${paymentMode}`;
}
