import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { MATERIAL_CORE_IMPORTS } from '../../../../shared/material/material-imports';
import { DashboardSectionComponent } from '../dashboard-section/dashboard-section.component';
import { MetricTileComponent } from '../metric-tile/metric-tile.component';
import { LowStockPanelComponent } from '../low-stock-panel/low-stock-panel.component';
import { previousDay, shortDate, type Dashboard } from '../../models/dashboard.model';

/** The consumption banner's content, or `null` when every day is accounted for. */
interface ConsumptionPrompt {
  readonly tone: 'info' | 'warning';
  readonly message: string;
  readonly action: string;
}

/**
 * The person running the cart: what needs restocking, and what they still owe a record of.
 *
 * No money anywhere. Stock valuation and revenue are not merely hidden from this layout — the API
 * never sends them to a Store Manager, so there is nothing here to leak.
 *
 * ## Deliberately three things, and not the fourth
 *
 * This layout used to carry a task hero, five tiles, a tasks panel, an activity feed and two charts.
 * All of it was true and almost none of it was *actionable by this role*, which is the only test a
 * dashboard for the counter should pass. A movement chart over thirty days answers a question about
 * the business; the person on the cart is asking "what do I need, and what have I not written down".
 *
 * So: the record they owe, the stock that is short, and the list of which items. The activity feed
 * and the charts are gone rather than collapsed — a panel nobody acts on still costs the scroll that
 * hides the panel below it. The tasks panel is gone because the banner and the three tiles now say
 * everything it said, and saying it twice on one screen teaches people to skim both.
 *
 * The admin layout keeps all of it; see `AdminDashboardComponent`.
 */
@Component({
  selector: 'pb-manager-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DashboardSectionComponent,
    MetricTileComponent,
    LowStockPanelComponent,
    IconComponent,
    ...MATERIAL_CORE_IMPORTS,
  ],
  template: `
    <div class="flex flex-col gap-pb-7">
      <!--
        ======================== THE RECORD THEY OWE ========================
        First on the page, above the stock figures, and the only element here that can be absent.

        Placed at the very top because it is the one thing on this screen that gets *worse* while it
        is ignored: stock that is low stays low and is still there to see tomorrow, but nobody
        remembers what the cart used two days ago. It is a prompt to act, and a prompt below three
        tiles is a prompt people scroll past.
      -->
      @if (consumptionPrompt(); as prompt) {
        <div
          class="flex flex-col items-start gap-pb-3 rounded-pb-lg border p-pb-4 sm:flex-row sm:items-center"
          [class]="prompt.tone === 'warning' ? 'pb-tone-warning' : 'pb-tone-info'"
        >
          <pb-icon name="consumption" [size]="18" />
          <span class="flex-1 text-pb-body">{{ prompt.message }}</span>
          <a matButton="filled" [routerLink]="['/consumption']">
            <pb-icon name="add" [size]="16" class="mr-pb-1" />
            {{ prompt.action }}
          </a>
        </div>
      }

      <!--
        ============================ WHAT IS SHORT ============================
        Filled tiles: in this band the colour *is* the content — a red "out of stock" is the message,
        not decoration on it.
      -->
      <div class="grid gap-pb-4 sm:grid-cols-3">
        <pb-metric-tile
          filled
          label="Out of stock"
          [value]="data().lowStock.outOfStock"
          [caption]="outOfStockCaption()"
          icon="lowStock"
          [tone]="outOfStockTone()"
        />
        <pb-metric-tile
          filled
          label="Needs restocking"
          [value]="lowOnly()"
          [caption]="restockCaption()"
          icon="inventory"
          [tone]="restockTone()"
        />
        <pb-metric-tile
          filled
          label="Awaiting receipt"
          [value]="data().pendingRequests.awaitingReceipt"
          [caption]="receiptCaption()"
          icon="transfers"
          [tone]="receiptTone()"
        />
      </div>

      <!--
        ============================== THE ITEMS ==============================
        The substance of the page. The tiles above are counts of this list, so it carries no
        summary of its own.
      -->
      <pb-dashboard-section
        title="Items to restock"
        icon="inventory"
        [hint]="restockHint()"
      >
        <pb-low-stock-panel [items]="data().lowStock.items" />
      </pb-dashboard-section>
    </div>
  `,
})
export class ManagerDashboardComponent {
  readonly data = input.required<Dashboard>();

