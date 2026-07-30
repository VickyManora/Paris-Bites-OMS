import ExcelJS from 'exceljs';
import type { IAnalyticsExporter } from '../../core/application/ports/analytics-exporter.port.js';
import type { ReportFile } from '../../core/application/ports/report-exporter.port.js';
import type { AnalyticsDto } from '../../core/application/dtos/analytics.dto.js';
import { ReportFormat } from '../../core/domain/enums/report.enum.js';

const MONEY_FORMAT = '₹#,##,##0.00';
const NUMBER_FORMAT = '#,##,##0.###';
const PERCENT_FORMAT = '0.0"%"';
const BRAND = 'FF7A0C3E';

/**
 * Analytics as a workbook.
 *
 * **One sheet per dataset**, not one sheet with six tables stacked down it. Stacked tables
 * are why exported dashboards get opened once and never used: nothing can be sorted or
 * filtered without dragging a selection around a block, and a pivot over any of it is
 * impossible.
 *
 * Numbers stay numbers with a currency *format*, for the same reason as the report
 * exporter — the point of a spreadsheet is to do your own arithmetic on it.
 */
export class ExcelAnalyticsExporter implements IAnalyticsExporter {
  readonly format = ReportFormat.XLSX;

  async export(snapshot: AnalyticsDto, generatedBy: string): Promise<ReportFile> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Paris Bites';
    workbook.created = new Date(snapshot.generatedAt);

    this.writeSummary(workbook, snapshot, generatedBy);
    this.writeTrend(workbook, snapshot);
    this.writeChannels(workbook, snapshot);
    this.writeIngredients(workbook, snapshot);

