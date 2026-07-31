import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import {
  INVENTORY_CATEGORY_LABELS,
  INVENTORY_LOCATION_LABELS,
  INVENTORY_UNIT_ABBREVIATIONS,
  isInventoryCategory,
  isInventoryLocation,
  isInventoryUnit,
  STOCK_STATUS_LABELS,
  deriveStockStatus,
} from '../../../core/domain/enums/inventory.enum.js';
import { GST_TREATMENT_LABELS, stateNameFor } from '../../../core/domain/enums/purchase.enum.js';
import { TRANSFER_STATUS_LABELS } from '../../../core/domain/enums/stock-transfer.enum.js';
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '../../../core/domain/enums/pos.enum.js';
import { MONEY_DECIMAL_PLACES } from '../../../core/domain/value-objects/money.js';
import { MAX_EXPORT_ROWS, ReportId } from '../../../core/domain/enums/report.enum.js';
import type {
  IReportRepository,
  ReportChart,
  ReportFilters,
  ReportResult,
  ReportRow,
} from '../../../core/domain/repositories/report.repository.js';

/** Every raw shape narrowed to a plain number: bigint counts, Decimal sums, driver strings. */
function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const candidate = value as { toNumber?: () => number };
  return typeof candidate.toNumber === 'function' ? candidate.toNumber() : 0;
}