  /**
   * What the banner says, chosen by *which* day is missing rather than by how many.
   *
   * Three cases, in descending urgency:
   *
   * 1. **Yesterday has no sheet.** The prompt names it, because "yesterday" is a day the reader can
   *    still reconstruct from memory and is the one they are most likely to have simply forgotten
   *    on their way out. Any older gaps are appended as a count — they matter, but they are not
   *    what today's action is.
   * 2. **Only older days are missing.** Worth showing and not worth the same words: naming a date
   *    three weeks back as though it were this morning's chore overstates what can still be done
   *    about it honestly.
   * 3. **Only today.** An `info` nudge, not a warning. The sheet is written up as the day is
   *    worked, so an empty one at 11am is normal and flagging it amber would train the reader to
   *    ignore the banner on the days it is amber for a real reason.
   *
   * Returns `null` when nothing is outstanding, so the banner disappears entirely rather than
   * congratulating anyone. A dashboard element that is always present is one nobody reads.
   */
  protected readonly consumptionPrompt = computed<ConsumptionPrompt | null>(() => {
    const missed = this.data().unrecordedConsumptionDays ?? [];
    // Newest first from the API, so the head is the most recent gap.
    const newest = missed[0];
    const yesterday = previousDay(this.data().forDate);
    const older = missed.length - 1;

    if (newest === yesterday) {
      return {
        tone: 'warning',
        message:
          older === 0
            ? "Yesterday's consumption has not been recorded. Please add it."
            : `Yesterday's consumption has not been recorded, and ${String(older)} earlier ${
                older === 1 ? 'day is' : 'days are'
              } also missing.`,
        action: "Add yesterday's",
      };
    }

    if (newest !== undefined) {
      return {
        tone: 'warning',
        message:
          missed.length === 1
            ? `Consumption was never recorded for ${shortDate(newest)}.`
            : `Consumption is missing for ${String(missed.length)} days, the most recent being ${shortDate(newest)}.`,
        action: 'Record consumption',
      };
    }

    if ((this.data().todaysConsumption?.sheets ?? 0) === 0) {
      return {
        tone: 'info',
        message: 'No consumption recorded for today yet.',
        action: 'Record consumption',
      };
    }

    return null;
  });

  /**
   * Items below their reorder level but not yet at zero.
   *
   * The API's `needsRestocking` counts everything short, out-of-stock included. Showing both
   * figures unmodified would put the same item in two tiles and make them appear to sum to more
   * than the list beneath them — so the zero ones are subtracted out and this tile means "low, but
   * you can still sell it".
   */
  protected readonly lowOnly = computed(() =>
    Math.max(0, this.data().lowStock.needsRestocking - this.data().lowStock.outOfStock),
  );

  protected readonly outOfStockTone = computed<'success' | 'danger'>(() =>
    this.data().lowStock.outOfStock > 0 ? 'danger' : 'success',
  );

  protected readonly outOfStockCaption = computed(() =>
    this.data().lowStock.outOfStock === 0 ? 'every item has stock' : 'cannot be sold today',
  );

  protected readonly restockTone = computed<'neutral' | 'warning'>(() =>
    this.lowOnly() > 0 ? 'warning' : 'neutral',
  );

  protected readonly restockCaption = computed(() =>
    this.lowOnly() === 0 ? 'nothing running low' : 'at or below reorder level',
  );

  protected readonly receiptTone = computed<'neutral' | 'info'>(() =>
    this.data().pendingRequests.awaitingReceipt > 0 ? 'info' : 'neutral',
  );

  protected readonly receiptCaption = computed(() =>
    this.data().pendingRequests.awaitingReceipt === 0
      ? 'nothing in transit'
      : 'transfers to confirm',
  );

  /** Names the list's state, so the section header is useful when the list is empty. */
  protected readonly restockHint = computed(() => {
    const stock = this.data().lowStock;

    if (stock.needsRestocking === 0) {
      return 'Everything is above its reorder level';
    }

    return stock.outOfStock > 0
      ? `${String(stock.outOfStock)} at zero, ${String(this.lowOnly())} running low`
      : 'At or below their reorder level';
  });
}
