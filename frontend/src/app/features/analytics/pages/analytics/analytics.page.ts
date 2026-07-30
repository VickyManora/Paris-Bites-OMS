import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from '@angular/core';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import type { AppError } from '../../../../core/errors/app-error';
import { NotificationService } from '../../../../core/services/notification.service';
import { CardComponent } from '../../../../shared/components/card/card.component';
import {
  ChartComponent,
  type ChartSpec,
} from '../../../../shared/components/chart/chart.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import { StatCardComponent } from '../../../../shared/components/stat-card/stat-card.component';
import {
  MATERIAL_CORE_IMPORTS,
  MATERIAL_FORM_IMPORTS,
} from '../../../../shared/material/material-imports';
import type { ReportFormat } from '../../../reports/models/report.model';
import {
  AnalyticsGranularity,
  RANGE_PRESETS,
  toDateInput,
  type Analytics,
} from '../../models/analytics.model';
import { AnalyticsService } from '../../services/analytics.service';
import { money, moneyCompact, timestamp } from '../../../../shared/utils/format.utils';

/**
 * Analytics.
 *
 * Every figure on the page comes from **one** request over **one** range, so nothing here
 * can disagree with anything else. That is also why the range and grain are explicit
 * rather than defaulted server-side: an analytics number quoted without its period is the
 * easiest thing in the app to misread.
 *
 * The page's recurring theme is refusing to state more than the data supports:
 *
 * - Revenue says how many days of the range were actually entered.
 * - Food cost is marked understated when any consumed ingredient had no price.
 * - Inventory value is labelled as *today's* stock, because there is no history to value.
 * - A partially-entered month is flagged on the chart rather than drawn as a full one.
 * - The metric that cannot be produced at all is named, with the reason.
 */
