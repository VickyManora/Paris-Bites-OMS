import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CardComponent } from '../../../../shared/components/card/card.component';
import {
  ChartComponent,
  type ChartSpec,
} from '../../../../shared/components/chart/chart.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import type { PbIconName } from '../../../../shared/components/icon/icon-registry';
import { MATERIAL_CORE_IMPORTS } from '../../../../shared/material/material-imports';
import { ActivityFeedComponent } from '../activity-feed/activity-feed.component';
import { DashboardSectionComponent } from '../dashboard-section/dashboard-section.component';
import { HeroMetricComponent } from '../hero-metric/hero-metric.component';
import { MetricStripComponent, type StripMetric } from '../metric-strip/metric-strip.component';
import { MetricTileComponent } from '../metric-tile/metric-tile.component';
import { LowStockPanelComponent } from '../low-stock-panel/low-stock-panel.component';
import { TasksPanelComponent } from '../tasks-panel/tasks-panel.component';
import { money, shortDate, type Dashboard } from '../../models/dashboard.model';

/**
 * The owner's view: money, movement and what is running out.
 *
 * Ordered by how often it is looked at rather than by how much work it took to compute —
 * the four figures at the top are the ones someone opens this page for, the charts explain
 * them, and the lists say what to do next.
 *
 * ## Why this is sectioned rather than a grid of tiles
 *
 * It used to be twenty `pb-stat-card`s in five rows of four, then six chart cards, then three
 * panels — every one of them the same size with the same border and no stated relationship. Nothing
 * on it was wrong; it just gave "today's revenue" and "how many invoices someone typed in" identical
 * billing, so the reader had to do the ranking the page should have done for them.
 *
 * The fix is hierarchy, in three weights and named bands:
 *
 * - **One hero figure** — today's takings. If you read one number, read that one.
 * - **Primary tiles** — the four you check on purpose: what we spent, what we hold, what is short,
 *   what is waiting.
 * - **Strip readings** — everything else, several to a surface, because sixteen bordered boxes was a
 *   lot of chrome spent flattening a real difference in importance.
 *
 * Sections carry the grouping the old layout left implicit, and the gap between them is much larger
 * than any gap inside one — which is most of what makes a dense screen readable.
 *
 * **Charts live in the section they explain** rather than in a "charts" block of their own. A band of
 * six charts is the same mistake as a band of twenty tiles: it groups by what the thing *is* instead
 * of by what it is *about*, and it was the other half of why this page read as a pile of cards.
 *
 * ## What did not change
 *
 * No figure on this screen is computed differently, and no request changed. Every value is the same
 * field of the same payload; what moved is which of them is loud. Two charts changed *form* — see
 * `valueChart` and `movementChart` — but plot exactly the numbers they plotted before.
 */
