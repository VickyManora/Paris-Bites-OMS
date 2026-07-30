import PDFDocument from 'pdfkit';
import type { IAnalyticsExporter } from '../../core/application/ports/analytics-exporter.port.js';
import type { ReportFile } from '../../core/application/ports/report-exporter.port.js';
import type { AnalyticsDto } from '../../core/application/dtos/analytics.dto.js';
import { ReportFormat } from '../../core/domain/enums/report.enum.js';
import { drawPageNumbers, pdfMoney } from './pdf-support.js';

const BRAND = '#7A0C3E';
const MUTED = '#666666';
const RULE = '#DDDDDD';
const DANGER = '#B3261E';

const PAGE_MARGIN = 40;
const ROW_HEIGHT = 17;
const HEADER_HEIGHT = 20;

/** `Rs.`, not `₹` — the built-in PDF fonts have no rupee glyph. See `pdf-support.ts`. */
const money = pdfMoney;

/**
 * Analytics as a printable summary.
 *
 * **Portrait**, unlike the report PDFs. Those are wide tables that need landscape; this is
 * a narrow stack of figures and short tables, and portrait is what a summary gets printed
 * and filed as.
 *
 * The caveats are printed next to the figures they qualify rather than collected in a
 * footnote. A food cost percentage separated from "the cost side is incomplete" is worse
 * than no percentage at all, and on paper there is no tooltip to recover it from.
 */
export class PdfAnalyticsExporter implements IAnalyticsExporter {
  readonly format = ReportFormat.PDF;

