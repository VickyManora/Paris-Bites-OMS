import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CardComponent } from '../../../../shared/components/card/card.component';
import {
  ChartComponent,
  type ChartSpec,
} from '../../../../shared/components/chart/chart.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { MATERIAL_CORE_IMPORTS } from '../../../../shared/material/material-imports';
import { ActivityFeedComponent } from '../activity-feed/activity-feed.component';
import { DashboardSectionComponent } from '../dashboard-section/dashboard-section.component';
import { HeroMetricComponent } from '../hero-metric/hero-metric.component';
import { MetricStripComponent, type StripMetric } from '../metric-strip/metric-strip.component';
import { MetricTileComponent } from '../metric-tile/metric-tile.component';
import { LowStockPanelComponent } from '../low-stock-panel/low-stock-panel.component';
import { TasksPanelComponent } from '../tasks-panel/tasks-panel.component';
import { shortDate, type Dashboard } from '../../models/dashboard.model';

/**
 * The person running the day: what has been used, what is waiting, what to do next.
 *
 * No money anywhere. Stock valuation and purchase spend are not merely hidden from this
 * layout — the API never sends them to a Store Manager, so there is nothing here to leak.
 *
 * ## A different hero, for a different question
 *
 * The admin's hero figure is today's takings. This role's is **how much needs doing**, because the
 * question someone opens this screen with is "what do I do now", not "how did the month go" — and it
 * is the one number here that should stop them if it is large.
 *
 * It carries no sparkline. Task counts are derived from live state and there is no history of them in
 * the payload, so there is no series to draw — and inventing a flat line under a figure would imply a
 * steadiness nobody measured. A trend is drawn where data exists, and here it does not.
 *
 * The rest follows the same three weights and sectioning as the admin layout; see the note on
 * `AdminDashboardComponent` for why the page is banded rather than gridded.
 */
@Component({
  selector: 'pb-manager-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    CardComponent,
    ChartComponent,
    EmptyStateComponent,
    ActivityFeedComponent,
    DashboardSectionComponent,
    HeroMetricComponent,
    MetricStripComponent,
    MetricTileComponent,
    LowStockPanelComponent,
    TasksPanelComponent,
    IconComponent,
    ...MATERIAL_CORE_IMPORTS,
  ],
  template: `
    <div class="flex flex-col gap-pb-7">
      <!--
        ============================== HERO KPI ==============================
        The manager's headline is a workload, not money — see the note on the class.
      -->
      <div class="grid gap-pb-4 lg:grid-cols-5">
        <pb-hero-metric
          class="lg:col-span-2"
          label="To do today"
          [value]="data().tasks.length"
          [caption]="taskSummary()"
          icon="tasks"
        />

        <div class="grid gap-pb-4 sm:grid-cols-2 lg:col-span-3">
          <pb-metric-tile
            label="Needs restocking"
            [value]="data().lowStock.needsRestocking"
            [caption]="outOfStockLabel()"
            icon="lowStock"
            [tone]="restockTone()"
          />
          <pb-metric-tile
            label="Pending requests"
            [value]="data().pendingRequests.total"
            [caption]="pendingBreakdown()"
            icon="pending"
            [tone]="pendingTone()"
          />
        </div>
      </div>

      <!--
        ========================== BUSINESS HEALTH ==========================
        The same band as the admin layout, with the two signals this role can act on. Filled cards
        for the same reason: here the colour is the content.
      -->
      <pb-dashboard-section title="Business health" icon="health" [hint]="healthHint()">
        <div class="grid gap-pb-4 sm:grid-cols-3">
          <pb-metric-tile
            filled
            label="Out of stock"
            [value]="data().lowStock.outOfStock"
            [caption]="outOfStockCaption()"
            icon="inventory"
            [tone]="outOfStockTone()"
          />
          <pb-metric-tile
            filled
            label="Awaiting receipt"
            [value]="data().pendingRequests.awaitingReceipt"
            [caption]="receiptCaption()"
            icon="transfers"
            [tone]="receiptTone()"
          />
          <pb-metric-tile
            filled
            label="Consumption today"
            [value]="data().todaysConsumption?.sheets ?? 0"
            [caption]="consumptionBreakdown()"
            icon="consumption"
            [tone]="consumptionTone()"
          />
        </div>
      </pb-dashboard-section>

      <!--
        The one thing this role is expected to do every day, made reachable from here.

        Directly under the lead rather than at the foot of the page: it is a prompt to act, and a
        prompt below three charts is a prompt nobody scrolls to.
      -->
      @if ((data().todaysConsumption?.sheets ?? 0) === 0) {
        <div
          class="flex flex-col items-start gap-pb-3 rounded-pb-lg border p-pb-4 pb-tone-info sm:flex-row sm:items-center"
        >
          <pb-icon name="edit" [size]="18" />
          <span class="flex-1 text-pb-body">No consumption recorded for today yet.</span>
          <a matButton="filled" [routerLink]="['/consumption']">
            <pb-icon name="add" [size]="16" class="mr-pb-1" />
            Record consumption
          </a>
        </div>
      }

      <!-- ======================== TASKS AND ACTIVITY ======================== -->
      <div class="grid gap-pb-7 lg:grid-cols-2">
        <pb-dashboard-section
          title="Tasks"
          icon="tasks"
          hint="Derived from live state — a task disappears when the work is done"
        >
          <pb-tasks-panel [tasks]="data().tasks" />
        </pb-dashboard-section>

        <pb-dashboard-section
          title="Recent activity"
          icon="activity"
          hint="The stock ledger's newest entries"
        >
          <pb-activity-feed [entries]="data().recentActivity" />
        </pb-dashboard-section>
      </div>

      <!-- ============================= INVENTORY ============================= -->
      <pb-dashboard-section
        title="Inventory"
        icon="inventory"
        hint="Movements are counted, not summed — a kilogram and a litre do not add up"
      >
        <div class="flex flex-col gap-pb-4">
          <pb-metric-strip [metrics]="inventoryMetrics()" [columns]="2" />

          <div class="grid gap-pb-4 lg:grid-cols-3">
            <pb-card
              dense
              class="lg:col-span-2"
              title="Consumption and movement"
              [subtitle]="'Movements per day over the last ' + data().windowDays + ' days'"
            >
              <pb-chart [spec]="movementChart()" />
            </pb-card>

            <pb-card
              dense
              title="Restocking by category"
              subtitle="Items at or below their reorder level"
            >
              @if (lowStockChart(); as spec) {
                <pb-chart [spec]="spec" />
              } @else {
                <pb-empty-state
                  iconName="ok"
                  title="Everything is stocked"
                  message="No category has an item at or below its reorder level."
                />
              }
            </pb-card>
          </div>

          <pb-low-stock-panel [items]="data().lowStock.items" />
        </div>
      </pb-dashboard-section>
    </div>
  `,
})
export class ManagerDashboardComponent {
  readonly data = input.required<Dashboard>();

