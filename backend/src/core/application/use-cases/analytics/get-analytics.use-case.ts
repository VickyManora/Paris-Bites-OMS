import {
  INVENTORY_UNIT_ABBREVIATIONS,
  isInventoryUnit,
} from '../../../domain/enums/inventory.enum.js';
import { SALES_CHANNEL_LABELS } from '../../../domain/enums/sales.enum.js';
import { BusinessRuleError } from '../../../domain/errors/domain-error.js';
import {
  AnalyticsGranularity,
  type IAnalyticsRepository,
} from '../../../domain/repositories/analytics.repository.js';
import type {
  AnalyticsDto,
  AnalyticsTrendPointDto,
  GetAnalyticsInput,
  IngredientUsageDto,
} from '../../dtos/analytics.dto.js';
import type { IUseCase } from '../../ports/use-case.port.js';

/**
 * Longest range accepted.
 *
 * Three years at daily grain is a thousand buckets, which no chart renders usefully and
 * which turns the trend query into a scan of every table it touches. A cap that says so
 * beats a page that quietly takes twenty seconds.
 */
const MAX_RANGE_DAYS = 1_096;

/**
 * What the app cannot answer, and why.
 *
 * Carried in the payload rather than written into the page, so the explanation reaches
 * the export too — a missing chart in a PDF looks like a bug, whereas a stated limitation
 * is information.
 */
const UNAVAILABLE: readonly { readonly metric: string; readonly reason: string }[] = [
  /*
   * "Top selling product" used to live here, with the reason that a rupee figure per channel
   * has no product in it. The POS changed that — order lines carry products — so it is now a
   * real metric and the entry is gone.
   *
   * What remains true, and is stated on the page instead: the ranking covers **counter trade
   * only**, because aggregator orders are still declared as a daily total with no items.
   */
];

function abbreviation(unit: string): string {
  return isInventoryUnit(unit) ? INVENTORY_UNIT_ABBREVIATIONS[unit] : unit.toLowerCase();
}

/** `27 Jul` / `W31 · 27 Jul` / `Jul 2026`, depending on the grain. */
function periodLabel(period: string, granularity: AnalyticsGranularity): string {
  const date = new Date(`${period}T00:00:00.000Z`);
  const day = date.getUTCDate();
  const month = date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  const year = date.getUTCFullYear();

  if (granularity === AnalyticsGranularity.MONTH) {
    return `${month} ${String(year)}`;
  }
  if (granularity === AnalyticsGranularity.WEEK) {
    // The week's starting date, which is what someone cross-references against a diary —
    // an ISO week number alone ("W31") is not something anyone can place.
    return `w/c ${String(day)} ${month}`;
  }

  return `${String(day)} ${month}`;
}

/**
 * The analytics snapshot.
 *
 * Presentation-only work: the repository does the arithmetic in one transaction, and this
 * adds labels, unit abbreviations and the two honesty flags the UI needs. Nothing here
 * recomputes a figure — a second implementation of "food cost" living in the application
 * layer is exactly how two screens end up disagreeing.
 */
export class GetAnalyticsUseCase implements IUseCase<GetAnalyticsInput, AnalyticsDto> {
  constructor(private readonly analytics: IAnalyticsRepository) {}

  async execute(input: GetAnalyticsInput): Promise<AnalyticsDto> {
    if (input.from.getTime() > input.to.getTime()) {
      throw new BusinessRuleError('The start date is after the end date.', {
        from: ['Pick a start date on or before the end date.'],
      });
    }

    const days =
      Math.floor((input.to.getTime() - input.from.getTime()) / 86_400_000) + 1;

    if (days > MAX_RANGE_DAYS) {
      throw new BusinessRuleError('That range is too long to chart.', {
        from: [`Pick a range of ${String(MAX_RANGE_DAYS)} days or fewer.`],
      });
    }

    const snapshot = await this.analytics.snapshot({
      from: input.from,
      to: input.to,
      granularity: input.granularity,
    });

    const trend: AnalyticsTrendPointDto[] = snapshot.trend.map((point) => ({
      period: point.period,
      label: periodLabel(point.period, input.granularity),
      revenue: point.revenue,
      consumptionCost: point.consumptionCost,
      purchases: point.purchases,
      transfers: point.transfers,
      // Partial only when *some* of the bucket is entered. A bucket with nothing entered
      // is not a partial month, it is a gap, and the chart shows it as a zero-height bar
      // that the caption below accounts for.
      isPartial:
        point.salesDaysRecorded > 0 && point.salesDaysRecorded < point.salesDaysInPeriod,
      salesDaysRecorded: point.salesDaysRecorded,
      salesDaysInPeriod: point.salesDaysInPeriod,
    }));

    const topIngredients: IngredientUsageDto[] = snapshot.topIngredients.map((row) => ({
      itemId: row.itemId,
      itemName: row.itemName,
      unit: row.unit,
      unitAbbreviation: abbreviation(row.unit),
      quantity: row.quantity,
      displayQuantity: `${String(row.quantity)} ${abbreviation(row.unit)}`,
      timesUsed: row.timesUsed,
      cost: row.cost,
    }));

    return {
      from: input.from.toISOString().slice(0, 10),
      to: input.to.toISOString().slice(0, 10),
      granularity: input.granularity,
      generatedAt: new Date().toISOString(),

      revenue: {
        ...snapshot.revenue,
        byChannel: snapshot.revenue.byChannel.map((row) => ({
          channel: row.channel,
          label: SALES_CHANNEL_LABELS[row.channel],
          value: row.value,
        })),
      },

      inventoryValue: { ...snapshot.inventoryValue, asOf: 'now' },

      foodCost: {
        ...snapshot.foodCost,
        isComplete: snapshot.foodCost.linesUnpriced === 0,
      },

      topIngredients,

      topProducts: snapshot.topProducts.map((product) => ({
        ...product,
        // Share of POS revenue, which is the only denominator these rows all belong to.
        sharePercent:
          snapshot.posRevenue.total <= 0
            ? null
            : Math.round((product.revenue / snapshot.posRevenue.total) * 1000) / 10,
      })),

      posRevenue: {
        ...snapshot.posRevenue,
        /*
         * How much of the declared revenue went through the till.
         *
         * Null when nothing was declared — a coverage figure against no declaration is not
         * zero percent, it is unknown. Can legitimately exceed 100% if the counter recorded
         * more than was declared, which is exactly the discrepancy worth seeing.
         */
        coversDeclaredPercent:
          snapshot.revenue.total <= 0
            ? null
            : Math.round((snapshot.posRevenue.total / snapshot.revenue.total) * 1000) / 10,
      },

      purchases: snapshot.purchases,
      transfers: snapshot.transfers,
      trend,
      unavailable: UNAVAILABLE,
    };
  }
}
