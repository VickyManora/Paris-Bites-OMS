import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MATERIAL_CORE_IMPORTS } from '../../material/material-imports';
import { IconComponent } from '../icon/icon.component';
import type { PbIconName } from '../icon/icon-registry';
import { SpinnerComponent } from '../spinner/spinner.component';

export type TrendDirection = 'up' | 'down' | 'flat';

/**
 * KPI tile for dashboards.
 *
 * `positiveWhen` exists because whether "up" is good depends on the metric —
 * rising revenue is good, rising wastage is not. A tile that always coloured up as
 * green would be actively misleading, so the caller states which direction is
 * favourable.
 *
 * Colour is never the only signal: the arrow icon and the delta text carry the same
 * information for anyone who cannot distinguish the two hues.
 */
@Component({
  selector: 'pb-stat-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, SpinnerComponent, ...MATERIAL_CORE_IMPORTS],
  host: {
    class: 'block',
  },
  template: `
    <!--
      A flex column with the figure pinned to the baseline.

      Without it a card whose caption is empty is shorter than its neighbours, and the grid — which
      stretches every cell to the tallest — leaves the difference as a hole *below* the number. On
      the inventory page that was one card of four with 40px of blank beneath its figure, which reads
      as something failing to load rather than as a card with nothing more to say.

      The same fix 'pb-metric-tile' carries on the dashboard, for the same reason.
    -->
    <article
      class="flex h-full flex-col rounded-pb-lg border border-pb-border bg-pb-surface p-pb-4 shadow-pb-xs"
    >
      <div class="flex items-start justify-between gap-pb-3">
        <p class="m-0 min-w-0 flex-1 truncate text-pb-caption font-medium text-pb-text-secondary">
          {{ label() }}
        </p>
        @if (iconName() || icon()) {
          <span class="pb-icon-tile pb-tone-neutral !h-8 !w-8 shrink-0" aria-hidden="true">
            @if (iconName(); as lucide) {
              <pb-icon [name]="lucide" [size]="16" />
            } @else {
              <mat-icon class="!h-4 !w-4 !text-[16px]">{{ icon() }}</mat-icon>
            }
          </span>
        }
      </div>

      @if (loading()) {
        <div class="mt-auto pt-pb-3">
          <pb-spinner size="sm" [padded]="false" [label]="'Loading ' + label()" />
        </div>
      } @else {
        <div class="mt-auto pt-pb-3">
          <p
            class="m-0 truncate text-[1.75rem] font-semibold leading-none tracking-[-0.02em] tabular-nums text-pb-text"
          >
            {{ value() }}
          </p>

          @if (trend() !== 'flat' && delta()) {
            <p class="m-0 mt-pb-2 flex items-center gap-1 text-pb-caption" [class]="trendClass()">
              <pb-icon [name]="trend() === 'up' ? 'trendUp' : 'trendDown'" [size]="14" />
              <span class="truncate">{{ delta() }}</span>
            </p>
          } @else if (caption()) {
            <p class="m-0 mt-pb-2 truncate text-pb-caption text-pb-text-secondary">
              {{ caption() }}
            </p>
          }
        </div>
      }
    </article>
  `,
})
export class StatCardComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  /** Material Symbols name — the original input, kept so no existing call site changes. */
  readonly icon = input<string>('');

  /**
   * A Lucide name from the registry, taking precedence over `icon` when set.
   *
   * Additive rather than a migration, for the reason `pb-empty-state` documents: this component has
   * nine call sites and only six of them are in this brief's scope. Retyping the single `icon` input
   * would either break the other three at compile time or silently change how they look.
   */
  readonly iconName = input<PbIconName | null>(null);
  readonly trend = input<TrendDirection>('flat');
  /** Human-readable change, e.g. "+12% vs last week". */
  readonly delta = input<string>('');
  /**
   * Supporting text with no direction, e.g. "32 items unpriced".
   *
   * Distinct from `delta`, which means "change since the last period" and carries a trend
   * arrow. Plenty of figures need a qualifier without implying a comparison — a stock
   * valuation that covers 8 of 40 items is not up or down on anything, and dressing that
   * caveat as a trend would assert a movement nobody measured.
   *
   * Shown only when there is no trend to display; a tile with both would be reading two
   * different things to the user in the same slot.
   */
  readonly caption = input<string>('');
  /** Which direction counts as good for this metric. */
  readonly positiveWhen = input<TrendDirection>('up');
  readonly loading = input<boolean>(false);

  protected readonly trendClass = computed(() =>
    this.trend() === this.positiveWhen() ? 'text-pb-success-fg' : 'text-pb-danger-fg',
  );
}