@Component({
  selector: 'pb-analytics-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    CardComponent,
    ChartComponent,
    EmptyStateComponent,
    SpinnerComponent,
    StatCardComponent,
    MatButtonToggleModule,
    ...MATERIAL_CORE_IMPORTS,
    ...MATERIAL_FORM_IMPORTS,
  ],
  template: `
    <pb-page-header title="Analytics" [subtitle]="subtitle()">
      <div slot="actions" class="flex gap-2">
        <button
          matButton="outlined"
          type="button"
          [disabled]="exporting() !== null || data() === null"
          (click)="download('xlsx')"
        >
          <mat-icon>table_view</mat-icon>
          {{ exporting() === 'xlsx' ? 'Preparing…' : 'Excel' }}
        </button>
        <button
          matButton="filled"
          type="button"
          [disabled]="exporting() !== null || data() === null"
          (click)="download('pdf')"
        >
          <mat-icon>picture_as_pdf</mat-icon>
          {{ exporting() === 'pdf' ? 'Preparing…' : 'PDF' }}
        </button>
      </div>
    </pb-page-header>

    <pb-card padding="none" class="mb-4">
      <div class="flex flex-col gap-3 p-4">
        <div class="overflow-x-auto pb-1">
          <mat-button-toggle-group
            class="w-max"
            [value]="preset()"
            (change)="applyPreset($any($event).value)"
            aria-label="Period"
          >
            @for (option of presets; track option.key) {
              <mat-button-toggle [value]="option.key">{{ option.label }}</mat-button-toggle>
            }
            <mat-button-toggle value="custom">Custom</mat-button-toggle>
          </mat-button-toggle-group>
        </div>

        <div class="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <mat-form-field>
            <mat-label>From</mat-label>
            <input
              matInput
              type="date"
              [value]="from()"
              [max]="today"
              (change)="onFrom($any($event.target).value)"
            />
          </mat-form-field>

          <mat-form-field>
            <mat-label>To</mat-label>
            <input
              matInput
              type="date"
              [value]="to()"
              [max]="today"
              (change)="onTo($any($event.target).value)"
            />
          </mat-form-field>

          <mat-form-field>
            <mat-label>Group by</mat-label>
            <mat-select [value]="granularity()" (selectionChange)="onGranularity($event.value)">
              <mat-option value="day">Day</mat-option>
              <mat-option value="week">Week</mat-option>
              <mat-option value="month">Month</mat-option>
            </mat-select>
          </mat-form-field>
        </div>

        @if (error() !== null) {
          <p class="text-pb-caption m-0 text-error">{{ error() }}</p>
        }
      </div>
    </pb-card>

    @if (loading() && data() === null) {
      <div class="flex justify-center py-16">
        <pb-spinner size="lg" label="Crunching the numbers…" />
      </div>
    } @else if (data(); as analytics) {
      <div class="relative">
        @if (loading()) {
          <pb-spinner [overlay]="true" label="Updating…" />
        }

        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <pb-stat-card
            label="Revenue"
            [value]="fmt(analytics.revenue.total)"
            [caption]="revenueCaption()"
            icon="payments"
          />
          <pb-stat-card
            label="Food cost"
            [value]="foodCostValue()"
            [caption]="foodCostCaption()"
            icon="restaurant"
            positiveWhen="down"
          />
          <pb-stat-card
            label="Inventory value"
            [value]="fmt(analytics.inventoryValue.total)"
            [caption]="inventoryCaption()"
            icon="savings"
          />
          <pb-stat-card
            label="Purchases"
            [value]="fmt(analytics.purchases.total)"
            [caption]="
              analytics.purchases.invoices +
              ' invoice' +
              (analytics.purchases.invoices === 1 ? '' : 's')
            "
            icon="receipt_long"
          />
        </div>

        <!--
          Counter takings, on their own row and captioned as a *share of* declared revenue
          rather than an addition to it. The two describe the same walk-in trade from two
          sources; adding them would double-count every order.
        -->
        <div class="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <pb-stat-card
            label="Through the till"
            [value]="fmt(analytics.posRevenue.total)"
            [caption]="posCoverageCaption()"
            icon="point_of_sale"
          />
          <pb-stat-card
            label="Counter orders"
            [value]="analytics.posRevenue.orders"
            [caption]="posOrdersCaption()"
            icon="receipt"
          />
        </div>

        <!--
          The food-cost caveat gets a banner, not a caption.
          A percentage computed from partly-unpriced consumption is *flattering*, not merely
          imprecise — it reads as a healthy margin when the truth is unknown. That is worth
          more than four words under a tile.
        -->
        @if (analytics.foodCost.percent !== null && !analytics.foodCost.isComplete) {
          <!-- Amber, not red: the figure is unreliable rather than wrong, and 'border-error' on a
               rose palette drew a pink rule that read as an accent on the tile above it. -->
          <div
            class="pb-tone-warning mt-3 flex items-start gap-3 rounded-xl border p-3"
            role="status"
          >
            <mat-icon class="shrink-0">warning</mat-icon>
            <p class="text-pb-caption m-0">
              <span class="font-semibold">Food cost is understated.</span>
              {{ analytics.foodCost.linesUnpriced }} of
              {{ analytics.foodCost.linesUnpriced + analytics.foodCost.linesPriced }} consumed lines
              are for items with no purchase price, so they counted as costing nothing. Set prices
              on those items in Inventory to get a real figure.
            </p>
          </div>
        }

        <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <pb-card
            class="lg:col-span-2"
            title="Revenue and stock used"
            icon="show_chart"
            [subtitle]="trendSubtitle()"
          >
            @if (revenueChart(); as spec) {
              <pb-chart [spec]="spec" />
              @if (partialCount() > 0) {
                <p class="text-pb-caption mt-1 text-on-surface-variant">
                  {{ partialCount() }}
                  {{ partialCount() === 1 ? 'period is' : 'periods are' }} only partly entered, so
                  {{ partialCount() === 1 ? 'its bar understates' : 'their bars understate' }} the
                  real total.
                </p>
              }
            } @else {
              <pb-empty-state
                icon="show_chart"
                title="Nothing in this period"
                message="Record some sales, or widen the range."
              />
            }
          </pb-card>

          <pb-card title="Revenue by channel" icon="donut_large">
            @if (channelChart(); as spec) {
              <pb-chart [spec]="spec" />
            } @else {
              <pb-empty-state
                icon="storefront"
                title="No revenue yet"
                message="Record a day's takings to see the split."
              />
            }
          </pb-card>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <pb-card title="Purchase trend" icon="local_shipping" [subtitle]="trendSubtitle()">
            <pb-chart [spec]="purchaseChart()" />
          </pb-card>

          <pb-card title="Transfer trend" icon="swap_horiz" [subtitle]="transferSubtitle()">
            <pb-chart [spec]="transferChart()" />
          </pb-card>
        </div>

        <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <pb-card
            title="Most used ingredients"
            icon="leaderboard"
            subtitle="By quantity consumed in this period"
          >
            @if (ingredientChart(); as spec) {
              <pb-chart [spec]="spec" />
              <ul class="mt-2 flex list-none flex-col gap-1 p-0">
                @for (ingredient of analytics.topIngredients; track ingredient.itemId) {
                  <li class="text-pb-caption flex justify-between gap-2">
                    <span class="truncate text-on-surface-variant">{{ ingredient.itemName }}</span>
                    <span class="shrink-0 tabular-nums">
                      {{ ingredient.displayQuantity }} ·
                      <!-- "unpriced", not ₹0.00: not knowing the cost is not the same
                           as it being free, and a zero would drag any total down. -->
                      {{ ingredient.cost === null ? 'unpriced' : fmt(ingredient.cost) }}
                    </span>
                  </li>
                }
              </ul>
            } @else {
              <pb-empty-state
                icon="restaurant"
                title="Nothing consumed"
                message="Record a consumption sheet to see what the kitchen uses most."
              />
            }
          </pb-card>

          <!--
            Top sellers — the metric the POS made possible.
            Its subtitle carries the one caveat that still applies: this covers counter trade
            only, because aggregator orders are declared as a daily total with no items in it.
          -->
          <pb-card
            title="Top selling products"
            icon="emoji_events"
            subtitle="From POS orders — counter trade only"
          >
            @if (productChart(); as spec) {
              <pb-chart [spec]="spec" />
              <ul class="mt-2 flex list-none flex-col gap-1 p-0">
                @for (product of analytics.topProducts; track product.productName) {
                  <li class="text-pb-caption flex justify-between gap-2">
                    <span class="truncate text-on-surface-variant">{{ product.productName }}</span>
                    <span class="shrink-0 tabular-nums">
                      {{ product.quantity }} sold · {{ fmt(product.revenue) }}
                      @if (product.sharePercent !== null) {
                        <span class="text-on-surface-variant">({{ product.sharePercent }}%)</span>
                      }
                    </span>
                  </li>
                }
              </ul>
            } @else {
              <pb-empty-state
                icon="point_of_sale"
                title="No counter sales yet"
                message="Take an order through the POS and the best sellers appear here."
              />
            }
          </pb-card>

          <!-- Only rendered when there is genuinely something the data cannot answer. -->
          @if (analytics.unavailable.length > 0) {
            <pb-card title="Not available" icon="info">
              <ul class="m-0 flex list-none flex-col gap-3 p-0">
                @for (item of analytics.unavailable; track item.metric) {
                  <li>
                    <p class="text-pb-body m-0 font-semibold">{{ item.metric }}</p>
                    <p class="text-pb-caption m-0 text-on-surface-variant">{{ item.reason }}</p>
                  </li>
                }
              </ul>
            </pb-card>
          }
        </div>

        <p class="text-pb-caption mt-3 text-on-surface-variant">
          {{ analytics.from }} to {{ analytics.to }} · generated {{ generatedAt() }} · inventory
          value is stock on hand today, not for this period.
        </p>
      </div>
    }
  `,
})
export class AnalyticsPage implements OnInit {
  private readonly service = inject(AnalyticsService);
  private readonly notifications = inject(NotificationService);

