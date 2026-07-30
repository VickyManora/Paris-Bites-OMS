import type { Role } from '../../domain/enums/role.enum.js';

/**
 * One actionable item on the "today" list.
 *
 * Derived from live state rather than stored: there is no task table, and there should not
 * be one — a task nobody completes would linger after the work was done, while "four items
 * are below their reorder level" is true exactly as long as it is true.
 */
export interface DashboardTaskDto {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  /** Where acting on it starts. A task the user cannot reach is a nag, not a task. */
  readonly route: string;
  readonly severity: 'info' | 'warning' | 'critical';
}

export interface LowStockItemDto {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly unitAbbreviation: string;
  readonly currentQuantity: number;
  readonly minimumQuantity: number;
  readonly isOutOfStock: boolean;
}

export interface TopIngredientDto {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string;
  readonly unitAbbreviation: string;
  /**
   * How many sheets it appeared on. This is the ranking metric, not the quantity.
   *
   * Quantities cannot be ranked across items: 3 litres of cream and 1.2 kilograms of
   * chocolate do not compare, and a bar chart that put them on one axis would invent a
   * relationship. Occurrences are unit-free, so they rank honestly — the total is shown
   * beside each bar in the ingredient's own unit.
   */
  readonly timesUsed: number;
  readonly totalQuantity: number;
  readonly displayQuantity: string;
}

export interface RecentActivityDto {
  readonly id: string;
  readonly itemName: string;
  readonly action: string;
  readonly actionLabel: string;
  readonly quantityBefore: number | null;
  readonly quantityAfter: number | null;
  readonly delta: number | null;
  readonly note: string | null;
  readonly actorName: string | null;
  readonly createdAt: string;
}

/** A day on a time-series chart. */
export interface DailyPointDto {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly purchased: number;
  readonly consumed: number;
  readonly transferred: number;
  readonly adjusted: number;
}

export interface CategorySliceDto {
  readonly category: string;
  readonly label: string;
  readonly value: number;
}

export interface DashboardChartsDto {
  /**
   * Movements per day by kind, over the trailing window.
   *
   * **Counts, not quantities.** Summing a kilogram, a litre and a packet produces a number
   * with no unit and no meaning; counting how many times stock moved is comparable across
   * every item in the business.
   */
  readonly stockMovement: readonly DailyPointDto[];
  /** Purchase spend per day, in rupees — additive across everything, unlike quantities. */
  readonly purchaseSpend: readonly { date: string; amount: number }[];
  /** Stock value by category. Only priced items contribute; see `inventoryValue`. */
  readonly valueByCategory: readonly CategorySliceDto[];
  /** How many items in each category need restocking. */
  readonly lowStockByCategory: readonly CategorySliceDto[];
  /**
   * Daily takings across the window. **Admin only — empty for a Store Manager.**
   *
   * Days with no entry are absent rather than zero: an unrecorded day has an unknown
   * figure, and plotting it as zero draws a trough that never happened.
   */
  readonly salesTrend: readonly { readonly date: string; readonly amount: number }[];
  /** Revenue by channel across the window. **Admin only — empty for a Store Manager.** */
  readonly salesByChannel: readonly CategorySliceDto[];
}

export interface DashboardDto {
  /** Which layout the client should render. The payload only carries what this role sees. */
  readonly role: Role;
  /** The day the figures describe, as the caller's own calendar day. */
  readonly forDate: string;
  readonly generatedAt: string;
  readonly windowDays: number;

  // --- Shared -------------------------------------------------------------
  readonly lowStock: {
    readonly needsRestocking: number;
    readonly outOfStock: number;
    readonly items: readonly LowStockItemDto[];
  };
  readonly pendingRequests: {
    readonly awaitingApproval: number;
    readonly awaitingReceipt: number;
    readonly total: number;
  };
  readonly tasks: readonly DashboardTaskDto[];
  readonly recentActivity: readonly RecentActivityDto[];
  readonly charts: DashboardChartsDto;

