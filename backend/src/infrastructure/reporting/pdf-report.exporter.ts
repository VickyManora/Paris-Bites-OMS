import PDFDocument from 'pdfkit';
import type {
  IReportExporter,
  ReportExportRequest,
  ReportFile,
} from '../../core/application/ports/report-exporter.port.js';
import { ReportColumnType, ReportFormat } from '../../core/domain/enums/report.enum.js';
import type { ReportColumn, ReportRow } from '../../core/domain/repositories/report.repository.js';
import { drawPageNumbers, pdfMoney } from './pdf-support.js';

const BRAND = '#7A0C3E';
const MUTED = '#666666';
const RULE = '#DDDDDD';
const DANGER = '#B3261E';

const PAGE_MARGIN = 36;
const ROW_HEIGHT = 18;
const HEADER_HEIGHT = 22;

/**
 * Renders a report as a printable PDF.
 *
 * Landscape A4 throughout: these tables are seven to nine columns wide, and portrait would
 * either clip them or shrink the type past reading size.
 *
 * `pdfkit` rather than a headless browser. Printing HTML would give richer layout, but at
 * the cost of shipping Chromium to a container that otherwise needs 200 MB less — and the
 * output here is a table, which is the one thing a drawing API is genuinely good at.
 */
export class PdfReportExporter implements IReportExporter {
  readonly format = ReportFormat.PDF;

