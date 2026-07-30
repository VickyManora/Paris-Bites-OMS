/**
 * Reporting vocabulary, owned by the domain.
 */

export const ReportId = {
  INVENTORY: 'inventory',
  PURCHASE: 'purchase',
  TRANSFER: 'transfer',
  CONSUMPTION: 'consumption',
  SUPPLIER: 'supplier',
  LOW_STOCK: 'low-stock',
  SALES: 'sales',
  /** Itemised POS orders — the counter's own record, not the declared daily total. */
  POS_ORDERS: 'pos-orders',
  /** What actually sold, per product. Only POS data can answer this. */
  PRODUCT_SALES: 'product-sales',
} as const;

export type ReportId = (typeof ReportId)[keyof typeof ReportId];

export const ALL_REPORT_IDS: readonly ReportId[] = Object.values(ReportId);

export function isReportId(value: unknown): value is ReportId {
  return typeof value === 'string' && ALL_REPORT_IDS.includes(value as ReportId);
}

export const ReportFormat = {
  XLSX: 'xlsx',
  PDF: 'pdf',
} as const;

export type ReportFormat = (typeof ReportFormat)[keyof typeof ReportFormat];

export const ALL_REPORT_FORMATS: readonly ReportFormat[] = [ReportFormat.XLSX, ReportFormat.PDF];

/**
 * How a column's value should be read, by anything rendering it.
 *
 * The renderer decides the formatting — a spreadsheet wants a real number in a currency
 * cell so it can be summed, a PDF wants "₹1,416.00" as text, and the web table wants
 * something in between. Sending a pre-formatted string to all three would make the Excel
 * export a grid of text nobody can total.
 */
export const ReportColumnType = {
  TEXT: 'text',
  NUMBER: 'number',
  MONEY: 'money',
  /** `YYYY-MM-DD`. A calendar day, never re-interpreted in a timezone. */
  DATE: 'date',
  DATETIME: 'datetime',
} as const;

export type ReportColumnType = (typeof ReportColumnType)[keyof typeof ReportColumnType];

/**
 * The largest export this will assemble.
 *
 * A cap rather than a stream, because both writers build in memory. Ten thousand rows is
 * far past any real month of this business, and the response says when it truncated rather
 * than quietly handing over a partial file — a report that silently stops at row 10,000 is
 * worse than one that admits it.
 */
export const MAX_EXPORT_ROWS = 10_000;
