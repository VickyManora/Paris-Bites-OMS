import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import { isSalesChannel, type SalesChannel } from '../../../core/domain/enums/sales.enum.js';
import {
  AnalyticsGranularity,
  type AnalyticsQuery,
  type AnalyticsSnapshot,
  type AnalyticsTrendPoint,
  type IAnalyticsRepository,
  type IngredientUsageRow,
} from '../../../core/domain/repositories/analytics.repository.js';

/** Most ingredients ranked. Beyond this the bar chart is unreadable anyway. */
const TOP_INGREDIENT_LIMIT = 10;

/**
 * `date_trunc` units, behind a closed lookup.
 *
 * The granularity reaches SQL as an identifier, so it goes through this map rather than
 * being interpolated — the same rule the report repository follows for `ORDER BY`.
 */
const TRUNC_UNIT: Readonly<Record<AnalyticsGranularity, string>> = {
  [AnalyticsGranularity.DAY]: 'day',
  [AnalyticsGranularity.WEEK]: 'week',
  [AnalyticsGranularity.MONTH]: 'month',
};

function num(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }

  const coerced = Number(value);
  return Number.isFinite(coerced) ? coerced : 0;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Analytics aggregates.
 *
 * Raw SQL throughout, and the trend is deliberately **one statement**. Bucketing four
 * measures separately and stitching them in JavaScript would work right up until an empty
 * bucket appeared in one series and not another, at which point two charts on the same
 * screen would have different x-axes and nobody would notice until a conclusion was drawn
 * from the misalignment.
 */
export class AnalyticsPrismaRepository implements IAnalyticsRepository {
  constructor(private readonly client: PrismaClient) {}

