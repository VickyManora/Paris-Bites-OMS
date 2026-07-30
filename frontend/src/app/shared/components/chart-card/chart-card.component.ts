import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ChartComponent, type ChartSpec } from '../chart/chart.component';
import { EmptyStateComponent } from '../empty-state/empty-state.component';
import { MetricBadgeComponent, type MetricDirection } from '../metric-badge/metric-badge.component';
import { SkeletonComponent } from '../skeleton/skeleton.component';

/**
 * A chart with its title, headline figure and states.
 *
 * **What it adds over `<pb-card><pb-chart /></pb-card>`.** Every chart on a dashboard needs the
 * same four things around it — a title, an optional headline number with its trend, a loading
 * placeholder shaped like a chart, and an empty state for "no data in this range". Assembled by
 * hand at each call site, those four drift: one chart shows a spinner while its neighbour shows
 * nothing, one collapses to zero height while loading and shoves the page around.
 *
 * The loading state is a **skeleton, not a spinner**, and it reserves the chart's real height.
 * That is the whole reason this wrapper is worth having: the tile does not resize when data
 * arrives, so a dashboard of six charts settles once instead of six times.
 *
 * Deliberately built *on* `pb-chart` rather than replacing it — a page that needs a bare chart in
 * some other frame still uses that directly.
 *
 * ```html
 * <pb-chart-card
 *   title="Revenue"
 *   subtitle="Last 30 days"
 *   headline="₹1,24,500"
 *   delta="+12.4%"
 *   direction="up"
 *   positiveWhen="up"
 *   [spec]="revenueSpec()"
 *   [loading]="loading()"
 * />
 * ```
 */
@Component({
  selector: 'pb-chart-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartComponent, EmptyStateComponent, MetricBadgeComponent, SkeletonComponent],
  host: { class: 'block' },
  template: `
    <section class="pb-surface flex h-full flex-col">
      <header class="flex items-start justify-between gap-pb-3 px-pb-4 pt-pb-4">
        <div class="min-w-0">
          <h3 class="m-0 truncate text-pb-title text-on-surface">{{ title() }}</h3>
          @if (subtitle()) {
            <p class="m-0 mt-0.5 truncate text-pb-caption text-on-surface-variant">
              {{ subtitle() }}
            </p>
          }
        </div>

        <!-- Actions sit outside the title block so a long title truncates rather than
             squeezing the button. -->
        <ng-content select="[slot=actions]" />
      </header>

      @if (headline() || delta()) {
        <div class="flex flex-wrap items-baseline gap-pb-3 px-pb-4 pt-pb-3">
          @if (headline()) {
            <p class="m-0 text-pb-heading tabular-nums text-on-surface">{{ headline() }}</p>
          }
          @if (delta()) {
            <pb-metric-badge
              [value]="delta()"
              [direction]="direction()"
              [positiveWhen]="positiveWhen()"
              [caption]="deltaCaption()"
            />
          }
        </div>
      }

      <div class="min-w-0 flex-1 p-pb-4">
        @if (loading()) {
          <!--
            One announcement for the region, not one per bar. The skeleton itself is
            aria-hidden, so this wrapper is what a screen reader hears.
          -->
          <div role="status" aria-live="polite" aria-busy="true">
            <span class="sr-only">Loading {{ title() }}</span>
            <!-- Reserves the chart's real height so nothing reflows when data lands. -->
            <pb-skeleton variant="block" [height]="chartHeight()" />
          </div>
        } @else if (isEmpty()) {
          <pb-empty-state icon="show_chart" [title]="emptyTitle()" [message]="emptyMessage()" />
        } @else {
          <div class="pb-fade-in">
            <pb-chart [spec]="spec()" />
          </div>
        }
      </div>

      <ng-content select="[slot=footer]" />
    </section>
  `,
})
export class ChartCardComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');

  /** The one number this chart is about, already formatted. */
  readonly headline = input<string>('');

  /** Change against the comparison period, already formatted. */
  readonly delta = input<string>('');
  readonly direction = input<MetricDirection>('flat');
  /** Which direction is good for this metric — see `pb-metric-badge`. */
  readonly positiveWhen = input<'up' | 'down'>('up');
  readonly deltaCaption = input<string>('');

  readonly spec = input.required<ChartSpec>();

  readonly loading = input(false);

  /**
   * Whether there is nothing to plot.
   *
   * An input rather than derived from `spec`, because only the caller knows the difference between
   * "no data in this range" and "a series that is legitimately all zeroes" — and a chart of real
   * zeroes should be drawn, not hidden behind an empty state.
   */
  readonly isEmpty = input(false);

  readonly emptyTitle = input<string>('Nothing to show yet');
  readonly emptyMessage = input<string>('');

  /** Matched to the chart's own height so the skeleton reserves the same space. */
  readonly chartHeight = input<string>('16rem');
}
