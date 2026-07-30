import type { InventoryLocation } from '../../inventory/models/inventory.model';

/** The six reports the API can run. Mirrors the server's `ReportId`. */
export type ReportId =
  | 'inventory'
  | 'purchase'
  | 'transfer'
  | 'consumption'
  | 'supplier'
  | 'low-stock'
  | 'sales'
  | 'pos-orders'
  | 'product-sales';

export type ReportFormat = 'xlsx' | 'pdf';

/**
 * How a column should be rendered.
 *
 * Sent by the server rather than decided here: the same descriptor drives the table, the
 * spreadsheet and the PDF, and three copies of "is this money?" would eventually disagree.
 */
export type ReportColumnType = 'text' | 'number' | 'money' | 'date' | 'datetime';

export interface ReportColumn {
  readonly key: string;
  readonly header: string;
  readonly type: ReportColumnType;
  /** Advisory width in characters, used for the export layouts. */
  readonly width?: number;
  /** Whether a totals row includes this column. */
  readonly total?: boolean;
}

/** A row is a flat bag keyed by column. Values arrive already resolved by the server. */
export type ReportRow = Readonly<Record<string, string | number | null>>;

export interface ReportChart {
  readonly title: string;
  readonly type: 'bar' | 'donut' | 'area';
  readonly labels: readonly string[];
  /** Always a named series, even for a donut — the server has one shape for all charts. */
  readonly series: readonly { readonly name: string; readonly data: readonly number[] }[];
  readonly valuePrefix?: string;
}

/** What a report offers, so the filter bar can be built from the server's answer. */
export interface ReportDescriptor {
  readonly id: ReportId;
  readonly label: string;
  readonly description: string;
  readonly supportsDateRange: boolean;
  readonly supportsLocation: boolean;
  readonly supportsSupplier: boolean;
  readonly searchHint: string;
  readonly sortFields: readonly string[];
  readonly defaultSortField: string;
  readonly defaultSortDirection: 'asc' | 'desc';
}

export interface ReportPagination {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
}

export interface ReportResult {
  readonly report: ReportDescriptor;
  /**
   * Only the columns this caller may see.
   *
   * A Store Manager receives the inventory report without `unitCost` or `stockValue` —
   * not hidden client-side, absent from the payload. The table is built from this list,
   * so nothing extra needs to know about the rule.
   */
  readonly columns: readonly ReportColumn[];
  readonly rows: readonly ReportRow[];
  readonly totals: Readonly<Record<string, number>>;
  readonly chart: ReportChart | null;
  /** The filters in force, already worded by the server for display and for exports. */
  readonly appliedFilters: readonly string[];
  readonly pagination: ReportPagination;
  readonly generatedAt: string;
}

/** Everything the page can vary. Empty strings are normalised away by the service. */
export interface ReportFilters {
  readonly search?: string | undefined;
  readonly fromDate?: string | undefined;
  readonly toDate?: string | undefined;
  readonly location?: InventoryLocation | undefined;
  readonly supplierId?: string | undefined;
  readonly sortField?: string | undefined;
  readonly sortDirection?: 'asc' | 'desc' | undefined;
}

export interface ReportQuery extends ReportFilters {
  readonly page: number;
  readonly pageSize: number;
}

/** Maps a column type to the table's numeric styling and right alignment. */
export function isNumericColumn(column: ReportColumn): boolean {
  return column.type === 'money' || column.type === 'number';
}
