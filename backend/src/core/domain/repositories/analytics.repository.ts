import type { SalesChannel } from '../enums/sales.enum.js';

/** How the trends are bucketed. A closed set — it reaches `date_trunc` through a lookup. */
export const AnalyticsGranularity = {
  DAY: 'day',
  WEEK: 'week',
  MONTH: 'month',
} as const;

export type AnalyticsGranularity =
  (typeof AnalyticsGranularity)[keyof typeof AnalyticsGranularity];

export const ALL_ANALYTICS_GRANULARITIES: readonly AnalyticsGranularity[] = [
  AnalyticsGranularity.DAY,
  AnalyticsGranularity.WEEK,
  AnalyticsGranularity.MONTH,
];

export interface AnalyticsQuery {
  readonly from: Date;
  readonly to: Date;
  readonly granularity: AnalyticsGranularity;
}

/**
 * One bucket on the shared time axis.
 *
 * Every measure is bucketed the same way and returned together, so the charts line up
 * exactly — a purchase spike can be read against the revenue dip that followed it. Four
 * separately-bucketed queries would each be defensible and would still drift by a day at
 * the edges, which is precisely where someone would draw a conclusion.
 */
export interface AnalyticsTrendPoint {
  /** ISO date of the bucket start. */
  readonly period: string;
  readonly revenue: number;
  /**
   * How much of the bucket has takings entered.
   *
   * A month showing three of thirty-one days is not a month's revenue, and a bar drawn
   * without this reads as though it were. The UI marks partial buckets.
   */
  readonly salesDaysRecorded: number;
  readonly salesDaysInPeriod: number;
  /** Cost of stock consumed, at each item's recorded purchase price. */
  readonly consumptionCost: number;
  readonly purchases: number;
  readonly transfers: number;
}

export interface IngredientUsageRow {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string;
  readonly quantity: number;
  readonly timesUsed: number;
  /** Null when the item has no recorded purchase price — not zero. */
  readonly cost: number | null;
}

export interface AnalyticsSnapshot {
  readonly revenue: {
    readonly total: number;
    readonly cash: number;
    readonly online: number;
    readonly daysRecorded: number;
    readonly daysInRange: number;
    /** Per **recorded** day. Null when nothing has been entered. */
    readonly averagePerRecordedDay: number | null;
    readonly byChannel: readonly { readonly channel: SalesChannel; readonly value: number }[];
  };

  /**
   * Stock on hand at cost — a snapshot of *now*, not of the range.
   *
   * The only figure here that ignores the date filter, because there is no stock ledger to
   * reconstruct a historical valuation from. Said out loud in the DTO so nobody reads it
   * as "inventory value during March".
   */
  readonly inventoryValue: {
    readonly total: number;
    readonly pricedItems: number;
    readonly unpricedItems: number;
  };

  /**
   * Food cost: what the kitchen used, against what it sold.
   *
   * `percent` is null unless both sides exist — a ratio against zero revenue is not a
   * large number, it is not a number. `linesUnpriced` is the honesty valve: every
   * unpriced consumption line makes the cost figure an understatement by an unknown
   * amount, so the coverage travels with the ratio.
   */
  readonly foodCost: {
    readonly consumptionCost: number;
    readonly revenue: number;
    readonly percent: number | null;
    readonly linesPriced: number;
    readonly linesUnpriced: number;
  };

  readonly topIngredients: readonly IngredientUsageRow[];

  /**
   * Best-selling products over the range, from POS order lines.
   *
   * This is what the POS added that declared daily totals never could: a rupee figure per
   * channel has no product in it. Covers counter trade only — aggregator orders are not
   * itemised anywhere — so the share is a share of POS revenue, not of all revenue.
   */
  readonly topProducts: readonly {
    readonly productName: string;
    readonly quantity: number;
    readonly orders: number;
    readonly revenue: number;
  }[];

  /** Counter takings over the range, reported beside declared revenue and never added to it. */
  readonly posRevenue: {
    readonly total: number;
    readonly orders: number;
    readonly itemsSold: number;
    readonly averageOrderValue: number | null;
  };

  readonly purchases: {
    readonly total: number;
    readonly invoices: number;
  };

  readonly transfers: {
    readonly total: number;
    readonly completed: number;
  };

  readonly trend: readonly AnalyticsTrendPoint[];
}

/**
 * Port for analytics.
 *
 * One method returning one snapshot, rather than a method per figure. Every number on the
 * page describes the same range and the same instant; splitting them across calls would
 * let a KPI tile and the chart beneath it disagree after a write landed between the two.
 */
export interface IAnalyticsRepository {
  snapshot(query: AnalyticsQuery): Promise<AnalyticsSnapshot>;
}