@Component({
  selector: 'pb-admin-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    CardComponent,
    ChartComponent,
    EmptyStateComponent,
    ActivityFeedComponent,
    LowStockPanelComponent,
    TasksPanelComponent,
    DashboardSectionComponent,
    HeroMetricComponent,
    MetricStripComponent,
    MetricTileComponent,
    IconComponent,
    ...MATERIAL_CORE_IMPORTS,
  ],
  template: `
    <!--
      'gap-pb-7' between bands against 'gap-pb-4' inside them. That ratio is the layout: a section
      break has to be several times the gap between two cards, or the grouping is not read as
      grouping and the page is a grid again. It was 'gap-pb-6'; the extra step is the cheapest part
      of "more whitespace" and the one that does the most.
    -->
    <div class="flex flex-col gap-pb-7">
      <!--
        ============================== HERO KPI ==============================
        One gold card and the three white ones that qualify it. No heading: this band is the top of
        the page and a heading over the headline is a label on a label.

        The hero takes two of five columns rather than one of three, so the figure has room to be
        52px without wrapping and the three tiles beside it stay wide enough for a money value. On
        anything below 'lg' the whole thing stacks, which is the only honest layout at that width.
      -->
      <div class="grid gap-pb-4 lg:grid-cols-5">
        <pb-hero-metric
          class="lg:col-span-2"
          label="Today's sales"
          [value]="todaysSalesValue()"
          [caption]="todaysSalesCaption()"
          icon="revenue"
          [series]="salesSparkline()"
        >
          <!--
            Only while the day is unrecorded, which is also the only time the card has room to spare.
            A link, not a form: entering takings belongs to the Daily sales screen, which owns the
            validation and the revision history. The shell and the dashboard navigate; they do not
            record.
          -->
          @if (!salesRecorded()) {
            <!--
              The badge, only when the headline number came from the till.

              Without it the card is indistinguishable from a written-up day, and the two carry
              different weight: one is a figure somebody confirmed, the other is what the POS happens
              to have so far and excludes every aggregator order.
            -->
            @if (salesProvisional()) {
              <span class="pb-badge pb-badge-pill pb-tone-warning mt-pb-2 self-start">
                <pb-icon name="clock" [size]="14" />
                From the till · not yet confirmed
              </span>
            }

            <!-- 'mt-auto' pins it to the card's baseline; see the note in the hero component. -->
            <a matButton="filled" class="mt-auto self-start" [routerLink]="['/sales']">
              <pb-icon name="edit" [size]="16" class="mr-pb-1" />
              {{ salesProvisional() ? "Confirm today's takings" : "Enter today's takings" }}
            </a>
          }
        </pb-hero-metric>

        <div class="grid gap-pb-4 sm:grid-cols-3 lg:col-span-3">
          <pb-metric-tile
            label="Counter takings"
            [value]="counterRevenue()"
            [caption]="counterCaption()"
            icon="pos"
          />
          <pb-metric-tile
            label="Today's purchases"
            [value]="purchaseValue()"
            [caption]="purchaseCount()"
            icon="spend"
          />
          <pb-metric-tile
            label="Inventory value"
            [value]="inventoryValue()"
            [caption]="pricingCoverage()"
            icon="value"
          />
        </div>
      </div>

      <!--
        ========================== BUSINESS HEALTH ==========================
        The one band where a coloured card *is* the content.

        Everything here answers "is anything wrong right now", and the answer is the colour — a green
        card and a red card side by side is read before any of the numbers on them are. That is why
        these four are 'filled' and nothing else on the page is: elsewhere the figure is the message
        and a tint would be decoration, which is how a dashboard teaches its reader to ignore amber.

        No figure here is new. Each is a value the page already showed, given the billing its
        severity deserves rather than a slot in a row of identical tiles.
      -->
      <pb-dashboard-section title="Business health" icon="health" [hint]="healthHint()">
        <div class="grid gap-pb-4 sm:grid-cols-2 xl:grid-cols-4">
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
            label="Needs restocking"
            [value]="data().lowStock.needsRestocking"
            [caption]="restockCaption()"
            icon="lowStock"
            [tone]="restockTone()"
          />
          <pb-metric-tile
            filled
            label="Awaiting approval"
            [value]="data().pendingRequests.awaitingApproval"
            [caption]="pendingBreakdown()"
            icon="pending"
            [tone]="pendingTone()"
          />
          <pb-metric-tile
            filled
            label="Till vs declared"
            [value]="reconciliationHeadline()"
            [caption]="reconciliationCaption()"
            [icon]="reconciliationIcon()"
            [tone]="reconciliationTone()"
          />
        </div>

        @if (reconciliation(); as check) {
          <!--
            The full sentence, under the tiles rather than inside one.

            The tile above gives the state at a glance; this explains it, and an explanation that
            runs to two sentences does not belong in a KPI card — it would set the height of all four.
          -->
          <div [class]="reconciliationClass()">
            <pb-icon [name]="reconciliationIcon()" [size]="18" class="mt-0.5" />
            <p class="m-0 text-pb-body">{{ reconciliationMessage() }}</p>
          </div>
        }
      </pb-dashboard-section>

      <!-- ============================== SALES ============================== -->
      <pb-dashboard-section
        title="Sales"
        icon="trendUp"
        hint="Declared takings — what is entered at close, across every channel"
      >
        <div class="flex flex-col gap-pb-4">
          <pb-metric-strip [metrics]="salesMetrics()" [columns]="3" />

          <div class="grid gap-pb-4 lg:grid-cols-3">
            <pb-card
              dense
              class="lg:col-span-2"
              title="Daily takings"
              [subtitle]="salesTrendSubtitle()"
            >
              @if (salesTrendChart(); as spec) {
                <pb-chart [spec]="spec" />
                <!-- Said plainly under the chart, because a line joining 24 July to 26 July
                     looks continuous and is not. -->
                @if (unrecordedCount() > 0) {
                  <p class="m-0 mt-pb-3 text-pb-caption text-pb-text-muted">
                    {{ unrecordedCount() }}
                    {{
                      unrecordedCount() === 1
                        ? 'day in this window has'
                        : 'days in this window have'
                    }}
                    no entry, so they are missing from the chart rather than drawn as zero.
                  </p>
                }
              } @else {
                <pb-empty-state
                  iconName="calendar"
                  title="No takings recorded yet"
                  message="Enter a day's sales and the daily trend builds itself from there."
                />
              }
            </pb-card>

            <pb-card
              dense
              title="Revenue by channel"
              [subtitle]="'Across ' + data().windowDays + ' days'"
            >
              @if (salesChannelChart(); as spec) {
                <pb-chart [spec]="spec" />
              } @else {
                <pb-empty-state
                  iconName="pos"
                  title="Nothing to split yet"
                  message="Walk-in, Zomato and Swiggy are broken out once a day has been recorded."
                />
              }
            </pb-card>
          </div>
        </div>
      </pb-dashboard-section>

      <!--
        ============================ THE COUNTER ============================
        Deliberately its own band rather than mixed into Sales above.

        Those figures are the declared daily total — what an admin types in at close. These are the
        till's own record of walk-in trade. They describe the same money from two sources, so they sit
        side by side and are never added: summing them would double-count every order taken. The
        reconciliation line in Business health is the only honest relationship between the two.
      -->
      @if (posToday(); as pos) {
        <pb-dashboard-section
          title="At the counter today"
          icon="pos"
          hint="POS orders — the till's own record, never added to the declared total above"
        >
          <pb-metric-strip [metrics]="counterMetrics()" [columns]="4" />
        </pb-dashboard-section>
      }

      <!-- ============================ INVENTORY ============================ -->
      <pb-dashboard-section
        title="Inventory"
        icon="inventory"
        hint="Movements are counted, not summed — a kilogram and a litre do not add up"
      >
        <div class="flex flex-col gap-pb-4">
          <pb-metric-strip [metrics]="inventoryMetrics()" [columns]="3" />

          <div class="grid gap-pb-4 lg:grid-cols-3">
            <pb-card
              dense
              class="lg:col-span-2"
              title="Stock movement"
              [subtitle]="'Movements per day over the last ' + data().windowDays + ' days'"
            >
              <pb-chart [spec]="movementChart()" />
            </pb-card>

            <pb-card dense title="Stock value by category" [subtitle]="pricingCoverage()">
              @if (valueChart(); as spec) {
                <pb-chart [spec]="spec" />
              } @else {
                <pb-empty-state
                  iconName="value"
                  title="Nothing priced yet"
                  message="Set a purchase price on an item, or record a purchase, and the valuation appears here."
                />
              }
            </pb-card>
          </div>

          <div class="grid gap-pb-4 lg:grid-cols-3">
            <pb-low-stock-panel [items]="data().lowStock.items" />

            <pb-card
              dense
              class="lg:col-span-2"
              title="Top used ingredients"
              subtitle="Ranked by how often they appear on a consumption sheet"
            >
              @if (topIngredientsChart(); as spec) {
                <pb-chart [spec]="spec" />
                <ul class="m-0 mt-pb-3 flex list-none flex-col gap-pb-1 p-0">
                  @for (ingredient of data().topIngredients ?? []; track ingredient.itemId) {
                    <li class="flex justify-between gap-pb-3 text-pb-caption">
                      <span class="truncate text-pb-text-secondary">{{ ingredient.itemName }}</span>
                      <span class="shrink-0 tabular-nums text-pb-text">
                        {{ ingredient.displayQuantity }} total
                      </span>
                    </li>
                  }
                </ul>
              } @else {
                <pb-empty-state
                  iconName="consumption"
                  title="No consumption recorded yet"
                  message="Record what the kitchen uses and the ranking builds itself."
                />
              }
            </pb-card>
          </div>
        </div>
      </pb-dashboard-section>

      <!-- ============================== BUYING ============================== -->
      <pb-dashboard-section
        title="Buying"
        icon="purchases"
        hint="Grouped by invoice date, so a bill entered today lands on the day it was issued"
      >
        <div class="flex flex-col gap-pb-4">
          <pb-metric-strip [metrics]="buyingMetrics()" [columns]="2" />

          <pb-card
            dense
            title="Purchase spend"
            [subtitle]="'Daily spend over the last ' + data().windowDays + ' days'"
          >
            <pb-chart [spec]="spendChart()" />
          </pb-card>
        </div>
      </pb-dashboard-section>

      <!--
        ======================== TASKS AND ACTIVITY ========================
        Two headed bands rather than one called "Today's work".

        They answer different questions — what to do next, and what just happened — and the old
        shared heading made the activity feed read as a list of outstanding work. Side by side
        because both are short lists that would waste a full-width row.
      -->
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
    </div>
  `,
})
export class AdminDashboardComponent {
  readonly data = input.required<Dashboard>();

