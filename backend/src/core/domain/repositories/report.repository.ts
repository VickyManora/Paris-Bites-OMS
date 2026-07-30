import type { ReportColumnType, ReportId } from '../enums/report.enum.js';
import type { InventoryLocation } from '../enums/inventory.enum.js';

/**
 * One column, declared once.
 *
 * The same definition drives the web table, the spreadsheet and the PDF. Three hand-written
 * column lists would drift the first time someone added a field to one of them — and the
 * failure would be silent, because an export missing a column still opens.
 */
export interface ReportColumn {
  readonly key: string;
  readonly header: string;
  readonly type: ReportColumnType;
  /** Column width in characters, for the spreadsheet and the PDF. */
  readonly width?: number;
  /** Summed into the totals row. Only ever set on numeric and money columns. */
  readonly total?: boolean;
  /**
   * Withheld from anyone without `REPORT_VIEW_FINANCIAL`.
   *
   * Dropped from the column list *and* from every row, so a Store Manager's response
   * carries no cost data at all rather than data the client is trusted to hide.
   */
  readonly financial?: boolean;
}

/** A row is a flat bag keyed by column. Values are already typed for the renderers. */
export type ReportRow = Readonly<Record<string, string | number | null>>;

export interface ReportFilters {
  readonly search?: string | undefined;
  /** Inclusive, `YYYY-MM-DD`. Ignored by reports that describe current state. */
  readonly fromDate?: Date | undefined;
  readonly toDate?: Date | undefined;
  readonly location?: InventoryLocation | undefined;
  readonly supplierId?: string | undefined;
  readonly sortField?: string | undefined;
  readonly sortDirection?: 'asc' | 'desc' | undefined;
  /** Omitted for an export, which needs every matching row rather than a page. */
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
}

/** A chart summarising the same rows, so the picture and the table cannot disagree. */
export interface ReportChart {
  readonly type: 'bar' | 'donut' | 'area';
  readonly title: string;
  readonly labels: readonly string[];
  readonly series: readonly { readonly name: string; readonly data: readonly number[] }[];
  /** Prefixed to values by the client, `₹` for money. */
  readonly valuePrefix?: string;
}

export interface ReportResult {
  readonly rows: readonly ReportRow[];
  readonly total: number;
  /** Keyed by column. Only columns marked `total` appear. */
  readonly totals: Readonly<Record<string, number>>;
  readonly chart: ReportChart | null;
}

export interface IReportRepository {
  /**
   * Runs one report.
   *
   * Paging is part of the filter rather than a separate argument because an export
   * genuinely wants it absent — and an optional pair of numbers says that more plainly
   * than a nullable page object.
   */
  run(id: ReportId, filters: ReportFilters): Promise<ReportResult>;
}
