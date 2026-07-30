import ExcelJS from 'exceljs';
import type {
  IReportExporter,
  ReportExportRequest,
  ReportFile,
} from '../../core/application/ports/report-exporter.port.js';
import { ReportColumnType, ReportFormat } from '../../core/domain/enums/report.enum.js';

/** Indian currency, two places. Excel formats the number; the cell still holds a number. */
const MONEY_FORMAT = '₹#,##,##0.00';
const NUMBER_FORMAT = '#,##,##0.###';

/**
 * Writes a report to a real spreadsheet.
 *
 * **Numbers stay numbers.** A money cell holds `1416` with a currency *format*, not the
 * string "₹1,416.00" — the entire reason someone exports to Excel is to sort, filter and
 * total it themselves, and a grid of pre-formatted text does none of that.
 *
 * The header block above the table records what produced the file. A spreadsheet outlives
 * the screen it came from, and one that does not say which period it covers gets quoted as
 * though it covered everything.
 */
export class ExcelReportExporter implements IReportExporter {
  readonly format = ReportFormat.XLSX;

  async export(request: ReportExportRequest): Promise<ReportFile> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Paris Bites';
    workbook.created = request.generatedAt;

    const sheet = workbook.addWorksheet(request.title.slice(0, 31), {
      views: [{ state: 'frozen', ySplit: this.headerRowCount(request) }],
    });

    this.writeHeaderBlock(sheet, request);

    const headerRow = sheet.addRow(request.columns.map((column) => column.header));
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { vertical: 'middle' };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7A0C3E' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF7A0C3E' } } };
    });
    headerRow.height = 20;

    for (const row of request.rows) {
      const values = request.columns.map((column) => this.cellValue(row[column.key], column.type));
      const added = sheet.addRow(values);

      request.columns.forEach((column, index) => {
        const cell = added.getCell(index + 1);

        if (column.type === ReportColumnType.MONEY) {
          cell.numFmt = MONEY_FORMAT;
          cell.alignment = { horizontal: 'right' };
        } else if (column.type === ReportColumnType.NUMBER) {
          cell.numFmt = NUMBER_FORMAT;
          cell.alignment = { horizontal: 'right' };
        }
      });
    }

    this.writeTotals(sheet, request);

    // Widths from the definition, so a column of item names is not eight characters wide.
    request.columns.forEach((column, index) => {
      sheet.getColumn(index + 1).width = column.width ?? 18;
    });

    // Native autofilter over the data, which is the first thing anyone does to an export.
    const firstDataRow = this.headerRowCount(request);
    sheet.autoFilter = {
      from: { row: firstDataRow, column: 1 },
      to: { row: firstDataRow + request.rows.length, column: request.columns.length },
    };

    const buffer = await workbook.xlsx.writeBuffer();

    return {
      filename: this.filename(request),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: Buffer.from(buffer),
    };
  }

  /** Rows occupied by the title block, including the column header row itself. */
  private headerRowCount(request: ReportExportRequest): number {
    // Title, description, generated-by, a blank, then one per filter, then the headers.
    return 4 + Math.max(request.appliedFilters.length, 1) + (request.truncatedAt === undefined ? 0 : 1) + 1;
  }

  private writeHeaderBlock(sheet: ExcelJS.Worksheet, request: ReportExportRequest): void {
    const title = sheet.addRow([request.title]);
    title.font = { bold: true, size: 16 };

    sheet.addRow([request.description]).font = { italic: true, color: { argb: 'FF666666' } };
    sheet.addRow([
      `Generated ${request.generatedAt.toISOString().replace('T', ' ').slice(0, 16)} by ${request.generatedBy}`,
    ]).font = { size: 9, color: { argb: 'FF666666' } };

    if (request.appliedFilters.length === 0) {
      sheet.addRow(['Filters: none — all records']).font = { size: 9, color: { argb: 'FF666666' } };
    } else {
      for (const filter of request.appliedFilters) {
        sheet.addRow([`Filter: ${filter}`]).font = { size: 9, color: { argb: 'FF666666' } };
      }
    }

    if (request.truncatedAt !== undefined) {
      sheet.addRow([
        `NOTE: truncated to the first ${String(request.truncatedAt)} rows. Narrow the filters for a complete export.`,
      ]).font = { bold: true, color: { argb: 'FFB3261E' } };
    }

    sheet.addRow([]);
  }

  private writeTotals(sheet: ExcelJS.Worksheet, request: ReportExportRequest): void {
    const totalled = request.columns.filter((column) => column.total === true);

    if (totalled.length === 0 || request.rows.length === 0) {
      return;
    }

    const values = request.columns.map((column, index) =>
      index === 0 ? 'Total' : (request.totals[column.key] ?? null),
    );

    const row = sheet.addRow(values);
    row.font = { bold: true };
    row.eachCell((cell, index) => {
      const column = request.columns[index - 1];

      cell.border = { top: { style: 'double', color: { argb: 'FF7A0C3E' } } };

      if (column?.type === ReportColumnType.MONEY) {
        cell.numFmt = MONEY_FORMAT;
      } else if (column?.type === ReportColumnType.NUMBER) {
        cell.numFmt = NUMBER_FORMAT;
      }
    });
  }

  /**
   * Numbers and dates land as their real types; everything else as text.
   *
   * A date written as a string sorts alphabetically in Excel, which puts December before
   * February. `YYYY-MM-DD` happens to sort correctly as text, so it is left alone rather
   * than converted to a Date whose display would then depend on the reader's locale.
   */
  private cellValue(
    value: string | number | null | undefined,
    type: ReportColumnType,
  ): string | number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (type === ReportColumnType.MONEY || type === ReportColumnType.NUMBER) {
      return typeof value === 'number' ? value : Number(value);
    }

    return String(value);
  }

  private filename(request: ReportExportRequest): string {
    const slug = request.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${slug}-${request.generatedAt.toISOString().slice(0, 10)}.xlsx`;
  }
}