  // ---------------------------------------------------------------------------
  // Strips
  //
  // Assembled here rather than spelled out in the template, so each band's readings are one list
  // to read and reorder. Every value is an existing field or an existing formatter — these builders
  // group and label, they do not calculate.
  // ---------------------------------------------------------------------------

  protected readonly salesMetrics = computed<readonly StripMetric[]>(() => [
    {
      label: 'Sales this month',
      value: this.monthSalesValue(),
      caption: this.monthSalesCaption(),
      icon: 'calendar',
    },
    {
      label: 'Cash today',
      value: this.cashTodayValue(),
      caption: this.cashTodayCaption(),
      icon: 'cash',
    },
    {
      label: 'Platforms today',
      value: this.platformsTodayValue(),
      caption: this.platformsTodayCaption(),
      icon: 'platforms',
    },
  ]);

  protected readonly counterMetrics = computed<readonly StripMetric[]>(() => {
    const pos = this.posToday();

    return [
      {
        label: 'Counter takings',
        value: this.counterRevenue(),
        caption: this.counterCaption(),
        icon: 'pos',
      },
      {
        label: 'Orders taken',
        value: pos?.orders ?? 0,
        caption: this.ordersCaption(),
        icon: 'spend',
      },
      {
        label: 'Awaiting payment',
        value: this.pendingAmount(),
        caption: this.pendingCaption(),
        icon: 'clock',
        // Money the shop has handed over goods for and not been paid for. Toned only when there
        // actually is some — an amber zero trains people to ignore amber.
        tone: (pos?.pendingOrders ?? 0) > 0 ? 'warning' : 'neutral',
      },
      {
        label: 'Items sold',
        value: pos?.itemsSold ?? 0,
        caption: this.topProductCaption(),
        icon: 'product',
      },
    ];
  });

