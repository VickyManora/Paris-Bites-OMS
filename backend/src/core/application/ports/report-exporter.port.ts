import type { ReportFormat } from '../../domain/enums/report.enum.js';
import type { ReportColumn, ReportRow } from '../../domain/repositories/report.repository.js';

/** What a file needs beyond the rows themselves. */
export interface ReportExportRequest {
  readonly title: string;
  readonly description: string;
  /**
   * The filters that produced these rows, already worded for a human.
   *
   * Printed onto the file. An exported report separated from the screen that produced it is
   * otherwise unfalsifiable — a spreadsheet of eleven invoices says nothing about whether
   * that is the whole year or one week, and someone will assume the former.
   */
  readonly appliedFilters: readonly string[];
  readonly columns: readonly ReportColumn[];
  readonly rows: readonly ReportRow[];
  readonly totals: Readonly<Record<string, number>>;
  readonly generatedAt: Date;
  readonly generatedBy: string;
  /** Set when the row cap bit, so the file can say so on its own face. */
  readonly truncatedAt?: number | undefined;
}

export interface ReportFile {
  readonly filename: string;
  readonly mimeType: string;
  readonly bytes: Buffer;
}

/**
 * Renders a report to a downloadable file.
 *
 * A port because the two implementations share nothing but this shape, and because a
 * future CSV or Google Sheets target should not require touching the use case.
 */
export interface IReportExporter {
  readonly format: ReportFormat;
  export(request: ReportExportRequest): Promise<ReportFile>;
}
