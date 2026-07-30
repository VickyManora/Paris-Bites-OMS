import type { Role } from '../../../core/models/role.model';

/** Mirrors the dashboard DTO from the API. */

export interface DashboardTask {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly route: string;
  readonly severity: 'info' | 'warning' | 'critical';
}

export interface LowStockItem {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly unitAbbreviation: string;
  readonly currentQuantity: number;
  readonly minimumQuantity: number;
  readonly isOutOfStock: boolean;
}

export interface TopIngredient {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string;
  readonly unitAbbreviation: string;
  /** The ranking metric — quantities cannot be compared across units. */
  readonly timesUsed: number;
  readonly totalQuantity: number;
  readonly displayQuantity: string;
}

export interface RecentActivity {
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

export interface DailyPoint {
  readonly date: string;
  readonly purchased: number;
  readonly consumed: number;
  readonly transferred: number;
  readonly adjusted: number;
}

export interface CategorySlice {
  readonly category: string;
  readonly label: string;
  readonly value: number;
}

export interface DashboardCharts {
  readonly stockMovement: readonly DailyPoint[];
  readonly purchaseSpend: readonly { date: string; amount: number }[];
  readonly valueByCategory: readonly CategorySlice[];
  readonly lowStockByCategory: readonly CategorySlice[];
  /**
   * Daily takings across the window. **Empty for a Store Manager** — revenue is admin-only
   * and is absent from their payload rather than hidden by the template.
   *
   * Days with no entry are absent rather than zero: an unrecorded day's takings are
   * unknown, and plotting zero would draw a trough that never happened.
   */
  readonly salesTrend: readonly { date: string; amount: number }[];
  /** Revenue by channel across the window. **Empty for a Store Manager.** */
  readonly salesByChannel: readonly CategorySlice[];
}

export interface Dashboard {
  readonly role: Role;
  readonly forDate: string;
  readonly generatedAt: string;
  readonly windowDays: number;

  readonly lowStock: {
    readonly needsRestocking: number;
    readonly outOfStock: number;
    readonly items: readonly LowStockItem[];
  };
  readonly pendingRequests: {
    readonly awaitingApproval: number;
    readonly awaitingReceipt: number;
    readonly total: number;
  };
  readonly tasks: readonly DashboardTask[];
  readonly recentActivity: readonly RecentActivity[];
  readonly charts: DashboardCharts;

  /** Admin only — absent from a Store Manager's payload, not merely hidden. */
  readonly todaysPurchases?: {
    readonly count: number;
    readonly totalValue: number;
    readonly totalTax: number;
  };
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
  readonly topIngredients?: readonly TopIngredient[];
  readonly writeDowns?: { readonly events: number; readonly itemsAffected: number };

  /**
   * Today's takings.
   *
   * `recorded` separates "not entered yet" from "entered as zero". Showing ₹0.00 for the
   * first at 6pm on a busy Saturday would be a lie the dashboard tells confidently.
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
    readonly daysRecorded: number;
    readonly daysElapsed: number;
  };
  /** Days in the window with nothing entered, today excluded. Newest first. */
  readonly unrecordedSalesDays?: readonly string[];

  /**
   * Today at the counter, from POS orders.
   *
   * **Never added to `todaysSales`.** Both describe the same walk-in trade — one from the
   * till, one typed in at close — so summing them double-counts every order.
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

  /** Declared walk-in versus counter walk-in. `declared` is null until the day is written up. */
  readonly walkInReconciliation?: {
    readonly declared: number | null;
    readonly counter: number;
    readonly variance: number | null;
  };

  readonly topProductsToday?: readonly {
    readonly productName: string;
    readonly quantity: number;
    readonly revenue: number;
  }[];

  readonly todaysConsumption?: {
    readonly sheets: number;
    readonly lines: number;
    readonly items: number;
  };
}

/**
 * Whole rupees, for dashboard tiles.
 *
 * Re-exported from the shared formatter rather than reimplemented. Every caller here wants
 * whole rupees — a tile has no room for paise — so this is `moneyCompact` under a local
 * name, kept because seven call sites read better as `money(...)` on this screen.
 */
export { moneyCompact as money } from '../../../shared/utils/format.utils';

/**
 * `DD MMM` for a chart axis.
 *
 * Built from the `YYYY-MM-DD` parts rather than by parsing into a `Date`: these are
 * calendar days, and a browser west of UTC would render each one as the day before.
 */
export function shortDate(iso: string): string {
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const [, month, day] = iso.split('-');
  const index = Number(month) - 1;

  return `${day ?? ''} ${MONTHS[index] ?? ''}`.trim();
}