  protected readonly inventoryMetrics = computed<readonly StripMetric[]>(() => [
    {
      label: 'Transfers today',
      value: this.data().transfersToday?.requested ?? 0,
      caption: this.transferBreakdown(),
      icon: 'transfers',
    },
    {
      label: 'Consumption today',
      value: this.data().todaysConsumption?.sheets ?? 0,
      caption: this.consumptionBreakdown(),
      icon: 'consumption',
    },
    {
      label: 'Write-downs',
      value: this.data().writeDowns?.events ?? 0,
      caption: this.writeDownBreakdown(),
      icon: 'trendDown',
      tone: (this.data().writeDowns?.events ?? 0) > 0 ? 'warning' : 'neutral',
    },
  ]);

  protected readonly buyingMetrics = computed<readonly StripMetric[]>(() => [
    {
      label: 'Invoices entered today',
      value: this.data().todaysPurchases?.count ?? 0,
      caption: this.purchaseValue() + ' in total',
      icon: 'document',
    },
    { label: 'GST paid today', value: this.taxValue(), icon: 'tax' },
  ]);

  // ---------------------------------------------------------------------------
  // Business health
  //
  // **Nothing here computes a new fact.** Every value below is a field the page already displayed or
  // a tone it already derived; what is new is the billing — the four signals that answer "is
  // anything wrong" are lifted out of four different rows into one band, where the colour is read
  // before the number.
  //
  // Deliberately not a score. A single "health: 82%" would be a new business rule invented in a
  // template, and it would hide which of the four is the one that needs attention.
  // ---------------------------------------------------------------------------

  /** Names the band's worst state, so the heading says something before anything is read. */
  protected readonly healthHint = computed(() => {
    const stock = this.data().lowStock;
    const approvals = this.data().pendingRequests.awaitingApproval;

    if (stock.outOfStock > 0) {
      return 'Something is out of stock';
    }
    if (stock.needsRestocking > 0 || approvals > 0) {
      return 'Needs attention today';
    }

    return 'Nothing needs attention';
  });

  /**
   * Danger whenever anything is at zero — an item the shop cannot sell today.
   *
   * Success rather than neutral at zero, because this band's job is to answer a question, and a grey
   * card leaves "is anything out of stock" looking unanswered.
   */
  protected readonly outOfStockTone = computed<'success' | 'danger'>(() =>
    this.data().lowStock.outOfStock > 0 ? 'danger' : 'success',
  );

  protected readonly outOfStockCaption = computed(() => {
    const out = this.data().lowStock.outOfStock;
    return out === 0 ? 'every item has stock' : 'cannot be sold today';
  });

  protected readonly restockCaption = computed(() => {
    const stock = this.data().lowStock;
    return stock.needsRestocking === 0
      ? 'all above reorder level'
      : `${String(stock.needsRestocking)} at or below reorder level`;
  });