    return {
      filename: `analytics-${snapshot.from}-to-${snapshot.to}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes: Buffer.from(await workbook.xlsx.writeBuffer()),
    };
  }

  /** Headline figures, each with the caveat that belongs to it in its own column. */
  private writeSummary(
    workbook: ExcelJS.Workbook,
    snapshot: AnalyticsDto,
    generatedBy: string,
  ): void {
    const sheet = workbook.addWorksheet('Summary');

    sheet.addRow(['Paris Bites — analytics']).font = { bold: true, size: 16 };
    sheet.addRow([`${snapshot.from} to ${snapshot.to}, by ${snapshot.granularity}`]).font = {
      italic: true,
      color: { argb: 'FF666666' },
    };
    sheet.addRow([
      `Generated ${snapshot.generatedAt.replace('T', ' ').slice(0, 16)} by ${generatedBy}`,
    ]).font = { size: 9, color: { argb: 'FF666666' } };
    sheet.addRow([]);

    const header = sheet.addRow(['Measure', 'Value', 'Notes']);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    });

    const revenue = snapshot.revenue;
    const foodCost = snapshot.foodCost;

    const rows: [string, number | string | null, string][] = [
      [
        'Revenue',
        revenue.total,
        `${String(revenue.daysRecorded)} of ${String(revenue.daysInRange)} days in the range have takings entered`,
      ],
      ['Revenue — cash', revenue.cash, ''],
      ['Revenue — online', revenue.online, ''],
      [
        'Average per recorded day',
        revenue.averagePerRecordedDay,
        'Per day entered, not per calendar day in the range',
      ],
      [
        'Inventory value',
        snapshot.inventoryValue.total,
        `Stock on hand as of ${snapshot.generatedAt.slice(0, 10)} — NOT a value for the range. ${String(snapshot.inventoryValue.unpricedItems)} item(s) have no price and contribute nothing`,
      ],
      ['Cost of stock consumed', foodCost.consumptionCost, ''],
      [
        'Food cost %',
        foodCost.percent,
        foodCost.percent === null
          ? 'No revenue in the range, so there is no ratio to state'
          : foodCost.isComplete
            ? 'Every consumed line had a price'
            : `UNDERSTATED: ${String(foodCost.linesUnpriced)} consumed line(s) had no price, so the cost side is incomplete`,
      ],
      ['Purchases', snapshot.purchases.total, `${String(snapshot.purchases.invoices)} invoice(s)`],
      [
        'Transfers',
        snapshot.transfers.total,
        `${String(snapshot.transfers.completed)} completed`,
      ],
    ];

    for (const [measure, value, note] of rows) {
      const row = sheet.addRow([measure, value, note]);
      const cell = row.getCell(2);

      if (measure === 'Food cost %') {
        cell.numFmt = PERCENT_FORMAT;
      } else if (measure === 'Transfers' || measure === 'Purchases') {
        cell.numFmt = measure === 'Transfers' ? NUMBER_FORMAT : MONEY_FORMAT;
      } else {
        cell.numFmt = MONEY_FORMAT;
      }
    }

    /*
     * The limitations go in the file, not only on the screen.
     *
     * An analytics export with no "top selling product" anywhere in it reads as an
     * oversight; one that says why reads as a known boundary.
     */
    if (snapshot.unavailable.length > 0) {
      sheet.addRow([]);
      sheet.addRow(['Not available']).font = { bold: true };

      for (const item of snapshot.unavailable) {
        sheet.addRow([item.metric, '', item.reason]).font = { color: { argb: 'FFB3261E' } };
      }
    }

    sheet.getColumn(1).width = 28;
    sheet.getColumn(2).width = 18;
    sheet.getColumn(3).width = 90;
  }

  private writeTrend(workbook: ExcelJS.Workbook, snapshot: AnalyticsDto): void {
    const sheet = workbook.addWorksheet('Trend');

    this.header(sheet, [
      'Period',
      'Revenue',
      'Cost of stock used',
      'Purchases',
      'Transfers',
      'Sales days recorded',
      'Days in period',
      'Complete?',
    ]);

    for (const point of snapshot.trend) {
      const row = sheet.addRow([
        point.label,
        point.revenue,
        point.consumptionCost,
        point.purchases,
        point.transfers,
        point.salesDaysRecorded,
        point.salesDaysInPeriod,
        // Spelled out per row: a spreadsheet gets sorted and filtered, at which point a
        // partial month sitting next to complete ones is indistinguishable without it.
        point.salesDaysRecorded === 0
          ? 'no entries'
          : point.isPartial
            ? 'partial'
            : 'complete',
      ]);

      for (const index of [2, 3, 4]) {
        row.getCell(index).numFmt = MONEY_FORMAT;
      }
    }

    sheet.getColumn(1).width = 16;
    for (const index of [2, 3, 4, 5, 6, 7, 8]) {
      sheet.getColumn(index).width = 20;
    }

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: snapshot.trend.length + 1, column: 8 },
    };
  }

  private writeChannels(workbook: ExcelJS.Workbook, snapshot: AnalyticsDto): void {
    const sheet = workbook.addWorksheet('Revenue by channel');
    this.header(sheet, ['Channel', 'Revenue', 'Share']);

    const total = snapshot.revenue.total;

    for (const channel of snapshot.revenue.byChannel) {
      const row = sheet.addRow([
        channel.label,
        channel.value,
        total <= 0 ? null : Math.round((channel.value / total) * 1000) / 10,
      ]);
      row.getCell(2).numFmt = MONEY_FORMAT;
      row.getCell(3).numFmt = PERCENT_FORMAT;
    }

    sheet.getColumn(1).width = 20;
    sheet.getColumn(2).width = 18;
    sheet.getColumn(3).width = 12;
  }

  private writeIngredients(workbook: ExcelJS.Workbook, snapshot: AnalyticsDto): void {
    const sheet = workbook.addWorksheet('Most used ingredients');
    this.header(sheet, ['Ingredient', 'Quantity', 'Unit', 'Times used', 'Cost']);

    for (const ingredient of snapshot.topIngredients) {
      const row = sheet.addRow([
        ingredient.itemName,
        ingredient.quantity,
        ingredient.unitAbbreviation,
        ingredient.timesUsed,
        // Null, not zero: "we have not priced this" is not "it was free", and a zero here
        // would quietly drag any average the reader computes downwards.
        ingredient.cost,
      ]);
      row.getCell(2).numFmt = NUMBER_FORMAT;
      row.getCell(5).numFmt = MONEY_FORMAT;
    }

    sheet.getColumn(1).width = 30;
    for (const index of [2, 3, 4, 5]) {
      sheet.getColumn(index).width = 14;
    }
  }

  private header(sheet: ExcelJS.Worksheet, labels: readonly string[]): void {
    const row = sheet.addRow([...labels]);
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
}
