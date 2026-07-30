import type { SalesChannel } from '../../sales/models/daily-sales.model';

/** Mirrors the analytics DTO. */

export const AnalyticsGranularity = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
} as const;

export type AnalyticsGranularity = (typeof AnalyticsGranularity)[keyof typeof AnalyticsGranularity];

export interface AnalyticsTrendPoint {
  readonly period: string;
  readonly label: string;
  readonly revenue: number;
  readonly consumptionCost: number;
  readonly purchases: number;
  readonly transfers: number;
  /** The bucket has takings for only some of its days — not a complete period. */
  readonly isPartial: boolean;
  readonly salesDaysRecorded: number;
  readonly salesDaysInPeriod: number;
}

export interface IngredientUsage {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string;
  readonly unitAbbreviation: string;
  readonly quantity: number;
  readonly displayQuantity: string;
  readonly timesUsed: number;
  /** Null when the item has no recorded price — not zero. */
  readonly cost: number | null;
}

export interface Analytics {
  readonly from: string;
  readonly to: string;
  readonly granularity: AnalyticsGranularity;
  readonly generatedAt: string;

  readonly revenue: {
    readonly total: number;
    readonly cash: number;
    readonly online: number;
    readonly daysRecorded: number;
    readonly daysInRange: number;
    readonly averagePerRecordedDay: number | null;
    readonly byChannel: readonly {
      readonly channel: SalesChannel;
      readonly label: string;
      readonly value: number;
    }[];
  };

  /** Stock on hand **now** — the one figure that ignores the date range. */
  readonly inventoryValue: {
    readonly total: number;
    readonly pricedItems: number;
    readonly unpricedItems: number;
    readonly asOf: 'now';
  };

  readonly foodCost: {
    readonly consumptionCost: number;
    readonly revenue: number;
    readonly percent: number | null;
    readonly linesPriced: number;
    readonly linesUnpriced: number;
    /** False when any consumed line had no price, making the ratio flattering. */
    readonly isComplete: boolean;
  };

  readonly topIngredients: readonly IngredientUsage[];

  /** Best sellers from POS lines. `sharePercent` is a share of POS revenue, not of all. */
  readonly topProducts: readonly {
    readonly productName: string;
    readonly quantity: number;
    readonly orders: number;
    readonly revenue: number;
    readonly sharePercent: number | null;
  }[];

  /** Counter takings. Shown beside declared revenue, never added to it. */
  readonly posRevenue: {
    readonly total: number;
    readonly orders: number;
    readonly itemsSold: number;
    readonly averageOrderValue: number | null;
    readonly coversDeclaredPercent: number | null;
  };
  readonly purchases: { readonly total: number; readonly invoices: number };
  readonly transfers: { readonly total: number; readonly completed: number };
  readonly trend: readonly AnalyticsTrendPoint[];
  /** Metrics the data cannot support, with the reason. Rendered, not hidden. */
  readonly unavailable: readonly { readonly metric: string; readonly reason: string }[];
}

export interface AnalyticsQuery {
  readonly from: string;
  readonly to: string;
  readonly granularity: AnalyticsGranularity;
}

/** `YYYY-MM-DD` in local terms — what a date input expects. */
export function toDateInput(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface RangePreset {
  readonly key: string;
  readonly label: string;
  readonly granularity: AnalyticsGranularity;
  /** Resolved against "today" at click time, so a tab left open does not go stale. */
  readonly resolve: (today: Date) => { from: string; to: string };
}

function daysBack(today: Date, days: number): { from: string; to: string } {
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  return { from: toDateInput(start), to: toDateInput(today) };
}

/**
 * The ranges people actually ask for.
 *
 * Each carries the grain that suits it: a year at daily grain is 365 bars nobody can read,
 * and a week at monthly grain is one. Choosing the grain with the range is the difference
 * between a preset and a shortcut that still needs adjusting.
 */
export const RANGE_PRESETS: readonly RangePreset[] = [
  {
    key: 'last-7',
    label: 'Last 7 days',
    granularity: AnalyticsGranularity.DAY,
    resolve: (today) => daysBack(today, 7),
  },
  {
    key: 'last-30',
    label: 'Last 30 days',
    granularity: AnalyticsGranularity.DAY,
    resolve: (today) => daysBack(today, 30),
  },
  {
    key: 'this-month',
    label: 'This month',
    granularity: AnalyticsGranularity.DAY,
    resolve: (today) => ({
      from: toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: toDateInput(today),
    }),
  },
  {
    key: 'last-90',
    label: 'Last 90 days',
    granularity: AnalyticsGranularity.WEEK,
    resolve: (today) => daysBack(today, 90),
  },
  {
    key: 'this-year',
    label: 'This year',
    granularity: AnalyticsGranularity.MONTH,
    resolve: (today) => ({
      from: toDateInput(new Date(today.getFullYear(), 0, 1)),
      to: toDateInput(today),
    }),
  },
];