  // --- Admin only ---------------------------------------------------------
  readonly todaysPurchases?: {
    readonly count: number;
    readonly totalValue: number;
    readonly totalTax: number;
  };
  /**
   * Stock at cost.
   *
   * `unpricedItems` is reported alongside the total because the figure is only as complete
   * as the pricing behind it — a valuation quoted without saying how much of the shelf it
   * covers is the kind of number that ends up in a report unchallenged.
   */
  readonly inventoryValue?: {
    readonly total: number;
    readonly pricedItems: number;
    readonly unpricedItems: number;
  };
  readonly transfersToday?: {
    readonly requested: number;
    readonly completed: number;
    readonly inTransit: number;
  };
  readonly topIngredients?: readonly TopIngredientDto[];
  /**
   * Stock written down by hand over the window.
   *
   * **This is not a dedicated wastage record — the system has none.** It counts manual
   * downward adjustments, which is where waste actually lands today: someone bins a spoiled
   * tub and adjusts the stock down. It therefore also catches stocktake corrections, so it
   * is labelled "write-downs" rather than "wastage" in the UI. A real figure needs a
   * write-off feature that captures a reason.
   */
  readonly writeDowns?: {
    readonly events: number;
    readonly itemsAffected: number;
  };
  /**
   * Today's takings.
   *
   * `recorded` distinguishes "not entered yet" from "entered as zero". The tile shows a
   * prompt for the first and a figure for the second — ₹0.00 at 6pm on a busy Saturday is
   * a lie the dashboard should not tell.
   */
  readonly todaysSales?: {
    readonly recorded: boolean;
    readonly total: number;
    readonly cash: number;
    readonly online: number;
    readonly walkIn: number;
    readonly aggregator: number;
  };
  readonly salesMonthToDate?: {
    readonly total: number;
    /** Of `daysElapsed`. A total over 3 of 14 days is a different claim from a month's. */
    readonly daysRecorded: number;
    readonly daysElapsed: number;
  };
  /** Days in the window with nothing entered, today excluded. Newest first. */
  readonly unrecordedSalesDays?: readonly string[];

  /**
   * Today at the counter, from POS orders.
   *
   * Separate from `todaysSales`, which is the declared figure. **The two are never added** —
   * they describe the same walk-in trade from two sources, and summing them double-counts
   * every order.
   */
  readonly posToday?: {
    readonly orders: number;
    readonly paidOrders: number;
    readonly pendingOrders: number;
    readonly revenue: number;
    readonly pendingAmount: number;
    readonly itemsSold: number;
    readonly cash: number;
    readonly online: number;
  };

  /**
   * Declared walk-in versus counter walk-in, today.
   *
   * `declared` is null until the day is written up, which is normal before close. A null is
   * not zero: reporting an uncounted day as a full shortfall would be alarming nonsense.
   */
  readonly walkInReconciliation?: {
    readonly declared: number | null;
    readonly counter: number;
    readonly variance: number | null;
  };

  /** Best sellers today. Only POS data can answer this. */
  readonly topProductsToday?: readonly {
    readonly productName: string;
    readonly quantity: number;
    readonly revenue: number;
  }[];

  // --- Store Manager only -------------------------------------------------
  readonly todaysConsumption?: {
    readonly sheets: number;
    readonly lines: number;
    readonly items: number;
  };
}

export interface GetDashboardInput {
  readonly role: Role;
  readonly userId: string;
  /**
   * The caller's own calendar day, `YYYY-MM-DD`.
   *
   * Supplied by the client rather than read from the server clock. The database runs in
   * UTC and the business does not: at 02:00 in Mumbai it is still the previous day in UTC,
   * so "today's purchases" computed server-side would show yesterday's for five and a half
   * hours every night.
   */
  readonly forDate: Date;
  /** Trailing window for the charts and the usage rankings. */
  readonly windowDays: number;
}
