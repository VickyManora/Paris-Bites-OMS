import { INVENTORY_LOCATION_LABELS } from '../../../domain/enums/inventory.enum.js';
import type { Permission } from '../../../domain/enums/permission.enum.js';
import { Permission as Permissions } from '../../../domain/enums/permission.enum.js';
import { MAX_EXPORT_ROWS, type ReportFormat, type ReportId } from '../../../domain/enums/report.enum.js';
import { ForbiddenError, NotFoundError } from '../../../domain/errors/domain-error.js';
import type {
  IReportRepository,
  ReportChart,
  ReportColumn,
  ReportFilters,
  ReportRow,
} from '../../../domain/repositories/report.repository.js';
import type { IReportExporter, ReportFile } from '../../ports/report-exporter.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';
import {
  findReportDefinition,
  REPORT_DEFINITIONS,
  visibleColumns,
  type ReportDefinition,
} from '../../reports/report-definitions.js';

export interface ReportDescriptorDto {
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

export interface RunReportResultDto {
  readonly report: ReportDescriptorDto;
  /** Only what this caller may see — financial columns are removed for everyone else. */
  readonly columns: readonly ReportColumn[];
  readonly rows: readonly ReportRow[];
  readonly totals: Readonly<Record<string, number>>;
  readonly chart: ReportChart | null;
  readonly appliedFilters: readonly string[];
  readonly pagination: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
    readonly hasNext: boolean;
    readonly hasPrevious: boolean;
  };
  readonly generatedAt: string;
}

export interface RunReportInput {
  readonly id: ReportId;
  readonly permissions: readonly Permission[];
  readonly filters: ReportFilters;
  readonly page: number;
  readonly pageSize: number;
}

export interface ExportReportInput {
  readonly id: ReportId;
  readonly format: ReportFormat;
  readonly permissions: readonly Permission[];
  readonly filters: ReportFilters;
  readonly generatedBy: string;
}

/** Lists what this caller may run, so the picker never offers a report that 403s. */
export class ListReportsUseCase implements IUseCase<readonly Permission[], readonly ReportDescriptorDto[]> {
  execute(permissions: readonly Permission[]): Promise<readonly ReportDescriptorDto[]> {
    return Promise.resolve(
      REPORT_DEFINITIONS.filter((definition) => permissions.includes(definition.permission)).map(
        (definition) => toDescriptor(definition),
      ),
    );
  }
}

function toDescriptor(definition: ReportDefinition): ReportDescriptorDto {
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    supportsDateRange: definition.supportsDateRange,
    supportsLocation: definition.supportsLocation,
    supportsSupplier: definition.supportsSupplier,
    searchHint: definition.searchHint,
    sortFields: definition.sortFields,
    defaultSortField: definition.defaultSortField,
    defaultSortDirection: definition.defaultSortDirection,
  };
}

/**
 * Resolves the definition and checks the caller may run it.
 *
 * Shared by run and export so the two cannot disagree about who is allowed what — an
 * export that enforced less than the screen would be the more dangerous of the pair.
 */
function authorise(
  id: ReportId,
  permissions: readonly Permission[],
): { definition: ReportDefinition; canSeeFinancial: boolean } {
  const definition = findReportDefinition(id);

  if (definition === undefined) {
    throw new NotFoundError('Report', id);
  }

  if (!permissions.includes(definition.permission)) {
    throw new ForbiddenError('You do not have access to this report.');
  }

  return {
    definition,
    canSeeFinancial: permissions.includes(Permissions.REPORT_VIEW_FINANCIAL),
  };
}

/**
 * Strips values whose column this caller may not see.
 *
 * The columns are filtered *and* the rows rewritten. Removing only the header would leave
 * the cost of every item sitting in the JSON, one devtools tab away from someone who was
 * never meant to have it.
 */
function project(
  rows: readonly ReportRow[],
  columns: readonly ReportColumn[],
): readonly ReportRow[] {
  const keys = columns.map((column) => column.key);

  return rows.map((row) => Object.fromEntries(keys.map((key) => [key, row[key] ?? null])));
}

