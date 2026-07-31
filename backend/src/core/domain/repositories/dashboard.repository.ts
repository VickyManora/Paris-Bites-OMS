/**
 * Aggregates for the dashboard, owned by the domain.
 *
 * A separate port from the feature repositories on purpose. Assembling this screen from
 * `IPurchaseRepository.findMany`, `IConsumptionRepository.summary` and friends would mean
 * a dozen round trips returning full entities so that the use case could count them —
 * these are group-bys, and they belong in SQL.
 */

export interface LowStockRow {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly currentQuantity: number;
  readonly minimumQuantity: number;
}

export interface TopIngredientRow {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string;
  readonly timesUsed: number;
  readonly totalQuantity: number;
}

export interface DailyMovementRow {
  readonly date: string;
  readonly purchased: number;
  readonly consumed: number;
  readonly transferred: number;
  readonly adjusted: number;
}

export interface CategoryValueRow {
  readonly category: string;
  readonly value: number;
}

export interface DashboardAggregates {
  readonly lowStock: {
    readonly needsRestocking: number;
    readonly outOfStock: number;
    readonly items: readonly LowStockRow[];
  };
  readonly pendingRequests: {
    readonly awaitingApproval: number;
    readonly awaitingReceipt: number;
  };
  readonly todaysPurchases: { readonly count: number; readonly totalValue: number; readonly totalTax: number };
  readonly inventoryValue: {
    readonly total: number;
    readonly pricedItems: number;
    readonly unpricedItems: number;
  };
  readonly transfersToday: {
    readonly requested: number;
    readonly completed: number;
    readonly inTransit: number;
  };
  readonly todaysConsumption: {
    readonly sheets: number;
    readonly lines: number;
    readonly items: number;
  };

  /**
   * Days in the window with no consumption sheet, most recent first, excluding today.
   *
   * The same anti-join as `unrecordedSalesDays` and excluded on the same reasoning: today is
   * not late yet, because the sheet is written up as the day is worked. Yesterday is.
   *
   * This exists because "was it recorded today" is the wrong question to nag on. The sheet for
   * a day is routinely finished the next morning, so a dashboard that only knows about today
   * says nothing at 9am about the day that actually got missed — and consumption, like takings,
   * cannot be reconstructed afterwards from anything the system holds. Somebody has to
   * remember what the cart used, and they only remember for about a day.
   */
  readonly unrecordedConsumptionDays: readonly string[];
  readonly topIngredients: readonly TopIngredientRow[];
  readonly writeDowns: { readonly events: number; readonly itemsAffected: number };
  readonly purchasesMissingInvoice: number;
  readonly stockMovement: readonly DailyMovementRow[];
  readonly purchaseSpend: readonly { readonly date: string; readonly amount: number }[];

  /**
   * Today's takings.
   *
   * `recorded` is not decoration. Zero because the day has not been entered yet and zero
   * because nothing sold are completely different facts, and a tile that shows ₹0.00 for
   * the first is actively misleading at 6pm on a busy Saturday.
   */
  readonly todaysSales: {
    readonly recorded: boolean;
    readonly total: number;
    readonly cash: number;
    readonly online: number;
    readonly walkIn: number;
    readonly aggregator: number;
  };
  /** Calendar month to date, and how many of its days have actually been entered. */
  readonly salesMonthToDate: {
    readonly total: number;
    readonly daysRecorded: number;
    readonly daysElapsed: number;
  };
  /** Daily takings across the window. Days with no entry are absent, not zero. */
  readonly salesTrend: readonly { readonly date: string; readonly amount: number }[];
  readonly salesByChannel: readonly { readonly channel: string; readonly value: number }[];
  /**
   * Days in the window with no entry, most recent first, excluding today.
   *
   * Today is excluded because it is not late yet — the takings are entered after close.
   * Anything older is a gap, and a gap in revenue data is the one thing this module cannot
   * reconstruct later.
   */
  readonly unrecordedSalesDays: readonly string[];

  /**
   * Today at the counter, from POS orders.
   *
   * Deliberately **separate from** `todaysSales`, which is the admin's declared figure. The
   * two describe the same walk-in trade from different sources — the counter's own record and
   * a figure typed in at close — so they are reported side by side and never added. Summing
   * them would double-count every order taken.
   */
  readonly posToday: {
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
   * Declared walk-in against counter walk-in, for today.
   *
   * `variance = declared − counter`. Positive means more was declared than the POS recorded —
   * a sale taken without going through the till. Negative means the opposite.
   *
   * `declared` is **null** when no daily entry exists yet, which is the normal state until
   * close of business. A null there is not zero, and the difference matters: at 6pm it means
   * "not yet counted", and reporting it as a −₹4,200 shortfall would be alarming nonsense.
   */
  readonly walkInReconciliation: {
    readonly declared: number | null;
    readonly counter: number;
    readonly variance: number | null;
  };

  /** Best sellers today, from POS lines. Only POS data can answer this. */
  readonly topProductsToday: readonly {
    readonly productName: string;
    readonly quantity: number;
    readonly revenue: number;
  }[];
  readonly valueByCategory: readonly CategoryValueRow[];
  readonly lowStockByCategory: readonly CategoryValueRow[];
}

export interface IDashboardRepository {
  /**
   * Every figure the dashboard needs, for one calendar day and a trailing window.
   *
   * Returns the full set regardless of who is asking; the use case decides what a given
   * role is shown. Filtering in SQL per role would mean two nearly identical query sets
   * that could drift apart.
   */
  aggregate(forDate: Date, windowDays: number): Promise<DashboardAggregates>;
}