  protected readonly presets = RANGE_PRESETS;
  protected readonly today = toDateInput(new Date());

  protected readonly data = signal<Analytics | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly exporting = signal<ReportFormat | null>(null);

  protected readonly preset = signal<string>('last-30');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly granularity = signal<AnalyticsGranularity>(AnalyticsGranularity.DAY);

  /** Guards against a slow response for an old range overwriting a newer one. */
  private sequence = 0;

  ngOnInit(): void {
    this.applyPreset('last-30');
  }

  protected readonly subtitle = computed(() => {
    const analytics = this.data();
    return analytics === null
      ? 'Revenue, cost and movement over a period you choose.'
      : `${analytics.from} to ${analytics.to}, grouped by ${analytics.granularity}`;
  });

  protected readonly trendSubtitle = computed(() => `Per ${this.granularity()} in this period`);
  protected readonly transferSubtitle = computed(
    () => `Transfers raised per ${this.granularity()}`,
  );

  protected readonly generatedAt = computed(() => {
    const at = this.data()?.generatedAt;
    return at === undefined ? '' : timestamp(at);
  });

  protected readonly revenueCaption = computed(() => {
    const revenue = this.data()?.revenue;

    if (revenue === undefined) {
      return '';
    }
    if (revenue.daysRecorded === 0) {
      return 'no days entered in this period';
    }

    // Whole rupees in the caption: the tile truncates, and losing "/day" to two decimal
    // places costs more than the paise are worth here.
    const average = moneyCompact(revenue.averagePerRecordedDay);

    return `${String(revenue.daysRecorded)} of ${String(revenue.daysInRange)} days · ${average}/day`;
  });

