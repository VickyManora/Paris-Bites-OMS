import type { SalesChannel } from '../../domain/enums/sales.enum.js';
import type { AnalyticsGranularity } from '../../domain/repositories/analytics.repository.js';

export interface AnalyticsTrendPointDto {
  /** ISO date of the bucket start. */
  readonly period: string;
  /** Ready to print on an axis — `27 Jul`, `W31 · 27 Jul`, `Jul 2026`. */
  readonly label: string;
  readonly revenue: number;
  readonly consumptionCost: number;
  readonly purchases: number;
  readonly transfers: number;
  /**
   * True when the bucket has takings for only some of its days.
   *
   * A month bar built from three entered days is not a month's revenue. The chart marks
   * these rather than letting them be read as complete.
   */
  readonly isPartial: boolean;
  readonly salesDaysRecorded: number;
  readonly salesDaysInPeriod: number;
}

export interface IngredientUsageDto {
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

export interface AnalyticsDto {
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
    /** Restates the caveat where it will be read, not only in the docs. */
    readonly asOf: 'now';
  };

  readonly foodCost: {
    readonly consumptionCost: number;
    readonly revenue: number;
    readonly percent: number | null;
    readonly linesPriced: number;
    readonly linesUnpriced: number;
    /**
     * Whether the ratio can be trusted as stated.
     *
     * False when any consumed line had no price: the cost side is then an understatement
     * by an unknown amount, which makes the percentage flattering rather than merely
     * imprecise. The UI says so instead of printing a confident number.
     */
    readonly isComplete: boolean;
  };

  readonly topIngredients: readonly IngredientUsageDto[];

  /**
   * Best sellers over the range, from POS lines.
   *
   * `sharePercent` is a share of **POS revenue**, not of all revenue: aggregator orders are
   * not itemised anywhere, so they cannot appear in a per-product ranking.
   */
  readonly topProducts: readonly {
    readonly productName: string;
    readonly quantity: number;
    readonly orders: number;
    readonly revenue: number;
    readonly sharePercent: number | null;
  }[];

  /**
   * Counter takings over the range.
   *
   * Reported beside `revenue` (the declared total) and **never added to it** — both describe
   * the same walk-in trade. `coversDeclared` is the share of declared revenue that went
   * through the till, which is the honest way to relate the two.
   */
  readonly posRevenue: {
    readonly total: number;
    readonly orders: number;
    readonly itemsSold: number;
    readonly averageOrderValue: number | null;
    readonly coversDeclaredPercent: number | null;
  };

  readonly purchases: { readonly total: number; readonly invoices: number };
  readonly transfers: { readonly total: number; readonly completed: number };

  readonly trend: readonly AnalyticsTrendPointDto[];

  /**
   * Metrics that were asked for and cannot be produced from the data the app holds.
   *
   * Shipped in the payload rather than hard-coded into the page, so the reason travels
   * with the answer — including into an export, where an absent chart would otherwise
   * look like an oversight.
   */
  readonly unavailable: readonly { readonly metric: string; readonly reason: string }[];
}

export interface GetAnalyticsInput {
  readonly from: Date;
  readonly to: Date;
  readonly granularity: AnalyticsGranularity;
}