/** Human wording for the filters, printed on exports and shown above the table. */
function describeFilters(definition: ReportDefinition, filters: ReportFilters): string[] {
  const described: string[] = [];

  if (definition.supportsDateRange) {
    const from = filters.fromDate?.toISOString().slice(0, 10);
    const to = filters.toDate?.toISOString().slice(0, 10);

    if (from !== undefined && to !== undefined) {
      described.push(`${from} to ${to}`);
    } else if (from !== undefined) {
      described.push(`from ${from}`);
    } else if (to !== undefined) {
      described.push(`up to ${to}`);
    }
  }

  if (filters.location !== undefined) {
    described.push(`location: ${INVENTORY_LOCATION_LABELS[filters.location]}`);
  }
  if (filters.supplierId !== undefined) {
    described.push('one supplier');
  }
  if (filters.search !== undefined && filters.search.trim().length > 0) {
    described.push(`search: "${filters.search.trim()}"`);
  }

  return described;
}

/** Sorting is resolved against the definition, so an unknown field cannot reach the SQL. */
function resolveSort(definition: ReportDefinition, filters: ReportFilters): ReportFilters {
  const requested = filters.sortField;
  const field =
    requested !== undefined && definition.sortFields.includes(requested)
      ? requested
      : definition.defaultSortField;

  return {
    ...filters,
    sortField: field,
    sortDirection: filters.sortDirection ?? definition.defaultSortDirection,
  };
}

export class RunReportUseCase implements IUseCase<RunReportInput, RunReportResultDto> {
  constructor(private readonly reports: IReportRepository) {}

  async execute(input: RunReportInput): Promise<RunReportResultDto> {
    const { definition, canSeeFinancial } = authorise(input.id, input.permissions);
    const columns = visibleColumns(definition, canSeeFinancial);

    const filters = resolveSort(definition, {
      ...input.filters,
      page: input.page,
      pageSize: input.pageSize,
    });

    const result = await this.reports.run(definition.id, filters);
    const totalPages = Math.max(1, Math.ceil(result.total / input.pageSize));

    return {
      report: toDescriptor(definition),
      columns,
      rows: project(result.rows, columns),
      // Totals for withheld columns are dropped too: a Store Manager should not receive a
      // grand total of costs they cannot see the components of.
      totals: Object.fromEntries(
        Object.entries(result.totals).filter(([key]) =>
          columns.some((column) => column.key === key),
        ),
      ),
      chart: canSeeFinancial ? result.chart : this.stripFinancialChart(result.chart),
      appliedFilters: describeFilters(definition, filters),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total: result.total,
        totalPages,
        hasNext: input.page < totalPages,
        hasPrevious: input.page > 1,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Drops a chart that plots money from a caller who cannot see money.
   *
   * The inventory and supplier charts are valuations; withholding the column but shipping
   * the chart would hand over the same figures in a different shape.
   */
  private stripFinancialChart(chart: ReportChart | null): ReportChart | null {
    if (chart === null) {
      return null;
    }

    return chart.valuePrefix === '₹' ? null : chart;
  }
}

export class ExportReportUseCase implements IUseCase<ExportReportInput, ReportFile> {
  constructor(
    private readonly reports: IReportRepository,
    private readonly exporters: readonly IReportExporter[],
  ) {}

  async execute(input: ExportReportInput): Promise<ReportFile> {
    const { definition, canSeeFinancial } = authorise(input.id, input.permissions);
    const exporter = this.exporters.find((candidate) => candidate.format === input.format);

    if (exporter === undefined) {
      throw new NotFoundError('Export format', input.format);
    }

    const columns = visibleColumns(definition, canSeeFinancial);

    /*
     * No paging: an export is the whole filtered set.
     *
     * Exporting the page on screen is the classic version of this feature and it is wrong —
     * someone filters to a quarter, sees "1–25 of 214", exports, and files a spreadsheet of
     * 25 rows as the quarter's figures.
     */
    const filters = resolveSort(definition, {
      ...input.filters,
      page: undefined,
      pageSize: undefined,
    });

    const result = await this.reports.run(definition.id, filters);

    return exporter.export({
      title: definition.label,
      description: definition.description,
      appliedFilters: describeFilters(definition, filters),
      columns,
      rows: project(result.rows, columns),
      totals: Object.fromEntries(
        Object.entries(result.totals).filter(([key]) =>
          columns.some((column) => column.key === key),
        ),
      ),
      generatedAt: new Date(),
      generatedBy: input.generatedBy,
      // Said on the file rather than swallowed: a spreadsheet that silently stops at the
      // cap looks complete and is not.
      ...(result.rows.length >= MAX_EXPORT_ROWS ? { truncatedAt: MAX_EXPORT_ROWS } : {}),
    });
  }
}