  async export(request: ReportExportRequest): Promise<ReportFile> {
    // `bufferPages` is required for `bufferedPageRange`/`switchToPage`: without it pages are
    // flushed as they are written and the footer cannot know the total.
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: PAGE_MARGIN,
      bufferPages: true,
    });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const finished = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const usableWidth = doc.page.width - PAGE_MARGIN * 2;
    const widths = this.columnWidths(request.columns, usableWidth);

    this.drawTitleBlock(doc, request, usableWidth);
    this.drawTable(doc, request, widths, usableWidth);
    drawPageNumbers(doc, PAGE_MARGIN);

    doc.flushPages();
    doc.end();

    return {
      filename: this.filename(request),
      mimeType: 'application/pdf',
      bytes: await finished,
    };
  }

  /**
   * Proportional widths from the declared character widths.
   *
   * Scaled to fill the page rather than used literally, so the same definition lays out
   * sensibly whether a report has five columns or nine.
   */
  private columnWidths(columns: readonly ReportColumn[], usableWidth: number): number[] {
    const weights = columns.map((column) => column.width ?? 18);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

    return weights.map((weight) => (weight / totalWeight) * usableWidth);
  }

  private drawTitleBlock(
    doc: PDFKit.PDFDocument,
    request: ReportExportRequest,
    usableWidth: number,
  ): void {
    doc.fillColor(BRAND).fontSize(18).font('Helvetica-Bold').text(request.title);
    doc.moveDown(0.2);
    doc.fillColor(MUTED).fontSize(9).font('Helvetica').text(request.description);

    doc.moveDown(0.3);
    doc
      .fontSize(8)
      .text(
        `Generated ${request.generatedAt.toISOString().replace('T', ' ').slice(0, 16)} by ${request.generatedBy}`,
      );

    // The filters go on the file itself: a PDF outlives the screen it came from, and one
    // that does not say which period it covers gets read as though it covered everything.
    doc.text(
      request.appliedFilters.length === 0
        ? 'Filters: none — all records'
        : `Filters: ${request.appliedFilters.join(' · ')}`,
      { width: usableWidth },
    );

    if (request.truncatedAt !== undefined) {
      doc
        .fillColor(DANGER)
        .font('Helvetica-Bold')
        .text(
          `Truncated to the first ${String(request.truncatedAt)} rows — narrow the filters for a complete export.`,
        );
      doc.font('Helvetica');
    }

    doc.moveDown(0.6);
  }

  private drawTable(
    doc: PDFKit.PDFDocument,
    request: ReportExportRequest,
    widths: readonly number[],
    usableWidth: number,
  ): void {
    const drawHeader = (): void => {
      const y = doc.y;

      doc.rect(PAGE_MARGIN, y, usableWidth, HEADER_HEIGHT).fill(BRAND);
      doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');

      let x = PAGE_MARGIN;

      request.columns.forEach((column, index) => {
        const width = widths[index] ?? 60;
        doc.text(column.header, x + 4, y + 7, {
          width: width - 8,
          align: this.align(column),
          lineBreak: false,
        });
        x += width;
      });

      doc.y = y + HEADER_HEIGHT;
      doc.font('Helvetica').fillColor('#000000');
    };

    drawHeader();

    for (const [index, row] of request.rows.entries()) {
      // A new page needs the header repeated, or every page after the first is a grid of
      // unlabelled numbers.
      if (doc.y + ROW_HEIGHT > doc.page.height - PAGE_MARGIN - 20) {
        doc.addPage();
        drawHeader();
      }

      const y = doc.y;

      // Banding, because a nine-column row is hard to track across a landscape page.
      if (index % 2 === 1) {
        doc.rect(PAGE_MARGIN, y, usableWidth, ROW_HEIGHT).fill('#F7F2F4');
      }

      doc.fillColor('#000000').fontSize(8);

      let x = PAGE_MARGIN;

      request.columns.forEach((column, columnIndex) => {
        const width = widths[columnIndex] ?? 60;

        doc.text(this.formatCell(row[column.key], column.type), x + 4, y + 5, {
          width: width - 8,
          align: this.align(column),
          // Clipped rather than wrapped: a wrapped cell would desynchronise this row's
          // height from the banding rectangle already drawn behind it.
          lineBreak: false,
          ellipsis: true,
        });

        x += width;
      });

      doc.y = y + ROW_HEIGHT;
      doc.strokeColor(RULE).lineWidth(0.5)
        .moveTo(PAGE_MARGIN, doc.y).lineTo(PAGE_MARGIN + usableWidth, doc.y).stroke();
    }

    this.drawTotals(doc, request, widths, usableWidth);
  }

  private drawTotals(
    doc: PDFKit.PDFDocument,
    request: ReportExportRequest,
    widths: readonly number[],
    usableWidth: number,
  ): void {
    const hasTotals = request.columns.some((column) => column.total === true);

    if (!hasTotals || request.rows.length === 0) {
      return;
    }

    if (doc.y + ROW_HEIGHT > doc.page.height - PAGE_MARGIN - 20) {
      doc.addPage();
    }

    const y = doc.y;

    doc.rect(PAGE_MARGIN, y, usableWidth, ROW_HEIGHT).fill('#EFE3E8');
    doc.fillColor(BRAND).fontSize(8).font('Helvetica-Bold');

    let x = PAGE_MARGIN;

    request.columns.forEach((column, index) => {
      const width = widths[index] ?? 60;
      const text =
        index === 0
          ? 'Total'
          : column.total === true
            ? this.formatCell(request.totals[column.key] ?? 0, column.type)
            : '';

      doc.text(text, x + 4, y + 5, { width: width - 8, align: this.align(column), lineBreak: false });
      x += width;
    });

    doc.y = y + ROW_HEIGHT;
    doc.font('Helvetica').fillColor('#000000');
  }

  private align(column: ReportColumn): 'left' | 'right' {
    return column.type === ReportColumnType.MONEY || column.type === ReportColumnType.NUMBER
      ? 'right'
      : 'left';
  }

  private formatCell(value: ReportRow[string] | undefined, type: ReportColumnType): string {
    if (value === null || value === undefined || value === '') {
      return '—';
    }

    if (type === ReportColumnType.MONEY) {
      // `Rs.`, not `₹` — the built-in PDF fonts have no glyph for the rupee sign. See
      // `pdf-support.ts`.
      return pdfMoney(Number(value));
    }

    if (type === ReportColumnType.NUMBER) {
      return Number(value).toLocaleString('en-IN', { maximumFractionDigits: 3 });
    }

    return String(value);
  }

  private filename(request: ReportExportRequest): string {
    const slug = request.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `${slug}-${request.generatedAt.toISOString().slice(0, 10)}.pdf`;
  }
}