  /** Names the band's worst state. Nothing here is computed that the page did not already show. */
  protected readonly healthHint = computed(() => {
    if (this.data().lowStock.outOfStock > 0) {
      return 'Something is out of stock';
    }
    if ((this.data().todaysConsumption?.sheets ?? 0) === 0) {
      return 'Consumption not recorded yet';
    }

    return 'Nothing needs attention';
  });

  protected readonly outOfStockTone = computed<'success' | 'danger'>(() =>
    this.data().lowStock.outOfStock > 0 ? 'danger' : 'success',
  );

  protected readonly outOfStockCaption = computed(() =>
    this.data().lowStock.outOfStock === 0 ? 'every item has stock' : 'cannot be sold today',
  );

  protected readonly receiptTone = computed<'neutral' | 'info'>(() =>
    this.data().pendingRequests.awaitingReceipt > 0 ? 'info' : 'neutral',
  );

  protected readonly receiptCaption = computed(() => {
    const waiting = this.data().pendingRequests.awaitingReceipt;
    return waiting === 0 ? 'nothing in transit' : 'transfers to receive';
  });

  /**
   * Warning only when nothing has been recorded.
   *
   * Recording consumption is this role's daily obligation, so an empty sheet at any hour is the one
   * thing worth flagging amber — and a recorded one is a success rather than a neutral fact.
   */
  protected readonly consumptionTone = computed<'success' | 'warning'>(() =>
    (this.data().todaysConsumption?.sheets ?? 0) === 0 ? 'warning' : 'success',
  );

  protected readonly consumptionBreakdown = computed(() => {
    const consumption = this.data().todaysConsumption;

    if (consumption === undefined) {
      return '';
    }

    return consumption.sheets === 0
      ? 'nothing recorded yet'
      : `${String(consumption.items)} item${consumption.items === 1 ? '' : 's'} used`;
  });

  protected readonly pendingBreakdown = computed(() => {
    const pending = this.data().pendingRequests;
    return `${String(pending.awaitingReceipt)} to receive`;
  });

  protected readonly outOfStockLabel = computed(() => {
    const out = this.data().lowStock.outOfStock;
    return out === 0 ? 'none out of stock' : `${String(out)} out of stock`;
  });

  protected readonly taskSummary = computed(() => {
    const critical = this.data().tasks.filter((task) => task.severity === 'critical').length;
    return critical === 0 ? 'nothing urgent' : `${String(critical)} urgent`;
  });

  protected readonly inventoryMetrics = computed<readonly StripMetric[]>(() => [
    {
      label: 'Consumption today',
      value: this.data().todaysConsumption?.sheets ?? 0,
      caption: this.consumptionBreakdown(),
      icon: 'consumption',
    },
    {
      label: 'Out of stock',
      value: this.data().lowStock.outOfStock,
      caption: this.data().lowStock.outOfStock === 0 ? 'nothing at zero' : 'cannot be sold today',
      icon: 'lowStock',
      tone: this.data().lowStock.outOfStock > 0 ? 'danger' : 'neutral',
    },
  ]);

  /** Same rule as the admin layout: zero is the only state that is not news. */
  protected readonly restockTone = computed<'neutral' | 'warning' | 'danger'>(() => {
    const stock = this.data().lowStock;

    if (stock.outOfStock > 0) {
      return 'danger';
    }

    return stock.needsRestocking > 0 ? 'warning' : 'neutral';
  });

  protected readonly pendingTone = computed<'neutral' | 'warning'>(() =>
    this.data().pendingRequests.awaitingReceipt > 0 ? 'warning' : 'neutral',
  );

  protected readonly movementChart = computed<ChartSpec>(() => {
    const points = this.data().charts.stockMovement;

    return {
      type: 'area',
      height: 300,
      labels: points.map((point) => shortDate(point.date)),
      series: [
        { name: 'Consumed', data: points.map((point) => point.consumed) },
        { name: 'Received', data: points.map((point) => point.purchased) },
        { name: 'Transferred', data: points.map((point) => point.transferred) },
      ],
    };
  });

  protected readonly lowStockChart = computed<ChartSpec | null>(() => {
    const slices = this.data().charts.lowStockByCategory;

    if (slices.length === 0) {
      return null;
    }

    return {
      type: 'bar',
      horizontal: true,
      height: 300,
      labels: slices.map((slice) => slice.label),
      series: [{ name: 'Items', data: slices.map((slice) => slice.value) }],
    };
  });
}