  protected readonly foodCostValue = computed(() => {
    const percent = this.data()?.foodCost.percent;
    return percent === null || percent === undefined ? '—' : `${String(percent)}%`;
  });

  protected readonly foodCostCaption = computed(() => {
    const foodCost = this.data()?.foodCost;

    if (foodCost === undefined) {
      return '';
    }
    if (foodCost.percent === null) {
      return 'no revenue in this period';
    }

    return foodCost.isComplete
      ? `${money(foodCost.consumptionCost)} of stock used`
      : 'understated — see below';
  });

  protected readonly inventoryCaption = computed(() => {
    const inventory = this.data()?.inventoryValue;

    if (inventory === undefined) {
      return '';
    }

    // Says "today" every time. This is the one tile on a period-scoped page that is not
    // scoped to the period, and without the label it reads as though it were.
    return inventory.unpricedItems === 0
      ? 'stock on hand today'
      : `today · ${String(inventory.unpricedItems)} item${inventory.unpricedItems === 1 ? '' : 's'} unpriced`;
  });

  protected readonly partialCount = computed(
    () => this.data()?.trend.filter((point) => point.isPartial).length ?? 0,
  );

  /**
   * Revenue against the cost of stock used, on one axis.
   *
   * Two series rather than two charts: the gap between them is the point, and reading it
   * off two separately-scaled charts is guesswork.
   */
  /**
   * How much of declared revenue went through the till.
   *
   * Phrased as coverage, never as a total to be added. Null coverage means nothing was
   * declared, which is a different statement from 0%.
   */
  protected readonly posCoverageCaption = computed(() => {
    const pos = this.data()?.posRevenue;

    if (pos === undefined) {
      return '';
    }
    if (pos.coversDeclaredPercent === null) {
      return 'no declared revenue to compare with';
    }

    return `${String(pos.coversDeclaredPercent)}% of declared revenue`;
  });

  protected readonly posOrdersCaption = computed(() => {
    const pos = this.data()?.posRevenue;

    if (pos === undefined || pos.orders === 0) {
      return 'no counter orders yet';
    }

    return `${String(pos.itemsSold)} items · ${money(pos.averageOrderValue)} average`;
  });

  protected readonly productChart = computed<ChartSpec | null>(() => {
    const products = this.data()?.topProducts ?? [];

    if (products.length === 0) {
      return null;
    }

    return {
      type: 'bar',
      height: 280,
      horizontal: true,
      labels: products.map((product) => product.productName),
      series: [{ name: 'Units sold', data: products.map((product) => product.quantity) }],
    };
  });

  protected readonly revenueChart = computed<ChartSpec | null>(() => {
    const trend = this.data()?.trend ?? [];

    if (
      trend.length === 0 ||
      trend.every((point) => point.revenue === 0 && point.consumptionCost === 0)
    ) {
      return null;
    }

    return {
      type: 'bar',
      height: 320,
      valuePrefix: '₹',
      // A partial period is marked in its own label, so the caveat survives being
      // screenshotted away from the note below the chart.
      labels: trend.map((point) => (point.isPartial ? `${point.label} *` : point.label)),
      series: [
        { name: 'Revenue', data: trend.map((point) => point.revenue) },
        { name: 'Stock used', data: trend.map((point) => point.consumptionCost) },
      ],
    };
  });

