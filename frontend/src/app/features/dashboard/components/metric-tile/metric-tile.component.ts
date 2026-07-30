import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import type { PbIconName } from '../../../../shared/components/icon/icon-registry';

/** Which semantic tone a tile carries. `revenue` is the brand gold — money, not a state. */
export type TileTone = 'neutral' | 'revenue' | 'warning' | 'danger' | 'success' | 'info';

/**
 * A primary KPI — the dashboard's middle weight.
 *
 * Between the single hero figure and the strip readings. These are the numbers someone checks on
 * purpose but would not call the headline: what we hold, what we owe, what is running out.
 *
 * ## What makes it a *weight* rather than a different card
 *
 * Three things move together, and all three have to, or the tiles read as the same size in a
 * different colour: the figure is 30px against the hero's 52px and the strip's 18px; the icon sits
 * in a tinted tile rather than loose; and the label leads rather than the number. Changing only the
 * font size is how a "hierarchy" ends up looking like an accident.
 *
 * ## `filled` — the soft coloured background, and why it is opt-in
 *
 * By default `tone` tints **the icon tile only**, never the card. That default is load-bearing: a
 * dashboard where four of five tiles are washed amber has taught its reader to ignore amber, and the
 * tint stops being information the moment it is decoration.
 *
 * `filled` washes the whole card in the tone, and exists for the one band where a tint *is* the
 * content: Business health, whose entire job is "is anything wrong". There, a green card and a red
 * card side by side is the answer, and a row of white cards with small coloured icons is a worse
 * version of the same information.
 *
 * The rule, then: **`filled` where the colour is the message, plain where the number is.** A filled
 * tile in the Sales band would be a decorated statistic; a plain tile in Business health would bury
 * the finding.
 *
 * ## Tone is passed, never inferred
 *
 * The same reason `pb-metric-badge` requires `positiveWhen`: whether a number is bad news depends
 * on what is being counted. A component that guessed would be confidently wrong for half its call
 * sites, and the half it was wrong about is the half someone needed to notice.
 */
@Component({
  selector: 'pb-metric-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: {
    class: 'block',
  },
  template: `
    <article [class]="cardClass()">
      <div class="flex items-start justify-between gap-pb-3">
        <p class="m-0 min-w-0 flex-1 text-pb-caption font-medium" [class]="supportingInk">
          {{ label() }}
        </p>

        @if (icon(); as name) {
          <span [class]="tileClass()" aria-hidden="true">
            <pb-icon [name]="name" [size]="16" />
          </span>
        }
      </div>

      <!--
        'mt-auto' so the figure sits on the card's baseline whatever the label wrapped to. Without it
        a tile whose label runs to two lines puts its number 20px lower than its neighbours, and a row
        of KPIs with numbers at four different heights is the detail that makes a dashboard look
        assembled rather than designed.

        Proportional figures, not tabular: see the note on the hero metric.
      -->
      <div class="mt-auto">
        <p class="m-0 truncate leading-none" [class]="valueClass()">
          {{ value() }}
        </p>

        @if (caption()) {
          <p class="m-0 mt-pb-2 truncate text-pb-caption" [class]="supportingInk">
            {{ caption() }}
          </p>
        }
      </div>
    </article>
  `,
})
export class MetricTileComponent {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly caption = input<string>('');
  readonly icon = input<PbIconName | null>(null);
  readonly tone = input<TileTone>('neutral');

  /**
   * Wash the whole card in the tone. See the note on the class before reaching for it.
   *
   * `booleanAttribute` so `<pb-metric-tile filled>` works as well as `[filled]="true"`, matching
   * `pb-card`'s `dense`. Without it a bare attribute arrives as the empty string, which is truthy
   * and would type-error under strict templates.
   */
  readonly filled = input<boolean, unknown>(false, { transform: booleanAttribute });