  async snapshot(query: AnalyticsQuery): Promise<AnalyticsSnapshot> {
    const from = toDateOnly(query.from);
    const to = toDateOnly(query.to);
    const unit = Prisma.raw(`'${TRUNC_UNIT[query.granularity]}'`);
    const step = Prisma.raw(`'1 ${TRUNC_UNIT[query.granularity]}'::interval`);

    const [
      revenue,
      channels,
      inventory,
      cost,
      ingredients,
      purchases,
      transfers,
      trend,
      products,
      posRevenue,
    ] = await this.client.$transaction([
        this.client.$queryRaw<Record<string, unknown>[]>`
          SELECT coalesce(sum(total_amount), 0) AS total,
                 count(*)                       AS days
          FROM daily_sales_entries
          WHERE deleted_at IS NULL AND entry_date BETWEEN ${from}::date AND ${to}::date
        `,

        this.client.$queryRaw<Record<string, unknown>[]>`
          SELECT l.channel::text AS channel,
                 l.payment_mode::text AS payment_mode,
                 sum(l.amount) AS value
          FROM daily_sales_lines l
          JOIN daily_sales_entries e ON e.id = l.entry_id
          WHERE e.deleted_at IS NULL AND e.entry_date BETWEEN ${from}::date AND ${to}::date
          GROUP BY l.channel, l.payment_mode
        `,

        // Stock on hand *now*. The one figure here that ignores the range — there is no
        // stock ledger to reconstruct a historical valuation from.
        this.client.$queryRaw<Record<string, unknown>[]>`
          SELECT coalesce(sum(current_quantity * purchase_price) FILTER (WHERE purchase_price IS NOT NULL), 0) AS total,
                 count(*) FILTER (WHERE purchase_price IS NOT NULL) AS priced,
                 count(*) FILTER (WHERE purchase_price IS NULL)     AS unpriced
          FROM inventory_items
          WHERE deleted_at IS NULL AND status = 'ACTIVE'
        `,

        /*
         * Cost of what was consumed, and how much of it could be priced.
         *
         * The unpriced lines are counted rather than silently treated as free. Without
         * that count a food-cost percentage computed over half-priced data looks like a
         * healthy margin instead of a missing one.
         */
        this.client.$queryRaw<Record<string, unknown>[]>`
          SELECT coalesce(sum(l.quantity * i.purchase_price) FILTER (WHERE i.purchase_price IS NOT NULL), 0) AS cost,
                 count(*) FILTER (WHERE i.purchase_price IS NOT NULL) AS priced_lines,
                 count(*) FILTER (WHERE i.purchase_price IS NULL)     AS unpriced_lines
          FROM consumption_entries e
          JOIN consumption_lines l ON l.entry_id = e.id
          JOIN inventory_items i   ON i.id = l.item_id
          WHERE e.deleted_at IS NULL AND e.entry_date BETWEEN ${from}::date AND ${to}::date
        `,

        this.client.$queryRaw<Record<string, unknown>[]>`
          SELECT i.id, i.name, i.unit::text AS unit,
                 sum(l.quantity) AS quantity,
                 count(*)        AS times_used,
                 CASE WHEN i.purchase_price IS NULL THEN NULL
                      ELSE sum(l.quantity * i.purchase_price) END AS cost
          FROM consumption_entries e
          JOIN consumption_lines l ON l.entry_id = e.id
          JOIN inventory_items i   ON i.id = l.item_id
          WHERE e.deleted_at IS NULL AND e.entry_date BETWEEN ${from}::date AND ${to}::date
          GROUP BY i.id, i.name, i.unit, i.purchase_price
          ORDER BY sum(l.quantity) DESC
          LIMIT ${TOP_INGREDIENT_LIMIT}
        `,

        this.client.$queryRaw<Record<string, unknown>[]>`
          SELECT coalesce(sum(total_amount), 0) AS total, count(*) AS invoices
          FROM purchases
          WHERE invoice_date BETWEEN ${from}::date AND ${to}::date
        `,

        this.client.$queryRaw<Record<string, unknown>[]>`
          SELECT count(*) AS total,
                 count(*) FILTER (WHERE status = 'COMPLETED') AS completed
          FROM stock_transfers
          WHERE requested_at::date BETWEEN ${from}::date AND ${to}::date
        `,

        /*
         * The shared axis.
         *
         * A generated bucket series left-joined against each measure, so every chart on
         * the page has identical categories including the empty ones. `sales_days` rides
         * along so a partially-entered month can be marked as such rather than drawn as a
         * complete one.
         */
        this.client.$queryRaw<Record<string, unknown>[]>`
          WITH buckets AS (
            SELECT generate_series(
              date_trunc(${unit}, ${from}::date),
              date_trunc(${unit}, ${to}::date),
              ${step}
            )::date AS period
          ),
          sales AS (
            SELECT date_trunc(${unit}, entry_date)::date AS period,
                   sum(total_amount) AS revenue,
                   count(*)          AS days
            FROM daily_sales_entries
            WHERE deleted_at IS NULL AND entry_date BETWEEN ${from}::date AND ${to}::date
            GROUP BY 1
          ),
          cost AS (
            SELECT date_trunc(${unit}, e.entry_date)::date AS period,
                   sum(l.quantity * coalesce(i.purchase_price, 0)) AS cost
            FROM consumption_entries e
            JOIN consumption_lines l ON l.entry_id = e.id
            JOIN inventory_items i   ON i.id = l.item_id
            WHERE e.deleted_at IS NULL AND e.entry_date BETWEEN ${from}::date AND ${to}::date
            GROUP BY 1
          ),
          purch AS (
            SELECT date_trunc(${unit}, invoice_date)::date AS period,
                   sum(total_amount) AS amount
            FROM purchases
            WHERE invoice_date BETWEEN ${from}::date AND ${to}::date
            GROUP BY 1
          ),
          xfer AS (
            SELECT date_trunc(${unit}, requested_at::date)::date AS period,
                   count(*) AS moves
            FROM stock_transfers
            WHERE requested_at::date BETWEEN ${from}::date AND ${to}::date
            GROUP BY 1
          )
          SELECT b.period,
                 coalesce(s.revenue, 0) AS revenue,
                 coalesce(s.days, 0)    AS sales_days,
                 coalesce(c.cost, 0)    AS cost,
                 coalesce(p.amount, 0)  AS purchases,
                 coalesce(x.moves, 0)   AS transfers,
                 -- Days of this bucket that fall inside the requested range, so a part
                 -- month at either end is not judged against a full one.
                 (least(
                    (b.period + ${step} - interval '1 day')::date,
                    ${to}::date
                  ) - greatest(b.period, ${from}::date) + 1) AS days_in_period
          FROM buckets b
          LEFT JOIN sales s ON s.period = b.period
          LEFT JOIN cost  c ON c.period = b.period
          LEFT JOIN purch p ON p.period = b.period
          LEFT JOIN xfer  x ON x.period = b.period
          ORDER BY b.period
        `,

      /*
       * Best sellers over the range, from POS lines.
       *
       * Paid orders only — a cancelled order's items were not sold. This is counter trade
       * only, because aggregator orders are not itemised anywhere in the system.
       */
      this.client.$queryRaw<Record<string, unknown>[]>`
        SELECT li.product_name,
               sum(li.quantity)     AS quantity,
               count(DISTINCT o.id) AS orders,
               sum(li.line_total)   AS revenue
        FROM sales_order_items li
        JOIN sales_orders o ON o.id = li.order_id
        WHERE o.status = 'PAID'
          AND o.created_at::date BETWEEN ${from}::date AND ${to}::date
        GROUP BY li.product_name
        ORDER BY sum(li.quantity) DESC
        LIMIT 10
      `,

      /*
       * Counter takings over the range.
       *
       * Reported *beside* declared revenue, never added to it: both describe the same walk-in
       * trade, one from the till and one typed in at close.
       */
      this.client.$queryRaw<Record<string, unknown>[]>`
        SELECT coalesce(sum(o.grand_total), 0) AS total,
               count(*)                        AS orders,
               coalesce((SELECT sum(li.quantity) FROM sales_order_items li
                         JOIN sales_orders o2 ON o2.id = li.order_id
                         WHERE o2.status = 'PAID'
                           AND o2.created_at::date BETWEEN ${from}::date AND ${to}::date), 0) AS items_sold
        FROM sales_orders o
        WHERE o.status = 'PAID'
          AND o.created_at::date BETWEEN ${from}::date AND ${to}::date
      `,
      ]);

    const revenueTotal = num(revenue[0]?.['total']);
    const daysRecorded = num(revenue[0]?.['days']);
    const consumptionCost = num(cost[0]?.['cost']);

    const cash = round(
      channels
        .filter((row) => row['payment_mode'] === 'CASH')
        .reduce((sum, row) => sum + num(row['value']), 0),
    );

    const byChannelTotals = new Map<SalesChannel, number>();

    for (const row of channels) {
      const channel = String(row['channel']);

      if (isSalesChannel(channel)) {
        byChannelTotals.set(channel, round((byChannelTotals.get(channel) ?? 0) + num(row['value'])));
      }
    }

    const linesPriced = num(cost[0]?.['priced_lines']);
    const linesUnpriced = num(cost[0]?.['unpriced_lines']);

    return {
      revenue: {
        total: round(revenueTotal),
        cash,
        online: round(revenueTotal - cash),
        daysRecorded,
        daysInRange: this.daysBetween(query.from, query.to),
        // Per recorded day, not per calendar day: dividing by the range would report a
        // lower average for anyone who does not trade daily.
        averagePerRecordedDay: daysRecorded === 0 ? null : round(revenueTotal / daysRecorded),
        byChannel: [...byChannelTotals.entries()].map(([channel, value]) => ({ channel, value })),
      },

      inventoryValue: {
        total: round(num(inventory[0]?.['total'])),
        pricedItems: num(inventory[0]?.['priced']),
        unpricedItems: num(inventory[0]?.['unpriced']),
      },

      foodCost: {
        consumptionCost: round(consumptionCost),
        revenue: round(revenueTotal),
        // Null, not Infinity or 0: a ratio against no revenue is not a number, and either
        // stand-in would be charted as though it meant something.
        percent: revenueTotal <= 0 ? null : round((consumptionCost / revenueTotal) * 100),
        linesPriced,
        linesUnpriced,
      },

      topIngredients: ingredients.map(
        (row): IngredientUsageRow => ({
          itemId: String(row['id']),
          itemName: String(row['name']),
          unit: String(row['unit']),
          quantity: round(num(row['quantity'])),
          timesUsed: num(row['times_used']),
          cost: row['cost'] === null ? null : round(num(row['cost'])),
        }),
      ),

      purchases: {
        total: round(num(purchases[0]?.['total'])),
        invoices: num(purchases[0]?.['invoices']),
      },

      transfers: {
        total: num(transfers[0]?.['total']),
        completed: num(transfers[0]?.['completed']),
      },

      topProducts: products.map((row) => ({
        productName: String(row['product_name']),
        quantity: round(num(row['quantity'])),
        orders: num(row['orders']),
        revenue: round(num(row['revenue'])),
      })),

      posRevenue: (() => {
        const total = round(num(posRevenue[0]?.['total']));
        const orders = num(posRevenue[0]?.['orders']);

        return {
          total,
          orders,
          itemsSold: num(posRevenue[0]?.['items_sold']),
          // Null rather than zero on a range with no counter orders — a zero average order
          // value reads as a broken figure rather than an absent one.
          averageOrderValue: orders === 0 ? null : round(total / orders),
        };
      })(),

      trend: trend.map(
        (row): AnalyticsTrendPoint => ({
          period: toDateOnly(row['period'] as Date),
          revenue: round(num(row['revenue'])),
          salesDaysRecorded: num(row['sales_days']),
          salesDaysInPeriod: num(row['days_in_period']),
          consumptionCost: round(num(row['cost'])),
          purchases: round(num(row['purchases'])),
          transfers: num(row['transfers']),
        }),
      ),
    };
  }

  /** Inclusive of both ends — a single-day range is one day, not zero. */
  private daysBetween(from: Date, to: Date): number {
    const ms = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
      - Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());

    return Math.floor(ms / 86_400_000) + 1;
  }
}