  /**
   * The reconciliation, as a headline short enough for a KPI card.
   *
   * The full sentence is `reconciliationMessage` and renders beneath the band. This is the same
   * three states in three words.
   */
  protected readonly reconciliationHeadline = computed(() => {
    const check = this.reconciliation();

    if (check === undefined) {
      return '—';
    }
    if (check.declared === null) {
      return 'Not declared';
    }

    return Math.abs(check.variance ?? 0) < 0.01 ? 'Matches' : money(Math.abs(check.variance ?? 0));
  });

  protected readonly reconciliationCaption = computed(() => {
    const check = this.reconciliation();

    if (check === undefined) {
      return '';
    }
    if (check.declared === null) {
      return 'takings not entered yet';
    }

    const variance = check.variance ?? 0;

    if (Math.abs(variance) < 0.01) {
      return 'till agrees with declared';
    }

    return variance > 0 ? 'declared above till' : 'declared below till';
  });

  /**
   * Neutral while the day is simply not declared yet.
   *
   * That is the normal state until close of business and must not read as a shortfall — an uncounted
   * day is not a missing ₹925, and an amber card at 3pm every day is an alarm nobody will hear by
   * Thursday.
   */
  protected readonly reconciliationTone = computed<'neutral' | 'success' | 'warning'>(() => {
    const check = this.reconciliation();

    if (check === undefined || check.declared === null) {
      return 'neutral';
    }

    return Math.abs(check.variance ?? 0) < 0.01 ? 'success' : 'warning';
  });

  /**
   * Tone for the restocking tile.
   *
   * **Amber, never red — and that changed when the band split in two.** This used to escalate to
   * danger whenever anything was at zero, which was right for a single tile carrying both facts.
   * Now that "Out of stock" is its own card beside it, the old rule painted two red cards for one
   * problem: the reader saw 40 out of stock and 53 needing restock in identical red and had no way
   * to tell that the second contains the first.
   *
   * The split makes the distinction the tones should always have carried: "below its reorder level"
   * is a prompt to write a purchase order, and "out of stock" is a product the shop cannot sell
   * today. One card is amber, the other red, and the ranking is legible again.
   */
  protected readonly restockTone = computed<'success' | 'warning'>(() =>
    this.data().lowStock.needsRestocking > 0 ? 'warning' : 'success',
  );

  /**
   * Success at zero rather than neutral, now that this tile lives in Business health.
   *
   * The band answers a question, and a grey card leaves "is anything waiting on me" looking
   * unanswered — the reader cannot tell an empty queue from a tile that failed to load. Green says
   * the queue is clear, which is the actual finding.
   */
  protected readonly pendingTone = computed<'success' | 'warning'>(() =>
    this.data().pendingRequests.awaitingApproval > 0 ? 'warning' : 'success',
  );

  /**
   * The hero sparkline's series: daily takings, values only.
   *
   * The same array the trend chart plots, so the shape above and the chart below cannot disagree.
   * Unrecorded days are already absent from it — see `salesTrend` on the model — which is the right
   * behaviour for a shape too: a dip to zero would be a day nobody entered, drawn as a bad day.
   */
  protected readonly salesSparkline = computed<readonly number[]>(() =>
    this.data().charts.salesTrend.map((point) => point.amount),
  );

  protected readonly purchaseValue = computed(() =>
    money(this.data().todaysPurchases?.totalValue ?? 0),
  );
  protected readonly taxValue = computed(() => money(this.data().todaysPurchases?.totalTax ?? 0));

  protected readonly purchaseCount = computed(() => {
    const count = this.data().todaysPurchases?.count ?? 0;
    return `${String(count)} ${count === 1 ? 'invoice' : 'invoices'}`;
  });

  protected readonly inventoryValue = computed(() => money(this.data().inventoryValue?.total ?? 0));

  /**
   * How much of the shelf the valuation actually covers.
   *
   * A stock value quoted without this is the kind of number that ends up in a report
   * unchallenged — with 40 of 40 items unpriced it would read as ₹0 of inventory rather
   * than as an unanswered question.
   */
  protected readonly pricingCoverage = computed(() => {
    const value = this.data().inventoryValue;

    if (value === undefined) {
      return '';
    }
    if (value.unpricedItems === 0) {
      return 'all items priced';
    }

    return `${String(value.unpricedItems)} item${value.unpricedItems === 1 ? '' : 's'} unpriced`;
  });

  protected readonly outOfStockLabel = computed(() => {
    const out = this.data().lowStock.outOfStock;
    return out === 0 ? 'none out of stock' : `${String(out)} out of stock`;
  });

  protected readonly pendingBreakdown = computed(() => {
    const pending = this.data().pendingRequests;
    return `${String(pending.awaitingApproval)} to approve · ${String(pending.awaitingReceipt)} in transit`;
  });

