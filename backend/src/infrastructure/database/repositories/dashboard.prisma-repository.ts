import type { PrismaClient } from '../../../generated/prisma/client.js';
import type {
  CategoryValueRow,
  DailyMovementRow,
  DashboardAggregates,
  IDashboardRepository,
  LowStockRow,
  TopIngredientRow,
} from '../../../core/domain/repositories/dashboard.repository.js';

/**
 * Narrows whatever a raw query hands back into a plain number.
 *
 * Raw SQL returns three different shapes here and every one of them breaks JSON if it
 * escapes: `count()` is a bigint, which `JSON.stringify` refuses outright; `sum()` on a
 * numeric column is a `Prisma.Decimal`, which serialises as a *string* and would reach the
 * client as `"1416.00"` where it expects a number; and some driver paths hand back plain
 * strings. All three are converted at the boundary so nothing downstream has to know.
 */
function toNumber(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // Prisma.Decimal and anything else exposing a numeric conversion.
  const candidate = value as { toNumber?: () => number };

  if (typeof candidate.toNumber === 'function') {
    return candidate.toNumber();
  }

  const coerced = Number(value);
  return Number.isFinite(coerced) ? coerced : 0;
}

/** Currency scale, for the figures derived by subtraction rather than summed. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** `YYYY-MM-DD` from the UTC parts — every date column here is a calendar day. */
function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Dashboard aggregates.
 *
 * Raw SQL throughout, because every figure here is a group-by, a filtered count or a
 * cross-column comparison — the things Prisma's query API either cannot express or would
 * express by fetching rows and counting them in JavaScript.
 *
 * The queries run inside one transaction so the whole screen describes a single snapshot.
 * Without it a purchase recorded mid-render could be counted by the totals tile and missed
 * by the chart, and the two would disagree by one for no visible reason.
 */
export class DashboardPrismaRepository implements IDashboardRepository {
  constructor(private readonly client: PrismaClient) {}