  async export(snapshot: AnalyticsDto, generatedBy: string): Promise<ReportFile> {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN, bufferPages: true });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const width = doc.page.width - PAGE_MARGIN * 2;

    this.drawTitle(doc, snapshot, generatedBy, width);
    this.drawHeadlines(doc, snapshot, width);
    this.drawTrend(doc, snapshot, width);
    this.drawChannels(doc, snapshot, width);
    this.drawIngredients(doc, snapshot, width);
    this.drawUnavailable(doc, snapshot, width);
    drawPageNumbers(doc, PAGE_MARGIN);

    doc.flushPages();
    doc.end();

    return {
      filename: `analytics-${snapshot.from}-to-${snapshot.to}.pdf`,
      mimeType: 'application/pdf',
      bytes: await finished,
    };
  }

  private drawTitle(
    doc: PDFKit.PDFDocument,
    snapshot: AnalyticsDto,
    generatedBy: string,
    width: number,
  ): void {
    doc.fillColor(BRAND).fontSize(20).font('Helvetica-Bold').text('Analytics');
    doc.moveDown(0.2);
    doc
      .fillColor(MUTED)
      .fontSize(10)
      .font('Helvetica')
      .text(`${snapshot.from} to ${snapshot.to} · by ${snapshot.granularity}`, { width });
    doc
      .fontSize(8)
      .text(
        `Generated ${snapshot.generatedAt.replace('T', ' ').slice(0, 16)} by ${generatedBy}`,
        { width },
      );
    doc.moveDown(0.8);
  }

  /** The headline figures, each followed by the caveat that qualifies it. */
  private drawHeadlines(doc: PDFKit.PDFDocument, snapshot: AnalyticsDto, width: number): void {
    const revenue = snapshot.revenue;
    const foodCost = snapshot.foodCost;

    const entries: { label: string; value: string; note: string; warn?: boolean }[] = [
      {
        label: 'Revenue',
        value: money(revenue.total),
        note: `${String(revenue.daysRecorded)} of ${String(revenue.daysInRange)} days entered · ${money(revenue.cash)} cash, ${money(revenue.online)} online`,
        warn: revenue.daysRecorded < revenue.daysInRange,
      },
      {
        label: 'Average per recorded day',
        value: money(revenue.averagePerRecordedDay),
        note: 'Per day entered, not per calendar day in the range',
      },
      {
        label: 'Inventory value',
        value: money(snapshot.inventoryValue.total),
        note: `Stock on hand today — not a value for the range. ${String(snapshot.inventoryValue.unpricedItems)} item(s) unpriced`,
        warn: snapshot.inventoryValue.unpricedItems > 0,
      },
      {
        label: 'Cost of stock used',
        value: money(foodCost.consumptionCost),
        note: 'Consumption entries valued at each item’s purchase price',
      },
      {
        label: 'Food cost',
        value: foodCost.percent === null ? '—' : `${String(foodCost.percent)}%`,
        note:
          foodCost.percent === null
            ? 'No revenue in this range, so there is no ratio to state'
            : foodCost.isComplete
              ? 'Every consumed line had a price'
              : `Understated — ${String(foodCost.linesUnpriced)} consumed line(s) had no price`,
        warn: foodCost.percent !== null && !foodCost.isComplete,
      },
      {
        label: 'Purchases',
        value: money(snapshot.purchases.total),
        note: `${String(snapshot.purchases.invoices)} invoice(s)`,
      },
      {
        label: 'Transfers',
        value: String(snapshot.transfers.total),
        note: `${String(snapshot.transfers.completed)} completed`,
      },
    ];

    for (const entry of entries) {
      const y = doc.y;

      doc.fillColor('#000000').fontSize(9).font('Helvetica').text(entry.label, PAGE_MARGIN, y, {
        width: width * 0.34,
      });
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .text(entry.value, PAGE_MARGIN + width * 0.34, y, { width: width * 0.2 });
      doc
        .fillColor(entry.warn === true ? DANGER : MUTED)
        .fontSize(8)
        .font('Helvetica')
        .text(entry.note, PAGE_MARGIN + width * 0.54, y + 2, { width: width * 0.46 });

      doc.y = Math.max(doc.y, y + 18);
      doc.strokeColor(RULE).lineWidth(0.5)
        .moveTo(PAGE_MARGIN, doc.y).lineTo(PAGE_MARGIN + width, doc.y).stroke();
      doc.y += 4;
    }

    doc.moveDown(0.8);
  }

  private drawTrend(doc: PDFKit.PDFDocument, snapshot: AnalyticsDto, width: number): void {
    this.section(doc, 'Trend', width);

    const columns = [
      { header: 'Period', weight: 1.4, align: 'left' as const },
      { header: 'Revenue', weight: 1.2, align: 'right' as const },
      { header: 'Stock used', weight: 1.2, align: 'right' as const },
      { header: 'Purchases', weight: 1.2, align: 'right' as const },
      { header: 'Transfers', weight: 0.9, align: 'right' as const },
      { header: 'Coverage', weight: 1.2, align: 'left' as const },
    ];

    this.table(
      doc,
      columns,
      snapshot.trend.map((point) => [
        point.label,
        money(point.revenue),
        money(point.consumptionCost),
        money(point.purchases),
        String(point.transfers),
        point.salesDaysRecorded === 0
          ? 'no entries'
          : point.isPartial
            ? `${String(point.salesDaysRecorded)}/${String(point.salesDaysInPeriod)} days`
            : 'complete',
      ]),
      width,
    );
  }

  private drawChannels(doc: PDFKit.PDFDocument, snapshot: AnalyticsDto, width: number): void {
    if (snapshot.revenue.byChannel.length === 0) {
      return;
    }

    this.section(doc, 'Revenue by channel', width);

    const total = snapshot.revenue.total;

    this.table(
      doc,
      [
        { header: 'Channel', weight: 2, align: 'left' as const },
        { header: 'Revenue', weight: 1.2, align: 'right' as const },
        { header: 'Share', weight: 1, align: 'right' as const },
      ],
      snapshot.revenue.byChannel.map((channel) => [
        channel.label,
        money(channel.value),
        total <= 0 ? '—' : `${String(Math.round((channel.value / total) * 1000) / 10)}%`,
      ]),
      width,
    );
  }

  private drawIngredients(doc: PDFKit.PDFDocument, snapshot: AnalyticsDto, width: number): void {
    if (snapshot.topIngredients.length === 0) {
      return;
    }

    this.section(doc, 'Most used ingredients', width);

    this.table(
      doc,
      [
        { header: 'Ingredient', weight: 2.4, align: 'left' as const },
        { header: 'Quantity', weight: 1.2, align: 'right' as const },
        { header: 'Times used', weight: 1, align: 'right' as const },
        { header: 'Cost', weight: 1.2, align: 'right' as const },
      ],
      snapshot.topIngredients.map((ingredient) => [
        ingredient.itemName,
        ingredient.displayQuantity,
        String(ingredient.timesUsed),
        // An em dash rather than ₹0.00 — unpriced is not free.
        ingredient.cost === null ? 'unpriced' : money(ingredient.cost),
      ]),
      width,
    );
  }

  private drawUnavailable(doc: PDFKit.PDFDocument, snapshot: AnalyticsDto, width: number): void {
    if (snapshot.unavailable.length === 0) {
      return;
    }

    this.section(doc, 'Not available', width);

    for (const item of snapshot.unavailable) {
      doc.fillColor(DANGER).fontSize(9).font('Helvetica-Bold').text(item.metric, { width });
      doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(item.reason, { width });
      doc.moveDown(0.4);
    }
  }

  private section(doc: PDFKit.PDFDocument, title: string, width: number): void {
    if (doc.y > doc.page.height - PAGE_MARGIN - 120) {
      doc.addPage();
    }

    doc.moveDown(0.4);
    doc.fillColor(BRAND).fontSize(12).font('Helvetica-Bold').text(title, { width });
    doc.moveDown(0.3);
  }

  private table(
    doc: PDFKit.PDFDocument,
    columns: readonly { header: string; weight: number; align: 'left' | 'right' }[],
    rows: readonly (readonly string[])[],
    usableWidth: number,
  ): void {
    const totalWeight = columns.reduce((sum, column) => sum + column.weight, 0);
    const widths = columns.map((column) => (column.weight / totalWeight) * usableWidth);

    const drawHeader = (): void => {
      const y = doc.y;
      doc.rect(PAGE_MARGIN, y, usableWidth, HEADER_HEIGHT).fill(BRAND);
      doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');

      let x = PAGE_MARGIN;
      columns.forEach((column, index) => {
        const width = widths[index] ?? 60;
        doc.text(column.header, x + 4, y + 6, {
          width: width - 8,
          align: column.align,
          lineBreak: false,
        });
        x += width;
      });

      doc.y = y + HEADER_HEIGHT;
      doc.font('Helvetica').fillColor('#000000');
    };

    drawHeader();

    for (const [index, row] of rows.entries()) {
      if (doc.y + ROW_HEIGHT > doc.page.height - PAGE_MARGIN - 20) {
        doc.addPage();
        drawHeader();
      }

      const y = doc.y;

      if (index % 2 === 1) {
        doc.rect(PAGE_MARGIN, y, usableWidth, ROW_HEIGHT).fill('#F7F2F4');
      }

      doc.fillColor('#000000').fontSize(8);

      let x = PAGE_MARGIN;
      columns.forEach((column, columnIndex) => {
        const width = widths[columnIndex] ?? 60;
        doc.text(row[columnIndex] ?? '', x + 4, y + 5, {
          width: width - 8,
          align: column.align,
          lineBreak: false,
          ellipsis: true,
        });
        x += width;
      });

      doc.y = y + ROW_HEIGHT;
    }

    doc.moveDown(0.5);
  }

}