  protected readonly transferBreakdown = computed(() => {
    const transfers = this.data().transfersToday;

    if (transfers === undefined) {
      return '';
    }

    return `${String(transfers.completed)} completed · ${String(transfers.inTransit)} in transit`;
  });

  protected readonly consumptionBreakdown = computed(() => {
    const consumption = this.data().todaysConsumption;

    if (consumption === undefined) {
      return '';
    }

    return `${String(consumption.items)} item${consumption.items === 1 ? '' : 's'} used`;
  });

  /**
   * Labelled "write-downs", not "wastage".
   *
   * There is no wastage record in the system; this counts manual downward adjustments,
   * which is where waste lands today — someone bins a spoiled tub and adjusts stock down.
   * It therefore also catches stocktake corrections, so calling it wastage would overstate
   * a figure people would act on.
   */
  protected readonly writeDownBreakdown = computed(() => {
    const writeDowns = this.data().writeDowns;

    if (writeDowns === undefined) {
      return '';
    }

    return writeDowns.events === 0
      ? 'no manual reductions'
      : `${String(writeDowns.itemsAffected)} item${writeDowns.itemsAffected === 1 ? '' : 's'} affected`;
  });

  // ---------------------------------------------------------------------------
  // Sales
  // ---------------------------------------------------------------------------

  /**
   * The declared total once written up, the till's figure before that, an em dash if neither.
   *
   * ## Why the till fills the gap
   *
   * This used to be a bare em dash all day until somebody entered the takings at close, which meant
   * the largest number on the landing page said nothing for the entire trading day — while the POS
   * two tiles over already knew what the counter had rung up. The em dash is still right when there
   * is genuinely nothing to show, but "no declared entry yet" and "no idea what today took" are
   * different facts, and only the second deserves a blank.
   *
   * It is still never ₹0.00 on an unrecorded day. A confident zero on a Saturday evening reads as
   * "we sold nothing today", which is the sort of number that gets screenshotted before anyone
   * checks whether it was simply not typed in yet.
   *
   * ## It is provisional, and the card says so
   *
   * The caption carries the provenance and `salesProvisional` drives a badge, because a figure that
   * looks like the declared total but is not would quietly undermine the one comparison this app
   * makes between the two — the till and the declared entry describe the same walk-in trade from two
   * sources, and the variance between them is the control. Aggregator takings are also absent from
   * the till figure by definition, so on a Zomato day the provisional number is genuinely lower than
   * the day's real total; saying "from the till" is what keeps that honest.
   */
  protected readonly todaysSalesValue = computed(() => {
    const sales = this.data().todaysSales;

    if (sales?.recorded === true) {
      return money(sales.total);
    }

    const till = this.data().posToday;

    return till !== undefined && till.revenue > 0 ? money(till.revenue) : '—';
  });

  /** Drives the hero's prompt. Reads the same `recorded` flag the em dash above is decided by. */
  protected readonly salesRecorded = computed(() => this.data().todaysSales?.recorded === true);

  /** True when the headline figure is the till's rather than a declared entry. */
  protected readonly salesProvisional = computed(() => {
    if (this.salesRecorded()) {
      return false;
    }

    const till = this.data().posToday;

    return till !== undefined && till.revenue > 0;
  });

  protected readonly todaysSalesCaption = computed(() => {
    const sales = this.data().todaysSales;

    if (sales === undefined) {
      return '';
    }

    if (!sales.recorded) {
      const till = this.data().posToday;

      if (till !== undefined && till.revenue > 0) {
        return `${money(till.cash)} cash · ${money(till.online)} online at the counter`;
      }

      return 'not recorded yet';
    }

    return `${money(sales.cash)} cash · ${money(sales.online)} online`;
  });

  protected readonly monthSalesValue = computed(() =>
    money(this.data().salesMonthToDate?.total ?? 0),
  );

  /**
   * How much of the month the figure actually covers.
   *
   * The same reasoning as `pricingCoverage`: a month-to-date total with three of
   * twenty-eight days entered is not a month's trading, and saying so is the difference
   * between a figure and a misleading one.
   */
  protected readonly monthSalesCaption = computed(() => {
    const month = this.data().salesMonthToDate;

    if (month === undefined) {
      return '';
    }
    if (month.daysRecorded === 0) {
      return 'no days recorded this month';
    }

    return `${String(month.daysRecorded)} of ${String(month.daysElapsed)} days recorded`;
  });

  protected readonly cashTodayValue = computed(() => this.todayFigure((s) => s.cash));
  protected readonly platformsTodayValue = computed(() => this.todayFigure((s) => s.aggregator));