  /** Card geometry: white and bordered by default, tone-washed when `filled`. */
  protected readonly cardClass = computed(() => {
    const base = 'flex h-full flex-col gap-pb-3 rounded-pb-lg border p-pb-4';

    if (!this.filled()) {
      return `${base} border-pb-border bg-pb-surface shadow-pb-xs`;
    }

    /*
     * No shadow on a filled tile.
     *
     * The elevation exists to lift a white card off a near-white page; a tinted card is already
     * separated by its own colour, and a shadow under it reads as a second, muddier edge.
     */
    switch (this.tone()) {
      case 'revenue':
        return `${base} border-pb-accent-border bg-pb-accent-surface`;
      case 'warning':
        return `${base} border-pb-warning-border bg-pb-warning-surface`;
      case 'danger':
        return `${base} border-pb-danger-border bg-pb-danger-surface`;
      case 'success':
        return `${base} border-pb-success-border bg-pb-success-surface`;
      case 'info':
        return `${base} border-pb-info-border bg-pb-info-surface`;
      default:
        return `${base} border-pb-border bg-pb-surface-sunken`;
    }
  });

  /**
   * The figure's ink.
   *
   * On a filled tile the value takes the tone's own foreground — the text-safe step, never the base
   * hue. That is what makes the card read as one object rather than as black text dropped onto a
   * colour. On a plain tile it is ordinary ink, because the tint on the icon is doing the signalling.
   */
  /**
   * Whether the value is a phrase rather than a figure.
   *
   * "Not declared" and "Matches" are legitimate values for the reconciliation tile — the state *is*
   * the answer there — but at 30px semibold a two-word phrase fills the card and reads louder than
   * the counts beside it, which are the numbers this band exists to rank. A phrase therefore gets
   * title weight and a number gets figure weight.
   *
   * Detected rather than declared, because the same tile renders both depending on the day: a
   * caller cannot know in advance whether the reconciliation headline will be a variance or a word.
   * Any letter means a phrase — currency symbols, digits, separators and the em dash do not qualify.
   */
  protected readonly isPhrase = computed(() => /\p{L}/u.test(String(this.value())));

  protected readonly valueClass = computed(() => {
    const size = this.isPhrase()
      ? 'text-pb-title font-semibold'
      : 'text-[1.875rem] font-semibold tracking-[-0.02em]';

    return `${size} ${this.valueInk()}`;
  });

  private valueInk(): string {
    if (!this.filled()) {
      return 'text-pb-text';
    }

    switch (this.tone()) {
      case 'revenue':
        return 'text-pb-accent-fg';
      case 'warning':
        return 'text-pb-warning-fg';
      case 'danger':
        return 'text-pb-danger-fg';
      case 'success':
        return 'text-pb-success-fg';
      case 'info':
        return 'text-pb-info-fg';
      default:
        return 'text-pb-text';
    }
  }

  /*
   * Label and caption stay in the neutral secondary ink on every tile, filled or not.
   *
   * Toning all three lines makes the tile a monochrome block in which nothing is emphasised — the
   * point of the wash is to make the *figure* findable, and that only works if its neighbours are
   * quieter than it is. A constant rather than a `computed`, because it does not vary; the previous
   * version branched on `filled` and returned the same class either way.
   */
  protected readonly supportingInk = 'text-pb-text-secondary';

  protected readonly tileClass = computed(() => {
    const base = 'pb-icon-tile !h-8 !w-8 shrink-0';

    /*
     * On a filled card the icon tile loses its own fill and keeps only the glyph. Two nested washes
     * of the same hue is a tile-inside-a-tile that reads as a rendering artefact.
     */
    if (this.filled()) {
      return `${base} !border-transparent !bg-transparent ${this.toneInk()}`;
    }

    switch (this.tone()) {
      case 'revenue':
        return `${base} pb-tone-accent`;
      case 'warning':
        return `${base} pb-tone-warning`;
      case 'danger':
        return `${base} pb-tone-danger`;
      case 'success':
        return `${base} pb-tone-success`;
      case 'info':
        return `${base} pb-tone-info`;
      default:
        return `${base} pb-tone-neutral`;
    }
  });

  private toneInk(): string {
    switch (this.tone()) {
      case 'revenue':
        return 'text-pb-accent-fg';
      case 'warning':
        return 'text-pb-warning-fg';
      case 'danger':
        return 'text-pb-danger-fg';
      case 'success':
        return 'text-pb-success-fg';
      case 'info':
        return 'text-pb-info-fg';
      default:
        return 'text-pb-text-secondary';
    }
  }
}
