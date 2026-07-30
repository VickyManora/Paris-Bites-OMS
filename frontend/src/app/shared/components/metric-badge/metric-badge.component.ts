import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MATERIAL_CORE_IMPORTS } from '../../material/material-imports';

/** Which way the number moved. `flat` renders neutral, with no arrow. */
export type MetricDirection = 'up' | 'down' | 'flat';

/**
 * A change in a number, with its direction coloured by whether that direction is *good*.
 *
 * **Why `positiveWhen` is required rather than defaulted.** Rising revenue is good; rising wastage
 * is not. A badge that always painted "up" green would be confidently wrong half the time, and the
 * half it was wrong about is the half someone needed to notice. There is no safe default, so the
 * caller states which direction is favourable and the component colours accordingly.
 *
 * This is the same rule `pb-stat-card` applies to its own delta; extracted here for the places
 * that want the pill without a whole tile — a table cell, a chart caption, a list row.
 *
 * **Colour is never the only signal.** The arrow carries the direction and the text carries the
 * amount, so the badge still reads correctly in greyscale.
 *
 * ```html
 * <pb-metric-badge value="+12.4%" direction="up" positiveWhen="up" />
 * <pb-metric-badge value="+8 kg"  direction="up" positiveWhen="down" />
 * ```
 */
@Component({
  selector: 'pb-metric-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...MATERIAL_CORE_IMPORTS],
  host: { class: 'inline-flex' },
  template: `
    <span [class]="classes()" [attr.aria-label]="ariaLabel()">
      @if (direction() !== 'flat') {
        <mat-icon
          class="!h-[--size-pb-icon-xs] !w-[--size-pb-icon-xs] !text-[length:--size-pb-icon-xs] shrink-0"
          aria-hidden="true"
        >
          {{ direction() === 'up' ? 'arrow_upward' : 'arrow_downward' }}
        </mat-icon>
      }
      <span class="tabular-nums">{{ value() }}</span>
      @if (caption()) {
        <span class="font-normal opacity-70">{{ caption() }}</span>
      }
    </span>
  `,
})
export class MetricBadgeComponent {
  /** The change as already-formatted text — "+12.4%", "−₹340". Formatting is the caller's. */
  readonly value = input.required<string>();

  readonly direction = input<MetricDirection>('flat');

  /** Which direction is good for *this* metric. No default: see the class comment. */
  readonly positiveWhen = input.required<'up' | 'down'>();

  /** Optional trailing context, e.g. "vs last week". */
  readonly caption = input<string>('');

  private readonly tone = computed<'success' | 'danger' | 'neutral'>(() => {
    const dir = this.direction();
    if (dir === 'flat') return 'neutral';
    return dir === this.positiveWhen() ? 'success' : 'danger';
  });

  protected readonly classes = computed(() => `pb-badge pb-badge-pill pb-tone-${this.tone()}`);

  /**
   * Spells out the judgement for a screen reader.
   *
   * The arrow and the colour say "this is bad" to a sighted user; without this, a screen reader
   * would read only "+8 kg" and lose the entire point of the badge.
   */
  protected readonly ariaLabel = computed(() => {
    const dir = this.direction();
    if (dir === 'flat') return `${this.value()} — unchanged`;
    const judgement = dir === this.positiveWhen() ? 'favourable' : 'unfavourable';
    return `${this.value()} ${dir === 'up' ? 'increase' : 'decrease'}, ${judgement}`;
  });
}