  protected readonly channelChart = computed<ChartSpec | null>(() => {
    const channels = this.data()?.revenue.byChannel ?? [];

    if (channels.length === 0) {
      return null;
    }

    return {
      type: 'donut',
      height: 320,
      valuePrefix: '₹',
      labels: channels.map((channel) => channel.label),
      series: channels.map((channel) => channel.value),
    };
  });

  protected readonly purchaseChart = computed<ChartSpec>(() => {
    const trend = this.data()?.trend ?? [];

    return {
      type: 'area',
      height: 280,
      valuePrefix: '₹',
      labels: trend.map((point) => point.label),
      series: [{ name: 'Purchases', data: trend.map((point) => point.purchases) }],
    };
  });

  protected readonly transferChart = computed<ChartSpec>(() => {
    const trend = this.data()?.trend ?? [];

    return {
      type: 'bar',
      height: 280,
      labels: trend.map((point) => point.label),
      series: [{ name: 'Transfers', data: trend.map((point) => point.transfers) }],
    };
  });

  protected readonly ingredientChart = computed<ChartSpec | null>(() => {
    const ingredients = this.data()?.topIngredients ?? [];

    if (ingredients.length === 0) {
      return null;
    }

    return {
      type: 'bar',
      height: 280,
      horizontal: true,
      labels: ingredients.map((ingredient) => ingredient.itemName),
      series: [{ name: 'Quantity', data: ingredients.map((ingredient) => ingredient.quantity) }],
    };
  });

  protected fmt(value: number | null): string {
    return money(value);
  }

  protected applyPreset(key: string): void {
    this.preset.set(key);

    if (key === 'custom') {
      return;
    }

    const option = RANGE_PRESETS.find((candidate) => candidate.key === key);

    if (option === undefined) {
      return;
    }

    // Resolved against today at click time, so a tab left open overnight does not silently
    // keep showing yesterday's "last 30 days".
    const range = option.resolve(new Date());

    this.from.set(range.from);
    this.to.set(range.to);
    this.granularity.set(option.granularity);
    this.load();
  }

  protected onFrom(value: string): void {
    this.from.set(value);
    this.preset.set('custom');
    this.load();
  }

  protected onTo(value: string): void {
    this.to.set(value);
    this.preset.set('custom');
    this.load();
  }

  protected onGranularity(value: AnalyticsGranularity): void {
    this.granularity.set(value);
    this.load();
  }

  protected load(): void {
    const from = this.from();
    const to = this.to();

    if (from.length === 0 || to.length === 0) {
      return;
    }

    // Refused here rather than sent: a backwards range would come back as a 400 the user
    // has to decode, when the fix is obvious and local.
    if (from > to) {
      this.error.set('The “from” date is after the “to” date. Adjust one of them.');
      return;
    }

    const sequence = ++this.sequence;

    this.loading.set(true);
    this.error.set(null);

    this.service.get({ from, to, granularity: this.granularity() }).subscribe({
      next: (analytics) => {
        if (sequence !== this.sequence) {
          return;
        }

        this.data.set(analytics);
        this.loading.set(false);
      },
      error: (error: AppError) => {
        if (sequence !== this.sequence) {
          return;
        }

        this.error.set(error.message);
        this.loading.set(false);
      },
    });
  }

  protected download(format: ReportFormat): void {
    const from = this.from();
    const to = this.to();

    this.exporting.set(format);

    this.service.export({ from, to, granularity: this.granularity() }, format).subscribe({
      next: (file) => {
        this.exporting.set(null);

        const url = URL.createObjectURL(file.blob);
        const anchor = document.createElement('a');

        anchor.href = url;
        anchor.download = file.filename;
        anchor.click();

        URL.revokeObjectURL(url);
        this.notifications.success(`Downloaded ${file.filename}`);
      },
      error: () => {
        this.exporting.set(null);
        this.notifications.error('The export could not be generated. Please try again.');
      },
    });
  }
}