  protected readonly cashTodayCaption = computed(() => this.todayShare((s) => s.cash, 'of today'));
  protected readonly platformsTodayCaption = computed(() =>
    this.todayShare((s) => s.aggregator, 'of today'),
  );

  protected readonly unrecordedCount = computed(() => this.data().unrecordedSalesDays?.length ?? 0);

  protected readonly salesTrendSubtitle = computed(
    () => `Takings per recorded day over the last ${String(this.data().windowDays)} days`,
  );

  /**
   * Daily takings.
   *
   * A bar rather than an area chart, unlike stock movement. An area implies a continuous
   * quantity sampled over time; takings are a discrete figure per day, and unrecorded days
   * are simply not in the series — joining across a gap with a smooth line would invent a
   * trend through a day nobody entered.
   */
  protected readonly salesTrendChart = computed<ChartSpec | null>(() => {
    const points = this.data().charts.salesTrend;

    if (points.length === 0) {
      return null;
    }

    return {
      type: 'bar',
      height: 300,
      valuePrefix: '₹',
      labels: points.map((point) => shortDate(point.date)),
      series: [{ name: 'Takings', data: points.map((point) => point.amount) }],
    };
  });

  protected readonly salesChannelChart = computed<ChartSpec | null>(() => {
    const slices = this.data().charts.salesByChannel;

    if (slices.length === 0) {
      return null;
    }

    return {
      type: 'donut',
      height: 300,
      valuePrefix: '₹',
      labels: slices.map((slice) => slice.label),
      series: slices.map((slice) => slice.value),
    };
  });

  /** `—` until the day is entered; the figure afterwards. */
  private todayFigure(pick: (sales: NonNullable<Dashboard['todaysSales']>) => number): string {
    const sales = this.data().todaysSales;
    return sales === undefined || !sales.recorded ? '—' : money(pick(sales));
  }

  private todayShare(
    pick: (sales: NonNullable<Dashboard['todaysSales']>) => number,
    suffix: string,
  ): string {
    const sales = this.data().todaysSales;

    if (sales === undefined || !sales.recorded) {
      return 'today not recorded';
    }
    if (sales.total <= 0) {
      return 'no takings today';
    }

    return `${String(Math.round((pick(sales) / sales.total) * 100))}% ${suffix}`;
  }

  // ---------------------------------------------------------------------------
  // The counter
  // ---------------------------------------------------------------------------

  protected readonly posToday = computed(() => this.data().posToday);
  protected readonly reconciliation = computed(() => this.data().walkInReconciliation);

  protected readonly counterRevenue = computed(() => money(this.posToday()?.revenue ?? 0));
  protected readonly pendingAmount = computed(() => money(this.posToday()?.pendingAmount ?? 0));

  protected readonly counterCaption = computed(() => {
    const pos = this.posToday();

    if (pos === undefined || pos.revenue <= 0) {
      return 'nothing through the till yet';
    }

    return `${money(pos.cash)} cash · ${money(pos.online)} digital`;
  });

  protected readonly ordersCaption = computed(() => {
    const pos = this.posToday();

    if (pos === undefined) {
      return '';
    }

    return pos.pendingOrders === 0
      ? `${String(pos.paidOrders)} paid`
      : `${String(pos.paidOrders)} paid · ${String(pos.pendingOrders)} unpaid`;
  });

  protected readonly pendingCaption = computed(() => {
    const pos = this.posToday();
    return pos === undefined || pos.pendingOrders === 0
      ? 'nothing outstanding'
      : `${String(pos.pendingOrders)} order${pos.pendingOrders === 1 ? '' : 's'}`;
  });

  /** Names the best seller on the tile, which is the one product fact worth a glance. */
  protected readonly topProductCaption = computed(() => {
    const top = this.data().topProductsToday?.[0];
    return top === undefined ? 'nothing sold yet' : `${top.productName} leads`;
  });

  /**
   * The three reconciliation states.
   *
   * "Not yet declared" is the normal state until close of business and must not read as a
   * shortfall — an uncounted day is not a missing ₹925.
   */
  protected readonly reconciliationMessage = computed(() => {
    const check = this.reconciliation();

    if (check === undefined) {
      return '';
    }
    if (check.declared === null) {
      return `The till recorded ${money(check.counter)} of walk-in trade. Today's takings have not been declared yet — enter them in Daily sales to reconcile.`;
    }
    if (Math.abs(check.variance ?? 0) < 0.01) {
      return `Declared walk-in matches the till exactly at ${money(check.counter)}.`;
    }

    const variance = check.variance ?? 0;

    return variance > 0
      ? `Declared walk-in is ${money(variance)} more than the till recorded (${money(check.declared)} declared, ${money(check.counter)} through the POS) — sales taken without going through the till.`
      : `The till recorded ${money(Math.abs(variance))} more than was declared (${money(check.counter)} through the POS, ${money(check.declared)} declared) — the declared figure may be short.`;
  });

