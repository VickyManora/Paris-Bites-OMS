import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import type { PbIconName } from '../../../../shared/components/icon/icon-registry';

/** One reading in a strip. `tone` colours the value, and only when it means something. */
export interface StripMetric {
  readonly label: string;
  readonly value: string | number;
  readonly caption?: string;
  readonly icon?: PbIconName;
  /**
   * Applied to the *value*, for a figure whose level is itself the news — items out of stock,
   * money outstanding. Left unset the value wears normal ink.
   *
   * Deliberately not derived from the number: whether "3" is bad depends entirely on what is being
   * counted, and a component that guessed would be confidently wrong half the time.
   */
  readonly tone?: 'neutral' | 'warning' | 'danger' | 'success';
}

/**
 * A row of secondary readings, sharing one surface.
 *
 * This is the dashboard's lightest of three weights — below the hero figure and below a primary KPI
 * tile — and it exists because most of what was on this page did not deserve a card. Sixteen of the
 * twenty tiles were bordered boxes of identical size holding a label and a small number, which is a
 * lot of ink and a lot of repeated chrome spent flattening the difference between "today's revenue"
 * and "how many invoices were entered".
 *
 * Putting them in one bordered surface divided by hairlines says what the grid of cards could not:
 * these belong together, and none of them is the point of the screen. It also removes fifteen
 * borders, four shadows and a great deal of padding from the page.
 *
 * Data-driven rather than content-projected on purpose. Every one of these is the same shape —
 * label, figure, qualifier — so a template per call site would be fifteen near-identical blocks
 * drifting apart a class at a time. The array is also what makes the responsive column count a
 * single decision instead of a per-site guess.
 */
@Component({
  selector: 'pb-metric-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: {
    class: 'block',
  },
  template: `
    <!--
      'divide-y' with 'sm:divide-y-0 sm:divide-x' flips the rule's axis with the layout: stacked on a
      phone the readings are separated by horizontal rules, in a row they are separated by vertical
      ones. Without the flip a row of items carries underlines that belong to a column.
    -->
    <div
      class="pb-surface grid grid-cols-1 divide-y divide-pb-border-subtle sm:grid-cols-2 sm:divide-x sm:divide-y-0"
      [class]="columnsClass()"
    >
      @for (metric of metrics(); track metric.label) {
        <!--
          'min-w-0' on every cell, because a long caption in a grid track otherwise widens the track
          past its share and pushes the row into a horizontal scroll.
        -->
        <div class="min-w-0 px-pb-4 py-pb-4">
          <div class="flex items-center gap-pb-2">
            @if (metric.icon; as name) {
              <pb-icon [name]="name" [size]="14" class="text-pb-text-muted" />
            }
            <p class="m-0 min-w-0 truncate text-pb-caption font-medium text-pb-text-secondary">
              {{ metric.label }}
            </p>
          </div>

          <!--
            'tabular-nums' here and deliberately *not* on the hero figure or the primary tiles: these
            are small numbers stacked in columns that should line up with each other, which is the one
            case equal-width digits are for.
          -->
          <p
            class="m-0 mt-pb-2 truncate text-pb-title font-semibold tabular-nums"
            [class]="valueClass(metric)"
          >
            {{ metric.value }}
          </p>

          @if (metric.caption) {
            <p class="m-0 mt-0.5 truncate text-pb-caption text-pb-text-muted">
              {{ metric.caption }}
            </p>
          }
        </div>
      }
    </div>
  `,
})
export class MetricStripComponent {
  readonly metrics = input.required<readonly StripMetric[]>();

  /**
   * How many across on a wide screen. Two and three are the only other sensible answers; more than
   * four in a strip makes each cell too narrow for a money figure.
   */
  readonly columns = input<2 | 3 | 4>(4);

  /** Built as a string because Tailwind's `lg:` variants cannot be `[class.x]` binding keys. */
  protected columnsClass(): string {
    switch (this.columns()) {
      case 2:
        return 'lg:grid-cols-2';
      case 3:
        return 'lg:grid-cols-3';
      case 4:
        return 'lg:grid-cols-4';
    }
  }

  /**
   * The value's ink.
   *
   * Tone is carried by the figure rather than by a background wash: a strip of five tinted cells
   * reads as five warnings, and the one cell that actually is a warning stops standing out. Colour
   * is never the only signal here either — the caption beside it says what the number means.
   */
  protected valueClass(metric: StripMetric): string {
    switch (metric.tone) {
      case 'danger':
        return 'text-pb-danger-fg';
      case 'warning':
        return 'text-pb-warning-fg';
      case 'success':
        return 'text-pb-success-fg';
      default:
        return 'text-pb-text';
    }
  }
}
