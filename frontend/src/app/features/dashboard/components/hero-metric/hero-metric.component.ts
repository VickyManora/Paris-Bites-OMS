import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  ChartComponent,
  type ChartSpec,
} from '../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import type { PbIconName } from '../../../../shared/components/icon/icon-registry';

/**
 * The one figure the dashboard leads with.
 *
 * **Exactly one of these per screen.** A dashboard with three hero numbers has no hero number — the
 * whole value of the treatment is that it answers "if you read one thing, read this", and a second
 * one at the same size makes that a question again. Everything else on the page is a primary tile or
 * a strip reading.
 *
 * ## Three deliberate details
 *
 * **The value uses proportional figures, not `tabular-nums`.** Equal-width digits are for columns
 * that must align vertically. At 48px they make a number like `₹12,100` look gappy and mechanical,
 * because every `1` is padded to the width of a `0`. The strip readings below still use tabular
 * figures, which is the case they are for.
 *
 * **The sparkline has no axes, grid or tooltip.** It is a shape, not a plot: it says "rising",
 * "flat", "spiky" at a glance and nothing more precise. Everything it could be interrogated for is
 * already stated as text beside it, or drawn properly in the section's own trend chart — so adding
 * chrome would cost more than it explains. It is also `aria-hidden`, since a sighted-only shape that
 * duplicates the caption is noise to a screen reader.
 *
 * **The sparkline is optional and absent by default.** It renders only where a real series exists.
 * A flat line drawn through no data is not a subtle trend, it is a fabricated one.
 */
@Component({
  selector: 'pb-hero-metric',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartComponent, IconComponent],
  host: {
    class: 'block',
  },
  template: `
    <!--
      The one card on the page wearing the brand gold.

      Money is what this figure is, and gold is the design system's colour for money — so the hero
      is tinted where every other card is white. That is also what makes it the hero without needing
      to be enormous: on a page of white cards the single warm one is found before any of them is
      read, which no amount of extra type size achieves on its own.

      The gold is the *surface* step, not the brand '#c89b5b' — a 2.5:1 fill behind text would be
      unreadable. See the contrast note in palette.css.
    -->
    <article
      class="flex h-full flex-col overflow-hidden rounded-pb-xl border border-pb-accent-border bg-pb-accent-surface p-pb-4 sm:p-pb-5"
    >
      <div class="flex items-start justify-between gap-pb-3">
        <div class="min-w-0">
          <p class="m-0 text-pb-overline uppercase text-pb-text-secondary">
            {{ label() }}
          </p>

          <!--
            'leading-none' so the 52px figure does not carry 20px of invisible line box above and
            below it, which is what makes a large number look like it is floating in its card rather
            than sitting at the top of it.

            Negative tracking at this size for the reason the type scale gives: default letter
            spacing on a 52px figure reads loose, and tightening it is most of what separates a
            considered number from a default one.
          -->
          <p class="m-0 mt-pb-3 truncate leading-none" [class]="valueClass()">
            {{ value() }}
          </p>

          @if (caption()) {
            <p class="m-0 mt-pb-3 text-pb-body text-pb-text-secondary">{{ caption() }}</p>
          }
        </div>

        @if (icon(); as name) {
          <span
            class="grid h-11 w-11 shrink-0 place-items-center rounded-pb-lg bg-pb-gold text-pb-text-inverse"
            aria-hidden="true"
          >
            <pb-icon [name]="name" [size]="20" [strokeWidth]="2" />
          </span>
        }
      </div>

      <!--
        Anything the figure needs beneath it — in practice, a way to go and enter the number when there
        isn't one yet.

        A direct child of the flex column, so the caller can pin it with 'mt-auto'. That is what stops
        this being a large void on the days the figure has nothing to report: the card is sized to hold
        a 44px number and a sparkline, and "—" alone left most of it empty at the bottom, which reads as
        something failing to load. Pushed to the baseline instead, the gap above becomes deliberate
        space between the headline and its call to action.

        Unwrapped for the same reason: a wrapper would need ':empty' to avoid leaving its margin behind
        when nothing is projected, and ':empty' against a slot Angular fills with comment nodes is the
        kind of thing that works until it doesn't.
      -->
      <ng-content />

      @if (trend(); as spec) {
        <!--
          'mt-auto' pins the shape to the bottom of the card, so it acts as a base the figure sits
          above rather than as a third stacked element. '-mx-*' lets it bleed to the card's edges,
          which is what stops a 56px sparkline reading as a tiny chart in a large box.
        -->
        <div class="-mx-pb-4 -mb-pb-4 mt-auto pt-pb-5 sm:-mx-pb-5 sm:-mb-pb-5" aria-hidden="true">
          <pb-chart [spec]="spec" />
        </div>
      }
    </article>
  `,
})
export class HeroMetricComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly caption = input<string>('');
  readonly icon = input<PbIconName | null>(null);

  /**
   * The series behind the figure, if there is one. Pass an empty array for no sparkline.
   *
   * Values only — the shape carries no dates, because it has no axis to put them on.
   */
  readonly series = input<readonly number[]>([]);

  /**
   * Whether the figure is the "nothing here yet" placeholder rather than a value.
   *
   * The page passes an em dash when a day has not been entered — deliberately, because a confident
   * ₹0.00 on a Saturday evening reads as "we sold nothing today" rather than "nobody has typed it
   * in". At 52px semibold, though, an em dash is a solid black bar four characters wide: it looks
   * like a redaction, and it is the loudest mark on the page for the one card with no news.
   *
   * So the placeholder keeps the slot without shouting — smaller, in the muted ink the caption
   * beneath it uses. The value is unchanged; only its weight is.
   */
  protected readonly isPlaceholder = computed(() => String(this.value()).trim() === '—');

  protected readonly valueClass = computed(() =>
    this.isPlaceholder()
      ? 'text-[2rem] font-medium text-pb-text-muted'
      : 'text-[3.25rem] font-semibold tracking-[-0.03em] text-pb-text',
  );

  /**
   * Two points is not a trend, it is a pair of numbers, and a single point draws nothing at all.
   * Below three the shape would imply a direction the data cannot support, so it is not drawn.
   */
  protected readonly trend = computed<ChartSpec | null>(() => {
    const data = this.series();

    if (data.length < 3) {
      return null;
    }

    return {
      type: 'area',
      sparkline: true,
      height: 76,
      series: [{ name: this.label(), data: [...data] }],
    };
  });
}