  protected readonly reconciliationIcon = computed<PbIconName>(() => {
    const check = this.reconciliation();

    if (check === undefined || check.declared === null) {
      return 'info';
    }

    return Math.abs(check.variance ?? 0) < 0.01 ? 'ok' : 'warning';
  });

  /**
   * The reconciliation line's tone.
   *
   * Uses the design system's semantic tones rather than Material's containers. The matching state was
   * `tertiary-container`, which on this app's rose palette is *pink* — so "declared matches the till
   * exactly" and "the declared figure may be short" were a pink panel and a red panel, two shades
   * apart, for good news and bad. Success has to be green somewhere outside the brand to read as
   * success at all.
   */
  protected readonly reconciliationClass = computed(() => {
    const base = 'mt-pb-4 flex items-start gap-pb-3 rounded-pb-lg border p-pb-3';
    const check = this.reconciliation();

    if (check === undefined || check.declared === null) {
      return `${base} pb-tone-neutral`;
    }

    return Math.abs(check.variance ?? 0) < 0.01
      ? `${base} pb-tone-success`
      : `${base} pb-tone-warning`;
  });

  /**
   * Movements per day, by kind.
   *
   * **Lines rather than four overlapping areas.** The same four series, the same numbers — but four
   * translucent fills stacked on one plot produce a region whose colour belongs to none of them, and
   * no single series can be followed through it. With four things to compare over time, the line *is*
   * the mark and the fill was only ever decoration that got in the way.
   *
   * Not stacked, for the reason the caption gives: these are counts of different kinds of movement,
   * and stacking them would assert a total that answers no question anyone asks.
   */
  protected readonly movementChart = computed<ChartSpec>(() => {
    const points = this.data().charts.stockMovement;

    return {
      type: 'line',
      height: 300,
      labels: points.map((point) => shortDate(point.date)),
      series: [
        { name: 'Purchased', data: points.map((point) => point.purchased) },
        { name: 'Consumed', data: points.map((point) => point.consumed) },
        { name: 'Transferred', data: points.map((point) => point.transferred) },
        { name: 'Adjusted', data: points.map((point) => point.adjusted) },
      ],
    };
  });

  protected readonly spendChart = computed<ChartSpec>(() => {
    const points = this.data().charts.purchaseSpend;

    return {
      type: 'bar',
      height: 280,
      valuePrefix: '₹',
      labels: points.map((point) => shortDate(point.date)),
      series: [{ name: 'Spend', data: points.map((point) => point.amount) }],
    };
  });

  /**
   * Stock value by category. Null when nothing is priced, so the card explains itself instead of
   * drawing zero.
   *
   * **A ranked bar, not a donut.** `InventoryCategory` has twenty members, and a donut cannot carry
   * twenty slices — there is no set of twenty hues a reader can tell apart, so past a handful the
   * chart stops being readable no matter how the colours are chosen. It was already drawing five
   * categories in three colours, three of them identical, because the palette silently repeated.
   *
   * A ranked horizontal bar answers the same question better at any category count: it needs **one**
   * colour, the labels sit beside their own bars instead of in a legend to be matched up, and the
   * ordering does the comparison a donut asks you to do by eye. The total the donut carried in its
   * centre has not been lost — it is the "Inventory value" tile at the top of the page.
   */
  protected readonly valueChart = computed<ChartSpec | null>(() => {
    const slices = this.data().charts.valueByCategory;

    if (slices.length === 0) {
      return null;
    }

    return {
      type: 'bar',
      horizontal: true,
      height: 300,
      valuePrefix: '₹',
      labels: slices.map((slice) => slice.label),
      series: [{ name: 'Value', data: slices.map((slice) => slice.value) }],
    };
  });

  protected readonly topIngredientsChart = computed<ChartSpec | null>(() => {
    const ingredients = this.data().topIngredients ?? [];

    if (ingredients.length === 0) {
      return null;
    }

    return {
      type: 'bar',
      horizontal: true,
      height: 280,
      valueSuffix: '×',
      labels: ingredients.map((ingredient) => ingredient.itemName),
      series: [{ name: 'Times used', data: ingredients.map((ingredient) => ingredient.timesUsed) }],
    };
  });
}
