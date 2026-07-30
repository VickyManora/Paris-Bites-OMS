import { Permission } from '../../domain/enums/permission.enum.js';
import { ReportColumnType, ReportId } from '../../domain/enums/report.enum.js';
import type { ReportColumn } from '../../domain/repositories/report.repository.js';

/**
 * Everything about a report except the SQL behind it.
 *
 * Kept as data so the API can list what a user may run, the client can build a table from
 * the columns it is told about, and both exporters can format without knowing which report
 * they are rendering.
 */
export interface ReportDefinition {
  readonly id: ReportId;
  readonly label: string;
  readonly description: string;
  /** The capability needed to run it at all. Column-level gating is separate. */
  readonly permission: Permission;
  /** False for reports that describe the present rather than a period. */
  readonly supportsDateRange: boolean;
  readonly supportsLocation: boolean;
  readonly supportsSupplier: boolean;
  readonly searchHint: string;
  /** A closed set, so a caller cannot sort by an unindexed column. */
  readonly sortFields: readonly string[];
  readonly defaultSortField: string;
  readonly defaultSortDirection: 'asc' | 'desc';
  readonly columns: readonly ReportColumn[];
}

const { TEXT, NUMBER, MONEY, DATE, DATETIME } = ReportColumnType;

export const REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    id: ReportId.INVENTORY,
    label: 'Inventory',
    description: 'Every active item with its stock level, reorder point and value.',
    // Not financial to *run*: knowing what is on the shelf is the Store Manager's job. The
    // value column carries the financial flag on its own.
    permission: Permission.REPORT_VIEW,
    supportsDateRange: false,
    supportsLocation: true,
    supportsSupplier: false,
    searchHint: 'Item name or notes',
    sortFields: ['name', 'category', 'currentQuantity', 'stockValue'],
    defaultSortField: 'name',
    defaultSortDirection: 'asc',
    columns: [
      { key: 'name', header: 'Item', type: TEXT, width: 28 },
      { key: 'category', header: 'Category', type: TEXT, width: 20 },
      { key: 'location', header: 'Location', type: TEXT, width: 16 },
      { key: 'unit', header: 'Unit', type: TEXT, width: 10 },
      { key: 'currentQuantity', header: 'In stock', type: NUMBER, width: 12 },
      { key: 'minimumQuantity', header: 'Minimum', type: NUMBER, width: 12 },
      { key: 'stockStatus', header: 'Status', type: TEXT, width: 14 },
      { key: 'purchasePrice', header: 'Unit cost', type: MONEY, width: 14, financial: true },
      { key: 'stockValue', header: 'Value', type: MONEY, width: 14, total: true, financial: true },
    ],
  },

  {
    id: ReportId.PURCHASE,
    label: 'Purchases',
    description: 'Supplier invoices with their GST split and totals.',
    // Wholly financial — every row is money the business spent.
    permission: Permission.REPORT_VIEW_FINANCIAL,
    supportsDateRange: true,
    supportsLocation: false,
    supportsSupplier: true,
    searchHint: 'Invoice number or supplier',
    sortFields: ['invoiceDate', 'invoiceNumber', 'supplier', 'totalAmount'],
    defaultSortField: 'invoiceDate',
    defaultSortDirection: 'desc',
    columns: [
      { key: 'invoiceDate', header: 'Date', type: DATE, width: 14 },
      { key: 'invoiceNumber', header: 'Invoice', type: TEXT, width: 18 },
      { key: 'supplier', header: 'Supplier', type: TEXT, width: 26 },
      { key: 'gstTreatment', header: 'GST', type: TEXT, width: 14 },
      { key: 'lineCount', header: 'Items', type: NUMBER, width: 10 },
      { key: 'subtotal', header: 'Subtotal', type: MONEY, width: 14, total: true },
      { key: 'totalTax', header: 'Tax', type: MONEY, width: 14, total: true },
      { key: 'totalAmount', header: 'Total', type: MONEY, width: 14, total: true },
      { key: 'billAttached', header: 'Bill', type: TEXT, width: 12 },
    ],
  },

  {
    id: ReportId.TRANSFER,
    label: 'Transfers',
    description: 'Stock moved between the warehouse and the cart.',
    permission: Permission.REPORT_VIEW,
    supportsDateRange: true,
    supportsLocation: false,
    supportsSupplier: false,
    searchHint: 'Reference or notes',
    sortFields: ['requestedAt', 'reference', 'status'],
    defaultSortField: 'requestedAt',
    defaultSortDirection: 'desc',
    columns: [
      { key: 'requestedAt', header: 'Requested', type: DATE, width: 14 },
      { key: 'reference', header: 'Reference', type: TEXT, width: 16 },
      { key: 'route', header: 'Route', type: TEXT, width: 30 },
      { key: 'status', header: 'Status', type: TEXT, width: 14 },
      { key: 'lineCount', header: 'Items', type: NUMBER, width: 10, total: true },
      { key: 'requestedBy', header: 'Requested by', type: TEXT, width: 22 },
      { key: 'completedAt', header: 'Completed', type: DATE, width: 14 },
    ],
  },

  {
    id: ReportId.CONSUMPTION,
    label: 'Consumption',
    description: 'What the kitchen used, one row per ingredient per day.',
    permission: Permission.REPORT_VIEW,
    supportsDateRange: true,
    supportsLocation: true,
    supportsSupplier: false,
    searchHint: 'Item name or sheet notes',
    sortFields: ['entryDate', 'itemName', 'quantity'],
    defaultSortField: 'entryDate',
    defaultSortDirection: 'desc',
    columns: [
      { key: 'entryDate', header: 'Date', type: DATE, width: 14 },
      { key: 'itemName', header: 'Item', type: TEXT, width: 28 },
      { key: 'category', header: 'Category', type: TEXT, width: 20 },
      // Not totalled: summing kilograms, litres and packets into one figure would produce
      // a number with no unit. The chart counts occurrences instead.
      { key: 'quantity', header: 'Used', type: NUMBER, width: 12 },
      { key: 'unit', header: 'Unit', type: TEXT, width: 10 },
      { key: 'location', header: 'Location', type: TEXT, width: 16 },
      { key: 'recordedBy', header: 'Recorded by', type: TEXT, width: 22 },
    ],
  },

  {
    id: ReportId.SUPPLIER,
    label: 'Suppliers',
    description: 'Vendors with what has been bought from each.',
    permission: Permission.REPORT_VIEW,
    supportsDateRange: true,
    supportsLocation: false,
    supportsSupplier: false,
    searchHint: 'Name, GSTIN or city',
    sortFields: ['name', 'invoiceCount', 'totalSpend'],
    defaultSortField: 'name',
    defaultSortDirection: 'asc',
    columns: [
      { key: 'name', header: 'Supplier', type: TEXT, width: 28 },
      { key: 'gstin', header: 'GSTIN', type: TEXT, width: 20 },
      { key: 'state', header: 'State', type: TEXT, width: 18 },
      { key: 'city', header: 'City', type: TEXT, width: 16 },
      { key: 'status', header: 'Status', type: TEXT, width: 12 },
      { key: 'invoiceCount', header: 'Invoices', type: NUMBER, width: 12, total: true },
      { key: 'totalSpend', header: 'Total spend', type: MONEY, width: 16, total: true, financial: true },
      { key: 'lastPurchase', header: 'Last purchase', type: DATE, width: 16 },
    ],
  },

  {
    id: ReportId.SALES,
    label: 'Sales',
    description: "Daily takings, split by channel and how the money arrived.",
    /*
     * Financial, like the purchase report. Revenue is the figure the business is judged
     * on, and the same reasoning that keeps supplier spend from a Store Manager applies —
     * this also keeps the report's permission aligned with `SALE_READ`, which is
     * admin-only, so the report cannot become a side door into data the module withholds.
     */
    permission: Permission.REPORT_VIEW_FINANCIAL,
    supportsDateRange: true,
    supportsLocation: false,
    supportsSupplier: false,
    searchHint: 'Notes on the day',
    sortFields: ['entryDate', 'totalAmount'],
    defaultSortField: 'entryDate',
    defaultSortDirection: 'desc',
    columns: [
      { key: 'entryDate', header: 'Date', type: DATE, width: 14 },
      { key: 'walkInCash', header: 'Walk-in cash', type: MONEY, width: 16, total: true },
      { key: 'walkInOnline', header: 'Walk-in online', type: MONEY, width: 16, total: true },
      { key: 'zomato', header: 'Zomato', type: MONEY, width: 14, total: true },
      { key: 'swiggy', header: 'Swiggy', type: MONEY, width: 14, total: true },
      { key: 'totalAmount', header: 'Total', type: MONEY, width: 16, total: true },
      { key: 'recordedBy', header: 'Recorded by', type: TEXT, width: 20 },
    ],
  },

  {
    id: ReportId.POS_ORDERS,
    label: 'POS orders',
    description:
      'Every order taken at the counter, itemised. The counter’s own record — not the declared daily total.',
    /*
     * Financial, like the sales report, and for the same reason: these are takings.
     *
     * Note this is the *detail* behind the walk-in part of the sales report, not extra
     * revenue on top of it. Anyone adding the two together is double-counting the same
     * trade, which is why the description says whose record it is.
     */
    permission: Permission.REPORT_VIEW_FINANCIAL,
    supportsDateRange: true,
    supportsLocation: false,
    supportsSupplier: false,
    searchHint: 'Order number, item or customer',
    sortFields: ['createdAt', 'orderNumber', 'grandTotal'],
    defaultSortField: 'createdAt',
    defaultSortDirection: 'desc',
    columns: [
      { key: 'orderNumber', header: 'Order', type: TEXT, width: 20 },
      { key: 'placedAt', header: 'Time', type: DATETIME, width: 20 },
      { key: 'items', header: 'Items', type: TEXT, width: 34 },
      { key: 'quantity', header: 'Units', type: NUMBER, width: 10, total: true },
      { key: 'status', header: 'Status', type: TEXT, width: 16 },
      { key: 'paymentMethod', header: 'Payment', type: TEXT, width: 12 },
      { key: 'discountAmount', header: 'Discount', type: MONEY, width: 14, total: true },
      { key: 'grandTotal', header: 'Total', type: MONEY, width: 14, total: true },
      { key: 'placedBy', header: 'Taken by', type: TEXT, width: 20 },
    ],
  },

  {
    id: ReportId.PRODUCT_SALES,
    label: 'Product sales',
    description:
      'What actually sold, ranked by units. Built from POS order lines — the declared daily totals cannot answer this.',
    permission: Permission.REPORT_VIEW_FINANCIAL,
    supportsDateRange: true,
    supportsLocation: false,
    supportsSupplier: false,
    searchHint: 'Product name',
    sortFields: ['quantity', 'revenue', 'productName'],
    defaultSortField: 'quantity',
    defaultSortDirection: 'desc',
    columns: [
      { key: 'productName', header: 'Product', type: TEXT, width: 30 },
      { key: 'category', header: 'Category', type: TEXT, width: 20 },
      { key: 'quantity', header: 'Units sold', type: NUMBER, width: 14, total: true },
      { key: 'orders', header: 'Orders', type: NUMBER, width: 12, total: true },
      { key: 'revenue', header: 'Revenue', type: MONEY, width: 16, total: true },
      { key: 'averagePrice', header: 'Avg price', type: MONEY, width: 14 },
      { key: 'sharePercent', header: 'Share', type: NUMBER, width: 10 },
    ],
  },

  {
    id: ReportId.LOW_STOCK,
    label: 'Low stock',
    description: 'Items at or below their reorder level, worst first.',
    permission: Permission.REPORT_VIEW,
    supportsDateRange: false,
    supportsLocation: true,
    supportsSupplier: false,
    searchHint: 'Item name',
    sortFields: ['name', 'category', 'shortfall'],
    defaultSortField: 'shortfall',
    defaultSortDirection: 'desc',
    columns: [
      { key: 'name', header: 'Item', type: TEXT, width: 28 },
      { key: 'category', header: 'Category', type: TEXT, width: 20 },
      { key: 'location', header: 'Location', type: TEXT, width: 16 },
      { key: 'currentQuantity', header: 'In stock', type: NUMBER, width: 12 },
      { key: 'minimumQuantity', header: 'Minimum', type: NUMBER, width: 12 },
      { key: 'shortfall', header: 'Short by', type: NUMBER, width: 12 },
      { key: 'unit', header: 'Unit', type: TEXT, width: 10 },
      { key: 'stockStatus', header: 'Status', type: TEXT, width: 14 },
      { key: 'supplier', header: 'Usual supplier', type: TEXT, width: 24 },
    ],
  },
];

export function findReportDefinition(id: ReportId): ReportDefinition | undefined {
  return REPORT_DEFINITIONS.find((definition) => definition.id === id);
}

/**
 * The columns a caller may actually see.
 *
 * Financial columns are removed entirely rather than blanked, so the header row of a
 * Store Manager's export has no empty "Total spend" waiting to be misread as zero.
 */
export function visibleColumns(
  definition: ReportDefinition,
  canSeeFinancial: boolean,
): readonly ReportColumn[] {
  return canSeeFinancial
    ? definition.columns
    : definition.columns.filter((column) => column.financial !== true);
}