function dateOnly(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

/**
 * A raw column as display text, or a fallback when it is null.
 *
 * Raw query results are typed `unknown`, and `String(x)` on an unexpected object yields
 * "[object Object]" in the middle of a report — narrowed here so that cannot happen.
 */
function text(value: unknown, fallback = '—'): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

function categoryLabel(value: string): string {
  return isInventoryCategory(value) ? INVENTORY_CATEGORY_LABELS[value] : value;
}

function locationLabel(value: string): string {
  return isInventoryLocation(value) ? INVENTORY_LOCATION_LABELS[value] : value;
}

function unitLabel(value: string): string {
  return isInventoryUnit(value) ? INVENTORY_UNIT_ABBREVIATIONS[value] : value.toLowerCase();
}

/**
 * Report queries.
 *
 * Raw SQL, and each report owns one. The alternative — composing these from the feature
 * repositories — would mean fetching whole entities across four tables so that JavaScript
 * could join and total them, which is the work a database exists to do.
 *
 * **Sort fields are mapped, never interpolated.** Every report declares a closed set, and
 * an unknown field falls back to its default rather than reaching the query, so no caller
 * can put a fragment of SQL into an `ORDER BY`.
 */
export class ReportPrismaRepository implements IReportRepository {
  constructor(private readonly client: PrismaClient) {}

  async run(id: ReportId, filters: ReportFilters): Promise<ReportResult> {
    switch (id) {
      case ReportId.INVENTORY:
        return this.inventory(filters);
      case ReportId.PURCHASE:
        return this.purchases(filters);
      case ReportId.TRANSFER:
        return this.transfers(filters);
      case ReportId.CONSUMPTION:
        return this.consumption(filters);
      case ReportId.SUPPLIER:
        return this.suppliers(filters);
      case ReportId.LOW_STOCK:
        return this.lowStock(filters);
      case ReportId.SALES:
        return this.sales(filters);
      case ReportId.POS_ORDERS:
        return this.posOrders(filters);
      case ReportId.PRODUCT_SALES:
        return this.productSales(filters);
    }
  }

  /**
   * `LIMIT`/`OFFSET` for a page, or a hard cap for an export.
   *
   * An export asks for every matching row, but "every" has to end somewhere because both
   * writers build the file in memory. The cap is far past a real month; the use case
   * reports when it bites rather than handing over a silently truncated file.
   */
  private paging(filters: ReportFilters): Prisma.Sql {
    if (filters.page === undefined || filters.pageSize === undefined) {
      return Prisma.sql`LIMIT ${MAX_EXPORT_ROWS}`;
    }

    const take = filters.pageSize;
    const skip = (filters.page - 1) * filters.pageSize;

    return Prisma.sql`LIMIT ${take} OFFSET ${skip}`;
  }

  /** Resolves a requested sort to a safe SQL fragment from a fixed map. */
  private order(
    filters: ReportFilters,
    map: Readonly<Record<string, string>>,
    fallback: string,
  ): Prisma.Sql {
    const column = map[filters.sortField ?? ''] ?? map[fallback] ?? fallback;
    const direction = filters.sortDirection === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;

    return Prisma.sql`ORDER BY ${Prisma.raw(column)} ${direction}`;
  }

  private search(filters: ReportFilters): string | null {
    const term = filters.search?.trim();
    return term !== undefined && term.length > 0 ? `%${term}%` : null;
  }

  // -------------------------------------------------------------------------
  // Inventory
  // -------------------------------------------------------------------------

  private async inventory(filters: ReportFilters): Promise<ReportResult> {
    const term = this.search(filters);
    const location = filters.location ?? null;

    const where = Prisma.sql`
      WHERE i.deleted_at IS NULL
        AND (${location}::text IS NULL OR i.location::text = ${location}::text)
        AND (${term}::text IS NULL OR i.name ILIKE ${term}::text OR i.notes ILIKE ${term}::text)
    `;

    const [rows, counted, byCategory] = await this.client.$transaction([
      this.client.$queryRaw<Record<string, unknown>[]>`
        SELECT i.name, i.category::text AS category, i.location::text AS location,
               i.unit::text AS unit, i.current_quantity, i.minimum_quantity, i.purchase_price,
               (i.current_quantity * i.purchase_price) AS stock_value
        FROM inventory_items i
        ${where}
        ${this.order(filters, {
          name: 'i.name',
          category: 'i.category',
          currentQuantity: 'i.current_quantity',
          stockValue: '(i.current_quantity * i.purchase_price)',
        }, 'name')}
        ${this.paging(filters)}
      `,
      this.client.$queryRaw<{ count: bigint; stock_value: unknown }[]>`
        SELECT count(*) AS count,
               coalesce(sum(i.current_quantity * i.purchase_price), 0) AS stock_value
        FROM inventory_items i ${where}
      `,
      this.client.$queryRaw<{ category: string; value: unknown }[]>`
        SELECT i.category::text AS category,
               coalesce(sum(i.current_quantity * i.purchase_price), 0) AS value
        FROM inventory_items i ${where}
        GROUP BY i.category
        HAVING coalesce(sum(i.current_quantity * i.purchase_price), 0) > 0
        ORDER BY value DESC
      `,
    ]);

    const mapped: ReportRow[] = rows.map((row) => {
      const current = num(row['current_quantity']);
      const minimum = num(row['minimum_quantity']);
      const price = row['purchase_price'] === null ? null : num(row['purchase_price']);

      return {
        name: String(row['name']),
        category: categoryLabel(String(row['category'])),
        location: locationLabel(String(row['location'])),
        unit: unitLabel(String(row['unit'])),
        currentQuantity: current,
        minimumQuantity: minimum,
        stockStatus: STOCK_STATUS_LABELS[deriveStockStatus(current, minimum)],
        purchasePrice: price,
        stockValue: price === null ? null : Math.round(price * current * 100) / 100,
      };
    });

    return {
      rows: mapped,
      total: num(counted[0]?.count),
      // Over the whole filtered set, not the page. A totals row beneath "1–25 of 214"
      // that sums only what is visible is read as the total and is wrong by definition.
      totals: { stockValue: num(counted[0]?.stock_value) },
      chart: this.donut('Stock value by category', byCategory, categoryLabel, '₹'),
    };
  }

  // -------------------------------------------------------------------------
  // Purchases
  // -------------------------------------------------------------------------

  private async purchases(filters: ReportFilters): Promise<ReportResult> {
    const term = this.search(filters);
    const from = filters.fromDate ?? null;
    const to = filters.toDate ?? null;
    const supplier = filters.supplierId ?? null;

    const where = Prisma.sql`
      WHERE (${from}::date IS NULL OR p.invoice_date >= ${from}::date)
        AND (${to}::date   IS NULL OR p.invoice_date <= ${to}::date)
        AND (${supplier}::uuid IS NULL OR p.supplier_id = ${supplier}::uuid)
        AND (${term}::text IS NULL OR p.invoice_number ILIKE ${term}::text OR s.name ILIKE ${term}::text)
    `;

    const [rows, counted, spend] = await this.client.$transaction([
      this.client.$queryRaw<Record<string, unknown>[]>`
        SELECT p.invoice_date, p.invoice_number, s.name AS supplier,
               p.gst_treatment::text AS gst_treatment, p.subtotal, p.total_tax, p.total_amount,
               p.invoice_stored_name,
               (SELECT count(*) FROM purchase_lines l WHERE l.purchase_id = p.id) AS line_count
        FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
        ${where}
        ${this.order(filters, {
          invoiceDate: 'p.invoice_date',
          invoiceNumber: 'p.invoice_number',
          supplier: 's.name',
          totalAmount: 'p.total_amount',
        }, 'invoiceDate')}
        ${this.paging(filters)}
      `,
      this.client.$queryRaw<{ count: bigint; subtotal: unknown; tax: unknown; amount: unknown }[]>`
        SELECT count(*) AS count,
               coalesce(sum(p.subtotal), 0)     AS subtotal,
               coalesce(sum(p.total_tax), 0)    AS tax,
               coalesce(sum(p.total_amount), 0) AS amount
        FROM purchases p JOIN suppliers s ON s.id = p.supplier_id ${where}
      `,
      this.client.$queryRaw<{ day: Date; amount: unknown }[]>`
        SELECT p.invoice_date AS day, sum(p.total_amount) AS amount
        FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
        ${where}
        GROUP BY p.invoice_date ORDER BY p.invoice_date
      `,
    ]);

    const mapped: ReportRow[] = rows.map((row) => ({
      invoiceDate: dateOnly(row['invoice_date'] as Date),
      invoiceNumber: String(row['invoice_number']),
      supplier: String(row['supplier']),
      gstTreatment:
        GST_TREATMENT_LABELS[
          String(row['gst_treatment']) as keyof typeof GST_TREATMENT_LABELS
        ] ?? String(row['gst_treatment']),
      lineCount: num(row['line_count']),
      subtotal: num(row['subtotal']),
      totalTax: num(row['total_tax']),
      totalAmount: num(row['total_amount']),
      billAttached: row['invoice_stored_name'] === null ? 'Missing' : 'Attached',
    }));

    return {
      rows: mapped,
      total: num(counted[0]?.count),
      totals: {
        subtotal: num(counted[0]?.subtotal),
        totalTax: num(counted[0]?.tax),
        totalAmount: num(counted[0]?.amount),
      },
      chart: {
        type: 'area',
        title: 'Spend over time',
        valuePrefix: '₹',
        labels: spend.map((row) => dateOnly(row.day) ?? ''),
        series: [{ name: 'Spend', data: spend.map((row) => num(row.amount)) }],
      },
    };
  }

  // -------------------------------------------------------------------------
  // Transfers
  // -------------------------------------------------------------------------

  private async transfers(filters: ReportFilters): Promise<ReportResult> {
    const term = this.search(filters);
    const from = filters.fromDate ?? null;
    const to = filters.toDate ?? null;

    const where = Prisma.sql`
      WHERE (${from}::date IS NULL OR t.requested_at::date >= ${from}::date)
        AND (${to}::date   IS NULL OR t.requested_at::date <= ${to}::date)
        AND (${term}::text IS NULL OR t.reference ILIKE ${term}::text OR t.notes ILIKE ${term}::text)
    `;

    const [rows, counted, byStatus] = await this.client.$transaction([
      this.client.$queryRaw<Record<string, unknown>[]>`
        SELECT t.requested_at, t.reference, t.from_location::text AS from_location,
               t.to_location::text AS to_location, t.status::text AS status, t.completed_at,
               (u.first_name || ' ' || u.last_name) AS requested_by,
               (SELECT count(*) FROM stock_transfer_lines l WHERE l.transfer_id = t.id) AS line_count
        FROM stock_transfers t JOIN users u ON u.id = t.requested_by_id
        ${where}
        ${this.order(filters, {
          requestedAt: 't.requested_at',
          reference: 't.reference',
          status: 't.status',
        }, 'requestedAt')}
        ${this.paging(filters)}
      `,
      // One pass for both figures: `count(DISTINCT t.id)` survives the line join, and
      // `count(l.id)` totals the lines across every matching transfer rather than the page.
      this.client.$queryRaw<{ count: bigint; lines: bigint }[]>`
        SELECT count(DISTINCT t.id) AS count, count(l.id) AS lines
        FROM stock_transfers t
        LEFT JOIN stock_transfer_lines l ON l.transfer_id = t.id
        ${where}
      `,
      this.client.$queryRaw<{ status: string; count: bigint }[]>`
        SELECT t.status::text AS status, count(*) AS count
        FROM stock_transfers t ${where}
        GROUP BY t.status ORDER BY count DESC
      `,
    ]);

    const mapped: ReportRow[] = rows.map((row) => ({
      requestedAt: dateOnly(row['requested_at'] as Date),
      reference: String(row['reference']),
      route: `${locationLabel(String(row['from_location']))} → ${locationLabel(String(row['to_location']))}`,
      status:
        TRANSFER_STATUS_LABELS[String(row['status']) as keyof typeof TRANSFER_STATUS_LABELS] ??
        String(row['status']),
      lineCount: num(row['line_count']),
      requestedBy: String(row['requested_by']),
      completedAt: dateOnly(row['completed_at'] as Date | null),
    }));

    return {
      rows: mapped,
      total: num(counted[0]?.count),
      totals: { lineCount: num(counted[0]?.lines) },
      chart: {
        type: 'donut',
        title: 'Transfers by status',
        labels: byStatus.map(
          (row) =>
            TRANSFER_STATUS_LABELS[row.status as keyof typeof TRANSFER_STATUS_LABELS] ?? row.status,
        ),
        series: [{ name: 'Transfers', data: byStatus.map((row) => num(row.count)) }],
      },
    };
  }

  // -------------------------------------------------------------------------
  // Consumption
  // -------------------------------------------------------------------------

  private async consumption(filters: ReportFilters): Promise<ReportResult> {
    const term = this.search(filters);
    const from = filters.fromDate ?? null;
    const to = filters.toDate ?? null;
    const location = filters.location ?? null;

    const where = Prisma.sql`
      WHERE e.deleted_at IS NULL
        AND (${from}::date IS NULL OR e.entry_date >= ${from}::date)
        AND (${to}::date   IS NULL OR e.entry_date <= ${to}::date)
        AND (${location}::text IS NULL OR e.location::text = ${location}::text)
        AND (${term}::text IS NULL OR l.item_name ILIKE ${term}::text OR e.notes ILIKE ${term}::text)
    `;

    const [rows, counted, topItems] = await this.client.$transaction([
      this.client.$queryRaw<Record<string, unknown>[]>`
        SELECT e.entry_date, l.item_name, i.category::text AS category, l.quantity,
               l.unit::text AS unit, e.location::text AS location,
               coalesce(u.first_name || ' ' || u.last_name, 'System') AS recorded_by
        FROM consumption_lines l
        JOIN consumption_entries e ON e.id = l.entry_id
        JOIN inventory_items i ON i.id = l.item_id
        LEFT JOIN users u ON u.id = e.recorded_by_id
        ${where}
        ${this.order(filters, {
          entryDate: 'e.entry_date',
          itemName: 'l.item_name',
          quantity: 'l.quantity',
        }, 'entryDate')}
        ${this.paging(filters)}
      `,
      this.client.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count
        FROM consumption_lines l
        JOIN consumption_entries e ON e.id = l.entry_id
        JOIN inventory_items i ON i.id = l.item_id
        ${where}
      `,
      /*
       * Counted, not summed. Quantities do not compare across units, so a bar chart
       * summing kilograms with packets would invent a relationship; how often an
       * ingredient appears is unit-free and ranks honestly.
       */
      this.client.$queryRaw<{ item_name: string; times: bigint }[]>`
        SELECT l.item_name, count(*) AS times
        FROM consumption_lines l
        JOIN consumption_entries e ON e.id = l.entry_id
        JOIN inventory_items i ON i.id = l.item_id
        ${where}
        GROUP BY l.item_name ORDER BY times DESC LIMIT 8
      `,
    ]);

    const mapped: ReportRow[] = rows.map((row) => ({
      entryDate: dateOnly(row['entry_date'] as Date),
      itemName: String(row['item_name']),
      category: categoryLabel(String(row['category'])),
      quantity: num(row['quantity']),
      unit: unitLabel(String(row['unit'])),
      location: locationLabel(String(row['location'])),
      recordedBy: String(row['recorded_by']),
    }));

    return {
      rows: mapped,
      total: num(counted[0]?.count),
      totals: {},
      chart: {
        type: 'bar',
        title: 'Most used ingredients (times recorded)',
        labels: topItems.map((row) => row.item_name),
        series: [{ name: 'Times used', data: topItems.map((row) => num(row.times)) }],
      },
    };
  }

  // -------------------------------------------------------------------------
  // Suppliers
  // -------------------------------------------------------------------------

  private async suppliers(filters: ReportFilters): Promise<ReportResult> {
    const term = this.search(filters);
    const from = filters.fromDate ?? null;
    const to = filters.toDate ?? null;

    /*
     * The date range filters the *purchases*, not the suppliers.
     *
     * A vendor with no invoices in the window still belongs on a supplier report — with
     * zero against their name, which is itself the useful fact. Filtering the outer rows
     * would silently drop everyone you stopped buying from.
     */
    const where = Prisma.sql`
      WHERE s.deleted_at IS NULL
        AND (${term}::text IS NULL
             OR s.name ILIKE ${term}::text
             OR s.gstin ILIKE ${term}::text
             OR s.city ILIKE ${term}::text)
    `;

    const spendJoin = Prisma.sql`
      LEFT JOIN LATERAL (
        SELECT count(*) AS invoice_count,
               coalesce(sum(p.total_amount), 0) AS total_spend,
               max(p.invoice_date) AS last_purchase
        FROM purchases p
        WHERE p.supplier_id = s.id
          AND (${from}::date IS NULL OR p.invoice_date >= ${from}::date)
          AND (${to}::date   IS NULL OR p.invoice_date <= ${to}::date)
      ) agg ON TRUE
    `;

    const [rows, counted] = await this.client.$transaction([
      this.client.$queryRaw<Record<string, unknown>[]>`
        SELECT s.name, s.gstin, s.state_code, s.city, s.is_active,
               agg.invoice_count, agg.total_spend, agg.last_purchase
        FROM suppliers s ${spendJoin} ${where}
        ${this.order(filters, {
          name: 's.name',
          invoiceCount: 'agg.invoice_count',
          totalSpend: 'agg.total_spend',
        }, 'name')}
        ${this.paging(filters)}
      `,
      this.client.$queryRaw<{ count: bigint; invoices: bigint; spend: unknown }[]>`
        SELECT count(*) AS count,
               coalesce(sum(agg.invoice_count), 0) AS invoices,
               coalesce(sum(agg.total_spend), 0)   AS spend
        FROM suppliers s ${spendJoin} ${where}
      `,
    ]);

    const mapped: ReportRow[] = rows.map((row) => ({
      name: String(row['name']),
      gstin: text(row['gstin'], 'Unregistered'),
      state: stateNameFor(String(row['state_code'])),
      city: text(row['city']),
      status: row['is_active'] === true ? 'Active' : 'Inactive',
      invoiceCount: num(row['invoice_count']),
      totalSpend: num(row['total_spend']),
      lastPurchase: dateOnly(row['last_purchase'] as Date | null),
    }));

    // Charted from the page's own rows: the table and the picture then describe exactly
    // the same set, which a separate aggregate query could not guarantee under paging.
    const top = [...mapped]
      .filter((row) => Number(row['totalSpend']) > 0)
      .sort((a, b) => Number(b['totalSpend']) - Number(a['totalSpend']))
      .slice(0, 8);

    return {
      rows: mapped,
      total: num(counted[0]?.count),
      totals: {
        invoiceCount: num(counted[0]?.invoices),
        totalSpend: num(counted[0]?.spend),
      },
      chart:
        top.length === 0
          ? null
          : {
              type: 'bar',
              title: 'Spend by supplier',
              valuePrefix: '₹',
              labels: top.map((row) => String(row['name'])),
              series: [{ name: 'Spend', data: top.map((row) => Number(row['totalSpend'])) }],
            },
    };
  }

  // -------------------------------------------------------------------------
  // Sales
  // -------------------------------------------------------------------------

  /**
   * Daily takings, one row per trading day with a column per channel.
   *
   * The lines are pivoted in SQL with filtered aggregates rather than fetched and grouped
   * in JavaScript. Four `FILTER` clauses over one join is a single pass; the alternative
   * is four rows per day crossing the wire so the application can transpose them.
   *
   * Days are never synthesised. A day with no entry is absent from the report, because
   * its takings are unknown — printing a zero row would assert the business took nothing,
   * which is a different and unevidenced claim. The dashboard names the missing days.
   */
  private async sales(filters: ReportFilters): Promise<ReportResult> {
    const term = this.search(filters);
    const from = filters.fromDate ?? null;
    const to = filters.toDate ?? null;

    const where = Prisma.sql`
      WHERE e.deleted_at IS NULL
        AND (${from}::date IS NULL OR e.entry_date >= ${from}::date)
        AND (${to}::date   IS NULL OR e.entry_date <= ${to}::date)
        AND (${term}::text IS NULL OR e.notes ILIKE ${term}::text)
    `;

    const buckets = Prisma.sql`
      coalesce(sum(l.amount) FILTER (WHERE l.channel = 'WALK_IN' AND l.payment_mode = 'CASH'), 0)   AS walk_in_cash,
      coalesce(sum(l.amount) FILTER (WHERE l.channel = 'WALK_IN' AND l.payment_mode = 'ONLINE'), 0) AS walk_in_online,
      coalesce(sum(l.amount) FILTER (WHERE l.channel = 'ZOMATO'), 0)                                AS zomato,
      coalesce(sum(l.amount) FILTER (WHERE l.channel = 'SWIGGY'), 0)                                AS swiggy
    `;

    const [rows, counted] = await this.client.$transaction([
      this.client.$queryRaw<Record<string, unknown>[]>`
        SELECT e.entry_date, e.total_amount, e.revision,
               concat_ws(' ', u.first_name, u.last_name) AS recorded_by,
               ${buckets}
        FROM daily_sales_entries e
        LEFT JOIN daily_sales_lines l ON l.entry_id = e.id
        LEFT JOIN users u ON u.id = e.recorded_by_id
        ${where}
        GROUP BY e.id, e.entry_date, e.total_amount, e.revision, u.first_name, u.last_name
        ${this.order(filters, { entryDate: 'e.entry_date', totalAmount: 'e.total_amount' }, 'entryDate')}
        ${this.paging(filters)}
      `,
      /*
       * Totals over the whole filtered set, not the page — the same rule every other
       * report here follows.
       *
       * The grand total sums the **lines**, not `e.total_amount`. The line join fans each
       * entry out to one row per bucket, so summing an entry-level column would count
       * every day four times: an early version reported ₹1,00,360 for three days worth
       * ₹25,090, which is plausible enough to go unnoticed on a screen. Summing the same
       * column the buckets do also guarantees the total equals the four figures beside it.
       *
       * The day count needs `DISTINCT` for the same reason.
       */
      this.client.$queryRaw<Record<string, unknown>[]>`
        SELECT count(DISTINCT e.id) AS count,
               coalesce(sum(l.amount), 0) AS total,
               ${buckets}
        FROM daily_sales_entries e
        LEFT JOIN daily_sales_lines l ON l.entry_id = e.id
        ${where}
      `,
    ]);

    const mapped: ReportRow[] = rows.map((row) => ({
      entryDate: dateOnly(row['entry_date'] as Date | null),
      walkInCash: num(row['walk_in_cash']),
      walkInOnline: num(row['walk_in_online']),
      zomato: num(row['zomato']),
      swiggy: num(row['swiggy']),
      totalAmount: num(row['total_amount']),
      // Flagged on the row rather than hidden: a corrected day is still a fact about the
      // day, and a reader comparing this against a bank statement should know.
      recordedBy: `${text(row['recorded_by'], 'Unknown')}${Number(row['revision'] ?? 1) > 1 ? ' · corrected' : ''}`,
    }));

    const summary = counted[0];

    /*
     * Charted from the totals, not the page.
     *
     * The supplier report charts its own rows because the question there is "who are the
     * biggest of the ones listed". Here the question is "where does revenue come from",
     * which is about the whole filtered period — a donut of one page of days would answer
     * a question nobody asked.
     */
    const slices = [
      { label: 'Walk-in cash', value: num(summary?.['walk_in_cash']) },
      { label: 'Walk-in online', value: num(summary?.['walk_in_online']) },
      { label: 'Zomato', value: num(summary?.['zomato']) },
      { label: 'Swiggy', value: num(summary?.['swiggy']) },
    ].filter((slice) => slice.value > 0);

    return {
      rows: mapped,
      total: num(summary?.['count']),
      totals: {
        walkInCash: num(summary?.['walk_in_cash']),
        walkInOnline: num(summary?.['walk_in_online']),
        zomato: num(summary?.['zomato']),
        swiggy: num(summary?.['swiggy']),
        totalAmount: num(summary?.['total']),
      },
      chart:
        slices.length === 0
          ? null
          : {
              type: 'donut',
              title: 'Revenue by channel',
              valuePrefix: '₹',
              labels: slices.map((slice) => slice.label),
              series: [{ name: 'Revenue', data: slices.map((slice) => slice.value) }],
            },
    };
  }

  // -------------------------------------------------------------------------
  // POS orders
  // -------------------------------------------------------------------------

  /**
   * Itemised counter orders.
   *
   * The **detail behind** the walk-in half of the sales report, not additional revenue.
   * Cancelled orders are included with their status shown rather than filtered out: an order
   * that was taken and then voided is a fact about the evening, and a report that silently
   * omitted it would not reconcile against the audit log.
   */
  private async posOrders(filters: ReportFilters): Promise<ReportResult> {
    const term = this.search(filters);
    const from = filters.fromDate ?? null;
    const to = filters.toDate ?? null;

    const where = Prisma.sql`
      WHERE (${from}::date IS NULL OR o.created_at::date >= ${from}::date)
        AND (${to}::date   IS NULL OR o.created_at::date <= ${to}::date)
        AND (${term}::text IS NULL
             OR o.order_number ILIKE ${term}::text
             OR o.notes ILIKE ${term}::text
             OR c.name ILIKE ${term}::text
             OR EXISTS (SELECT 1 FROM sales_order_items li
                        WHERE li.order_id = o.id AND li.product_name ILIKE ${term}::text))
    `;

    const joins = Prisma.sql`
      FROM sales_orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN users u ON u.id = o.placed_by_id
    `;

    const [rows, counted] = await this.client.$transaction([
      this.client.$queryRaw<Record<string, unknown>[]>`
        SELECT o.order_number, o.created_at, o.status::text AS status,
               o.discount_amount, o.grand_total,
               concat_ws(' ', u.first_name, u.last_name) AS placed_by,
               /*
                * The lines are aggregated in SQL rather than joined out and stitched here:
                * a join would multiply each order by its line count and every money column
                * on this row would then be wrong.
                */
               (SELECT string_agg(
                          li.product_name || CASE WHEN li.quantity > 1
                                                  THEN ' x' || li.quantity::text ELSE '' END,
                          ', ' ORDER BY li.created_at)
                FROM sales_order_items li WHERE li.order_id = o.id) AS items,
               (SELECT coalesce(sum(li.quantity), 0)
                FROM sales_order_items li WHERE li.order_id = o.id) AS quantity,
               /*
                * Method **and amount**, one entry per tender.
                *
                * This was string_agg(DISTINCT p.method), which named the methods and dropped the
                * figures — so a split order read "CASH, UPI" and the report could not answer the
                * question it exists to answer: how much came in as cash. The amount is what makes
                * a split reconcile against a till.
                *
                * Ordered by method so two orders paid the same way read identically, and
                * string_agg over the rows rather than DISTINCT because two tenders of the same
                * method cannot occur — checkTenders refuses them.
                */
               (SELECT string_agg(p.method::text || ':' || p.amount::text, '|' ORDER BY p.method)
                FROM payments p WHERE p.order_id = o.id) AS payment_method
        ${joins} ${where}
        ${this.order(filters, {
          createdAt: 'o.created_at',
          orderNumber: 'o.order_number',
          grandTotal: 'o.grand_total',
        }, 'createdAt')}
        ${this.paging(filters)}
      `,
      /*
       * Totals over the whole filtered set, and **only over paid orders** for the money.
       *
       * A cancelled order still appears as a row, but adding its total into the footer would
       * overstate takings — the same reasoning that keeps cancelled orders out of the day's
       * revenue everywhere else. The row `count` deliberately still counts it.
       *
       * A CTE rather than repeating the filter in a correlated subquery: the unit total has
       * to aggregate the *lines* of the matching orders, and naming the match once is the
       * only way both figures are guaranteed to describe the same set.
       */
      this.client.$queryRaw<Record<string, unknown>[]>`
        WITH matched AS (
          SELECT o.id, o.status, o.grand_total, o.discount_amount
          FROM sales_orders o
          LEFT JOIN customers c ON c.id = o.customer_id
          ${where}
        )
        SELECT count(*) AS count,
               coalesce(sum(m.grand_total)     FILTER (WHERE m.status = 'PAID'), 0) AS total,
               coalesce(sum(m.discount_amount) FILTER (WHERE m.status = 'PAID'), 0) AS discount,
               coalesce((SELECT sum(li.quantity)
                         FROM sales_order_items li
                         JOIN matched paid ON paid.id = li.order_id AND paid.status = 'PAID'), 0) AS units
        FROM matched m
      `,
    ]);

    const mapped: ReportRow[] = rows.map((row) => ({
      orderNumber: String(row['order_number']),
      placedAt: (row['created_at'] as Date).toISOString(),
      items: text(row['items'], 'No items'),
      quantity: num(row['quantity']),
      status: this.orderStatusLabel(String(row['status'])),
      paymentMethod: this.paymentSummary(row['payment_method']),
      discountAmount: num(row['discount_amount']),
      grandTotal: num(row['grand_total']),
      placedBy: text(row['placed_by'], 'Unknown'),
    }));

    const summary = counted[0];

    return {
      rows: mapped,
      total: num(summary?.['count']),
      totals: {
        quantity: num(summary?.['units']),
        discountAmount: num(summary?.['discount']),
        grandTotal: num(summary?.['total']),
      },
      chart: null,
    };
  }

  /**
   * Renders the tenders behind one order.
   *
   * `Cash ₹200.00 + UPI ₹247.00` for a split, `Cash` alone for a single method, `Unpaid` for none.
   *
   * **The amount is omitted when there is only one tender**, because it would restate the order
   * total in the column beside it — every row of a single-method report would carry the same number
   * twice, which is noise in a printed report and an extra thing to reconcile in a spreadsheet. A
   * split is the only case where the breakdown says something the Total column does not.
   *
   * Formatted here rather than in SQL: the labels belong to the domain (`PAYMENT_METHOD_LABELS`),
   * and building currency strings in Postgres puts locale decisions in a query.
   */
  private paymentSummary(raw: unknown): string {
    if (typeof raw !== 'string' || raw.length === 0) {
      return 'Unpaid';
    }

    const tenders = raw.split('|').map((entry) => {
      const [method = '', amount = ''] = entry.split(':');
      return {
        label: PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method,
        amount: Number(amount),
      };
    });

    if (tenders.length === 1) {
      return tenders[0]?.label ?? 'Unpaid';
    }

    return tenders
      .map((tender) => `${tender.label} ₹${tender.amount.toFixed(MONEY_DECIMAL_PLACES)}`)
      .join(' + ');
  }

  /** `PENDING_PAYMENT` reads badly in a printed report. */
  private orderStatusLabel(status: string): string {
    switch (status) {
      case 'PAID':
        return 'Paid';
      case 'PENDING_PAYMENT':
        return 'Awaiting payment';
      case 'CANCELLED':
        return 'Cancelled';
      default:
        return 'Draft';
    }
  }

  // -------------------------------------------------------------------------
  // Product sales
  // -------------------------------------------------------------------------

  /**
   * What sold, per product.
   *
   * The report the declared daily totals cannot produce: a rupee figure per channel has no
   * product in it. This is built from POS order lines, so it exists only for trade that went
   * through the counter — which is worth knowing when reading the share column.
   *
   * **Paid orders only.** A cancelled order's items were not sold.
   */
  private async productSales(filters: ReportFilters): Promise<ReportResult> {
    const term = this.search(filters);
    const from = filters.fromDate ?? null;
    const to = filters.toDate ?? null;

    const where = Prisma.sql`
      WHERE o.status = 'PAID'
        AND (${from}::date IS NULL OR o.created_at::date >= ${from}::date)
        AND (${to}::date   IS NULL OR o.created_at::date <= ${to}::date)
        AND (${term}::text IS NULL OR li.product_name ILIKE ${term}::text)
    `;

    const joins = Prisma.sql`
      FROM sales_order_items li
      JOIN sales_orders o ON o.id = li.order_id
      LEFT JOIN products pr ON pr.id = li.product_id
      LEFT JOIN product_categories pc ON pc.id = pr.category_id
    `;

    const [rows, counted] = await this.client.$transaction([
      this.client.$queryRaw<Record<string, unknown>[]>`
        WITH grand AS (
          SELECT coalesce(sum(li.line_total), 0) AS revenue ${joins} ${where}
        )
        SELECT li.product_name,
               coalesce(pc.name, 'Uncategorised') AS category,
               sum(li.quantity)          AS quantity,
               count(DISTINCT o.id)      AS orders,
               sum(li.line_total)        AS revenue,
               /* Weighted by units, so a discounted line pulls the average down honestly. */
               sum(li.line_total) / nullif(sum(li.quantity), 0) AS average_price,
               CASE WHEN (SELECT revenue FROM grand) > 0
                    THEN round(100 * sum(li.line_total) / (SELECT revenue FROM grand), 1)
                    ELSE NULL END AS share_percent
        ${joins} ${where}
        GROUP BY li.product_name, pc.name
        ${this.order(filters, {
          quantity: 'sum(li.quantity)',
          revenue: 'sum(li.line_total)',
          productName: 'li.product_name',
        }, 'quantity')}
        ${this.paging(filters)}
      `,
      this.client.$queryRaw<Record<string, unknown>[]>`
        SELECT count(DISTINCT li.product_name) AS count,
               coalesce(sum(li.quantity), 0)   AS quantity,
               count(DISTINCT o.id)            AS orders,
               coalesce(sum(li.line_total), 0) AS revenue
        ${joins} ${where}
      `,
    ]);

    const mapped: ReportRow[] = rows.map((row) => ({
      productName: String(row['product_name']),
      category: String(row['category']),
      quantity: num(row['quantity']),
      orders: num(row['orders']),
      revenue: num(row['revenue']),
      averagePrice: num(row['average_price']),
      sharePercent: row['share_percent'] === null ? null : num(row['share_percent']),
    }));

    const summary = counted[0];

    // Charted from the page's rows: the question here is "which of these sold most", which
    // is about what is listed — the same reasoning as the supplier report.
    const top = mapped.slice(0, 10);

    return {
      rows: mapped,
      total: num(summary?.['count']),
      totals: {
        quantity: num(summary?.['quantity']),
        orders: num(summary?.['orders']),
        revenue: num(summary?.['revenue']),
      },
      chart:
        top.length === 0
          ? null
          : {
              type: 'bar',
              title: 'Units sold by product',
              labels: top.map((row) => String(row['productName'])),
              series: [{ name: 'Units', data: top.map((row) => Number(row['quantity'])) }],
            },
    };
  }

  // -------------------------------------------------------------------------
  // Low stock
  // -------------------------------------------------------------------------

  private async lowStock(filters: ReportFilters): Promise<ReportResult> {
    const term = this.search(filters);
    const location = filters.location ?? null;

    // Mirrors `deriveStockStatus`: out at or below zero, low at or below a *real*
    // threshold. A zero minimum means "not tracked", so it only qualifies when empty.
    const where = Prisma.sql`
      WHERE i.deleted_at IS NULL AND i.status = 'ACTIVE'
        AND (i.current_quantity <= 0
             OR (i.minimum_quantity > 0 AND i.current_quantity <= i.minimum_quantity))
        AND (${location}::text IS NULL OR i.location::text = ${location}::text)
        AND (${term}::text IS NULL OR i.name ILIKE ${term}::text)
    `;

    const [rows, counted, byCategory] = await this.client.$transaction([
      this.client.$queryRaw<Record<string, unknown>[]>`
        SELECT i.name, i.category::text AS category, i.location::text AS location,
               i.unit::text AS unit, i.current_quantity, i.minimum_quantity,
               greatest(i.minimum_quantity - i.current_quantity, 0) AS shortfall,
               s.name AS supplier
        FROM inventory_items i LEFT JOIN suppliers s ON s.id = i.supplier_id
        ${where}
        ${this.order(filters, {
          name: 'i.name',
          category: 'i.category',
          shortfall: 'greatest(i.minimum_quantity - i.current_quantity, 0)',
        }, 'shortfall')}
        ${this.paging(filters)}
      `,
      this.client.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM inventory_items i ${where}
      `,
      this.client.$queryRaw<{ category: string; value: bigint }[]>`
        SELECT i.category::text AS category, count(*) AS value
        FROM inventory_items i ${where}
        GROUP BY i.category ORDER BY value DESC
      `,
    ]);

    const mapped: ReportRow[] = rows.map((row) => {
      const current = num(row['current_quantity']);
      const minimum = num(row['minimum_quantity']);

      return {
        name: String(row['name']),
        category: categoryLabel(String(row['category'])),
        location: locationLabel(String(row['location'])),
        currentQuantity: current,
        minimumQuantity: minimum,
        shortfall: num(row['shortfall']),
        unit: unitLabel(String(row['unit'])),
        stockStatus: STOCK_STATUS_LABELS[deriveStockStatus(current, minimum)],
        supplier: text(row['supplier']),
      };
    });

    return {
      rows: mapped,
      total: num(counted[0]?.count),
      totals: {},
      chart: {
        type: 'bar',
        title: 'Items needing restock by category',
        labels: byCategory.map((row) => categoryLabel(row.category)),
        series: [{ name: 'Items', data: byCategory.map((row) => num(row.value)) }],
      },
    };
  }

  // -------------------------------------------------------------------------

  private donut(
    title: string,
    rows: readonly { category: string; value: unknown }[],
    label: (value: string) => string,
    valuePrefix?: string,
  ): ReportChart | null {
    if (rows.length === 0) {
      return null;
    }

    return {
      type: 'donut',
      title,
      ...(valuePrefix === undefined ? {} : { valuePrefix }),
      labels: rows.map((row) => label(row.category)),
      series: [{ name: title, data: rows.map((row) => num(row.value)) }],
    };
  }
}