  async aggregate(forDate: Date, windowDays: number): Promise<DashboardAggregates> {
    const day = toDateOnly(forDate);

    // The window is inclusive of today, so 14 days means today and the 13 before it.
    const windowStart = new Date(forDate);
    windowStart.setUTCDate(windowStart.getUTCDate() - (windowDays - 1));
    const from = toDateOnly(windowStart);

    const [
      lowStockCounts,
      lowStockItems,
      pending,
      purchasesToday,
      inventoryValue,
      transfersToday,
      consumptionToday,
      topIngredients,
      writeDowns,
      missingInvoices,
      movement,
      spend,
      valueByCategory,
      lowStockByCategory,
      salesToday,
      salesMonth,
      salesTrend,
      salesByChannel,
      unrecordedDays,
      posToday,
      declaredWalkIn,
      topProducts,
    ] = await this.client.$transaction([
      /*
       * Needs restocking, mirroring `deriveStockStatus` exactly: out of stock at or below
       * zero, low at or below a *real* threshold. A zero minimum means "not tracked", so
       * such an item is only ever counted when it hits zero.
       */
      this.client.$queryRaw<{ needs: bigint; out: bigint }[]>`
        SELECT
          count(*) FILTER (
            WHERE current_quantity <= 0
               OR (minimum_quantity > 0 AND current_quantity <= minimum_quantity)
          ) AS needs,
          count(*) FILTER (WHERE current_quantity <= 0) AS out
        FROM inventory_items
        WHERE deleted_at IS NULL AND status = 'ACTIVE'
      `,

      // The worst offenders first: out of stock, then furthest below the threshold.
      this.client.$queryRaw<
        { id: string; name: string; unit: string; current: string; minimum: string }[]
      >`
        SELECT id::text AS id, name, unit::text AS unit,
               current_quantity AS current, minimum_quantity AS minimum
        FROM inventory_items
        WHERE deleted_at IS NULL AND status = 'ACTIVE'
          AND (current_quantity <= 0
               OR (minimum_quantity > 0 AND current_quantity <= minimum_quantity))
        ORDER BY (current_quantity <= 0) DESC,
                 (minimum_quantity - current_quantity) DESC
        LIMIT 6
      `,

      this.client.$queryRaw<{ approval: bigint; receipt: bigint }[]>`
        SELECT
          count(*) FILTER (WHERE status = 'PENDING')  AS approval,
          count(*) FILTER (WHERE status = 'APPROVED') AS receipt
        FROM stock_transfers
      `,

      this.client.$queryRaw<{ count: bigint; value: string | null; tax: string | null }[]>`
        SELECT count(*) AS count,
               coalesce(sum(total_amount), 0) AS value,
               coalesce(sum(total_tax), 0)    AS tax
        FROM purchases
        WHERE invoice_date = ${day}::date
      `,

      /*
       * Stock at cost. Only priced items contribute, and the unpriced ones are counted so
       * the client can say how much of the shelf the figure covers — a valuation quoted
       * without that is the kind of number that ends up in a report unchallenged.
       */
      this.client.$queryRaw<{ total: string | null; priced: bigint; unpriced: bigint }[]>`
        SELECT
          coalesce(sum(current_quantity * purchase_price) FILTER (WHERE purchase_price IS NOT NULL), 0) AS total,
          count(*) FILTER (WHERE purchase_price IS NOT NULL) AS priced,
          count(*) FILTER (WHERE purchase_price IS NULL)     AS unpriced
        FROM inventory_items
        WHERE deleted_at IS NULL AND status = 'ACTIVE'
      `,

      this.client.$queryRaw<{ requested: bigint; completed: bigint; transit: bigint }[]>`
        SELECT
          count(*) FILTER (WHERE requested_at::date = ${day}::date)                            AS requested,
          count(*) FILTER (WHERE completed_at::date = ${day}::date AND status = 'COMPLETED')   AS completed,
          count(*) FILTER (WHERE status = 'APPROVED')                                          AS transit
        FROM stock_transfers
      `,

      this.client.$queryRaw<{ sheets: bigint; lines: bigint; items: bigint }[]>`
        SELECT
          count(DISTINCT e.id)      AS sheets,
          count(l.id)               AS lines,
          count(DISTINCT l.item_id) AS items
        FROM consumption_entries e
        LEFT JOIN consumption_lines l ON l.entry_id = e.id
        WHERE e.entry_date = ${day}::date AND e.deleted_at IS NULL
      `,

      /*
       * Ranked by how often an ingredient appears on a sheet, not by quantity.
       *
       * Quantities do not compare across units — 3 litres of cream against 1.2 kilograms
       * of chocolate is not a ranking — so the total is carried along for display in the
       * item's own unit while the order comes from a unit-free count.
       */
      this.client.$queryRaw<
        { item_id: string; item_name: string; unit: string; times: bigint; total: string }[]
      >`
        SELECT l.item_id::text AS item_id,
               l.item_name,
               l.unit::text AS unit,
               count(*)      AS times,
               sum(l.quantity) AS total
        FROM consumption_lines l
        JOIN consumption_entries e ON e.id = l.entry_id
        WHERE e.deleted_at IS NULL
          AND e.entry_date BETWEEN ${from}::date AND ${day}::date
        GROUP BY l.item_id, l.item_name, l.unit
        ORDER BY times DESC, total DESC
        LIMIT 6
      `,

      /*
       * Manual downward adjustments — where waste lands in a system with no write-off
       * record. Deliberately excludes consumption, transfers and purchases, which have
       * their own actions and are not losses.
       */
      this.client.$queryRaw<{ events: bigint; items: bigint }[]>`
        SELECT count(*) AS events, count(DISTINCT item_id) AS items
        FROM inventory_item_history
        WHERE action = 'QUANTITY_ADJUSTED'
          AND quantity_before IS NOT NULL
          AND quantity_after < quantity_before
          AND created_at >= ${from}::date
      `,

      this.client.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM purchases WHERE invoice_stored_name IS NULL
      `,

      /*
       * Movements per day by kind.
       *
       * A generated date series left-joined against the history, so a day with no activity
       * is a zero rather than a gap — a line chart that skips empty days compresses time
       * and makes a quiet week look busy.
       */
      this.client.$queryRaw<
        { day: Date; purchased: bigint; consumed: bigint; transferred: bigint; adjusted: bigint }[]
      >`
        SELECT d.day::date AS day,
          count(h.id) FILTER (WHERE h.action = 'PURCHASED')                            AS purchased,
          count(h.id) FILTER (WHERE h.action = 'CONSUMED')                             AS consumed,
          count(h.id) FILTER (WHERE h.action IN ('TRANSFER_IN', 'TRANSFER_OUT'))       AS transferred,
          count(h.id) FILTER (WHERE h.action = 'QUANTITY_ADJUSTED')                    AS adjusted
        FROM generate_series(${from}::date, ${day}::date, '1 day') AS d(day)
        LEFT JOIN inventory_item_history h ON h.created_at::date = d.day::date
        GROUP BY d.day
        ORDER BY d.day
      `,

      this.client.$queryRaw<{ day: Date; amount: string | null }[]>`
        SELECT d.day::date AS day, coalesce(sum(p.total_amount), 0) AS amount
        FROM generate_series(${from}::date, ${day}::date, '1 day') AS d(day)
        LEFT JOIN purchases p ON p.invoice_date = d.day::date
        GROUP BY d.day
        ORDER BY d.day
      `,

      this.client.$queryRaw<{ category: string; value: string }[]>`
        SELECT category::text AS category,
               sum(current_quantity * purchase_price) AS value
        FROM inventory_items
        WHERE deleted_at IS NULL AND status = 'ACTIVE' AND purchase_price IS NOT NULL
          AND current_quantity > 0
        GROUP BY category
        HAVING sum(current_quantity * purchase_price) > 0
        ORDER BY value DESC
      `,

      this.client.$queryRaw<{ category: string; value: bigint }[]>`
        SELECT category::text AS category, count(*) AS value
        FROM inventory_items
        WHERE deleted_at IS NULL AND status = 'ACTIVE'
          AND (current_quantity <= 0
               OR (minimum_quantity > 0 AND current_quantity <= minimum_quantity))
        GROUP BY category
        ORDER BY value DESC
      `,

      /*
       * Today's takings, split by tender and by channel in one pass.
       *
       * `count(e.id)` rather than a boolean: it distinguishes "no entry for today" from
       * "an entry saying zero", which the tile has to tell apart.
       */
      this.client.$queryRaw<
        {
          entries: bigint;
          total: string | null;
          cash: string | null;
          aggregator: string | null;
        }[]
      >`
        SELECT count(DISTINCT e.id)                                          AS entries,
               coalesce(sum(l.amount), 0)                                    AS total,
               coalesce(sum(l.amount) FILTER (WHERE l.payment_mode = 'CASH'), 0) AS cash,
               coalesce(sum(l.amount) FILTER (WHERE l.channel <> 'WALK_IN'), 0) AS aggregator
        FROM daily_sales_entries e
        LEFT JOIN daily_sales_lines l ON l.entry_id = e.id
        WHERE e.deleted_at IS NULL AND e.entry_date = ${day}::date
      `,

      // Calendar month to date. `daysElapsed` is what makes the total interpretable —
      // "₹40,000 over 3 of 14 days" is a different statement from "₹40,000 this month".
      this.client.$queryRaw<{ total: string | null; days: bigint; elapsed: number }[]>`
        SELECT coalesce(sum(total_amount), 0) AS total,
               count(*)                       AS days,
               date_part('day', ${day}::date) AS elapsed
        FROM daily_sales_entries
        WHERE deleted_at IS NULL
          AND entry_date >= date_trunc('month', ${day}::date)
          AND entry_date <= ${day}::date
      `,

      /*
       * Daily revenue across the window.
       *
       * No generated date series here, unlike the movement and spend charts. A day with
       * no *stock activity* genuinely had none, so plotting zero is true; a day with no
       * *sales entry* has an unknown figure, and plotting it as zero would draw a trough
       * that never happened. Missing days are simply absent, and the tile below the chart
       * says how many.
       */
      this.client.$queryRaw<{ day: Date; amount: string }[]>`
        SELECT entry_date AS day, total_amount AS amount
        FROM daily_sales_entries
        WHERE deleted_at IS NULL
          AND entry_date >= ${from}::date AND entry_date <= ${day}::date
        ORDER BY entry_date
      `,

      this.client.$queryRaw<{ channel: string; value: string }[]>`
        SELECT l.channel::text AS channel, sum(l.amount) AS value
        FROM daily_sales_lines l
        JOIN daily_sales_entries e ON e.id = l.entry_id
        WHERE e.deleted_at IS NULL
          AND e.entry_date >= ${from}::date AND e.entry_date <= ${day}::date
        GROUP BY l.channel
        HAVING sum(l.amount) > 0
        ORDER BY value DESC
      `,

      /*
       * Days in the window with nothing entered, today excluded.
       *
       * The one query here that generates a series, because the answer is about days that
       * are *missing* — an anti-join against a real calendar is the only way to name a row
       * that does not exist.
       */
      this.client.$queryRaw<{ day: Date }[]>`
        SELECT d.day::date AS day
        FROM generate_series(${from}::date, ${day}::date - 1, '1 day') AS d(day)
        LEFT JOIN daily_sales_entries e
          ON e.entry_date = d.day::date AND e.deleted_at IS NULL
        WHERE e.id IS NULL
        ORDER BY d.day DESC
      `,

      /*
       * Today at the counter.
       *
       * The payment split comes from `payments`, not from the order — a split order has two
       * rows and only the payment rows know which tender each part arrived as.
       */
      this.client.$queryRaw<Record<string, unknown>[]>`
        SELECT count(*)                                                        AS orders,
               count(*) FILTER (WHERE status = 'PAID')                         AS paid_orders,
               count(*) FILTER (WHERE status = 'PENDING_PAYMENT')              AS pending_orders,
               coalesce(sum(grand_total) FILTER (WHERE status = 'PAID'), 0)    AS revenue,
               coalesce(sum(grand_total) FILTER (WHERE status = 'PENDING_PAYMENT'), 0) AS pending_amount,
               coalesce((SELECT sum(li.quantity) FROM sales_order_items li
                         JOIN sales_orders o2 ON o2.id = li.order_id
                         WHERE o2.status = 'PAID' AND o2.created_at::date = ${day}::date), 0) AS items_sold,
               coalesce((SELECT sum(p.amount) FROM payments p
                         JOIN sales_orders o3 ON o3.id = p.order_id
                         WHERE o3.status = 'PAID' AND o3.created_at::date = ${day}::date
                           AND p.method = 'CASH'), 0) AS cash,
               coalesce((SELECT sum(p.amount) FROM payments p
                         JOIN sales_orders o4 ON o4.id = p.order_id
                         WHERE o4.status = 'PAID' AND o4.created_at::date = ${day}::date
                           AND p.method <> 'CASH'), 0) AS online
        FROM sales_orders
        WHERE created_at::date = ${day}::date
      `,

      /*
       * The declared walk-in figure for today, if one has been entered.
       *
       * Returns no rows when the day has not been written up — which is the normal state
       * until close of business, and is why the reconciliation reports `declared: null`
       * rather than zero.
       */
      this.client.$queryRaw<Record<string, unknown>[]>`
        SELECT coalesce(sum(l.amount), 0) AS declared
        FROM daily_sales_entries e
        JOIN daily_sales_lines l ON l.entry_id = e.id AND l.channel = 'WALK_IN'
        WHERE e.deleted_at IS NULL AND e.entry_date = ${day}::date
        GROUP BY e.id
      `,

      this.client.$queryRaw<Record<string, unknown>[]>`
        SELECT li.product_name, sum(li.quantity) AS quantity, sum(li.line_total) AS revenue
        FROM sales_order_items li
        JOIN sales_orders o ON o.id = li.order_id
        WHERE o.status = 'PAID' AND o.created_at::date = ${day}::date
        GROUP BY li.product_name
        ORDER BY sum(li.quantity) DESC
        LIMIT 5
      `,
    ]);

    return {
      lowStock: {
        needsRestocking: toNumber(lowStockCounts[0]?.needs ?? 0),
        outOfStock: toNumber(lowStockCounts[0]?.out ?? 0),
        items: lowStockItems.map(
          (row): LowStockRow => ({
            id: row.id,
            name: row.name,
            unit: row.unit,
            currentQuantity: toNumber(row.current),
            minimumQuantity: toNumber(row.minimum),
          }),
        ),
      },
      pendingRequests: {
        awaitingApproval: toNumber(pending[0]?.approval ?? 0),
        awaitingReceipt: toNumber(pending[0]?.receipt ?? 0),
      },
      todaysPurchases: {
        count: toNumber(purchasesToday[0]?.count ?? 0),
        totalValue: toNumber(purchasesToday[0]?.value ?? 0),
        totalTax: toNumber(purchasesToday[0]?.tax ?? 0),
      },
      inventoryValue: {
        total: toNumber(inventoryValue[0]?.total ?? 0),
        pricedItems: toNumber(inventoryValue[0]?.priced ?? 0),
        unpricedItems: toNumber(inventoryValue[0]?.unpriced ?? 0),
      },
      transfersToday: {
        requested: toNumber(transfersToday[0]?.requested ?? 0),
        completed: toNumber(transfersToday[0]?.completed ?? 0),
        inTransit: toNumber(transfersToday[0]?.transit ?? 0),
      },
      todaysConsumption: {
        sheets: toNumber(consumptionToday[0]?.sheets ?? 0),
        lines: toNumber(consumptionToday[0]?.lines ?? 0),
        items: toNumber(consumptionToday[0]?.items ?? 0),
      },
      topIngredients: topIngredients.map(
        (row): TopIngredientRow => ({
          itemId: row.item_id,
          itemName: row.item_name,
          unit: row.unit,
          timesUsed: toNumber(row.times),
          totalQuantity: toNumber(row.total),
        }),
      ),
      writeDowns: {
        events: toNumber(writeDowns[0]?.events ?? 0),
        itemsAffected: toNumber(writeDowns[0]?.items ?? 0),
      },
      purchasesMissingInvoice: toNumber(missingInvoices[0]?.count ?? 0),
      stockMovement: movement.map(
        (row): DailyMovementRow => ({
          date: toDateOnly(row.day),
          purchased: toNumber(row.purchased),
          consumed: toNumber(row.consumed),
          transferred: toNumber(row.transferred),
          adjusted: toNumber(row.adjusted),
        }),
      ),
      purchaseSpend: spend.map((row) => ({
        date: toDateOnly(row.day),
        amount: toNumber(row.amount ?? 0),
      })),
      valueByCategory: valueByCategory.map(
        (row): CategoryValueRow => ({ category: row.category, value: toNumber(row.value) }),
      ),
      lowStockByCategory: lowStockByCategory.map(
        (row): CategoryValueRow => ({ category: row.category, value: toNumber(row.value) }),
      ),

      todaysSales: {
        recorded: toNumber(salesToday[0]?.entries ?? 0) > 0,
        total: toNumber(salesToday[0]?.total ?? 0),
        cash: toNumber(salesToday[0]?.cash ?? 0),
        // Derived rather than summed separately, so the two halves always add to the
        // total instead of disagreeing by a rounding step.
        online: round(toNumber(salesToday[0]?.total ?? 0) - toNumber(salesToday[0]?.cash ?? 0)),
        walkIn: round(
          toNumber(salesToday[0]?.total ?? 0) - toNumber(salesToday[0]?.aggregator ?? 0),
        ),
        aggregator: toNumber(salesToday[0]?.aggregator ?? 0),
      },
      salesMonthToDate: {
        total: toNumber(salesMonth[0]?.total ?? 0),
        daysRecorded: toNumber(salesMonth[0]?.days ?? 0),
        daysElapsed: toNumber(salesMonth[0]?.elapsed ?? 0),
      },
      salesTrend: salesTrend.map((row) => ({
        date: toDateOnly(row.day),
        amount: toNumber(row.amount),
      })),
      salesByChannel: salesByChannel.map((row) => ({
        channel: row.channel,
        value: toNumber(row.value),
      })),
      unrecordedSalesDays: unrecordedDays.map((row) => toDateOnly(row.day)),

      posToday: {
        orders: toNumber(posToday[0]?.['orders'] ?? 0),
        paidOrders: toNumber(posToday[0]?.['paid_orders'] ?? 0),
        pendingOrders: toNumber(posToday[0]?.['pending_orders'] ?? 0),
        revenue: round(toNumber(posToday[0]?.['revenue'] ?? 0)),
        pendingAmount: round(toNumber(posToday[0]?.['pending_amount'] ?? 0)),
        itemsSold: toNumber(posToday[0]?.['items_sold'] ?? 0),
        cash: round(toNumber(posToday[0]?.['cash'] ?? 0)),
        online: round(toNumber(posToday[0]?.['online'] ?? 0)),
      },

      walkInReconciliation: (() => {
        const counter = round(toNumber(posToday[0]?.['revenue'] ?? 0));
        // No row means no entry for today — null, not zero. See the contract.
        const declared =
          declaredWalkIn.length === 0 ? null : round(toNumber(declaredWalkIn[0]?.['declared'] ?? 0));

        return {
          declared,
          counter,
          variance: declared === null ? null : round(declared - counter),
        };
      })(),

      topProductsToday: topProducts.map((row) => ({
        productName: String(row['product_name']),
        quantity: toNumber(row['quantity']),
        revenue: round(toNumber(row['revenue'])),
      })),
    };
  }
}
