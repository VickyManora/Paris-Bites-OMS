import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import type { PbIconName } from '../icon/icon-registry';

/**
 * Semantic meaning, not a colour.
 *
 * Callers pass what the state *means* and the design system decides how that looks. A caller
 * passing `'green'` would be making a design decision at the call site, which is how five screens
 * ended up with five different greens.
 */
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

/** Default icon per tone, so a badge is never colour-only without the caller thinking about it. */
const TONE_ICON: Readonly<Record<BadgeTone, PbIconName>> = {
  neutral: 'dash',
  info: 'info',
  success: 'ok',
  warning: 'warning',
  danger: 'critical',
  accent: 'featured',
};

const TONE_CLASS: Readonly<Record<BadgeTone, string>> = {
  neutral: 'pb-tone-neutral',
  info: 'pb-tone-info',
  success: 'pb-tone-success',
  warning: 'pb-tone-warning',
  danger: 'pb-tone-danger',
  accent: 'pb-tone-accent',
};

/**
 * A state, rendered as a compact pill.
 *
 * **Why this component exists.** The same pill was hand-built in at least five places — transfer
 * detail, the dashboard tasks panel, the admin dashboard, the activity feed and the POS order
 * model — each with its own class string. They had drifted: different padding, different radii,
 * and one of them colour-only. This is the single definition.
 *
 * **Colour is never the only signal.** An icon shows by default, because roughly one man in
 * twelve cannot separate the success and danger hues, and a status that reads identically to
 * those users is not a status. `[showIcon]="false"` is available for a dense table where the text
 * alone is unambiguous — a deliberate choice at the call site rather than the default.
 *
 * ```html
 * <pb-status-badge tone="success" label="Paid" />
 * <pb-status-badge tone="warning" label="Awaiting payment" icon="schedule" />
 * <pb-status-badge tone="neutral" label="Draft" [pill]="false" />
 * ```
 */
@Component({
  selector: 'pb-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: { class: 'inline-flex' },
  template: `
    <span [class]="classes()">
      @if (showIcon()) {
        <!--
          14px, and the stroke a shade heavier than the app default.

          A 1.75 stroke inside a 13px pill reads as grey rather than as a mark — the glyph is small
          enough that the stroke is most of what there is of it. Two is right at this size and only
          at this size, which is why it is set here rather than in the icon component.
        -->
        <pb-icon [name]="resolvedIcon()" [size]="14" [strokeWidth]="2" />
      }
      <span class="truncate">{{ label() }}</span>
    </span>
  `,
})
export class StatusBadgeComponent {
  readonly tone = input<BadgeTone>('neutral');
  readonly label = input.required<string>();

  /** Overrides the tone's default icon. */
  readonly icon = input<PbIconName | null>(null);

  /**
   * Off only where the label is unambiguous on its own — a dense table, say. Leaving it on is the
   * accessible default.
   */
  readonly showIcon = input(true);

  /** Fully rounded by default; square-ish reads better inline in a sentence. */
  readonly pill = input(true);

  protected readonly resolvedIcon = computed(() => this.icon() ?? TONE_ICON[this.tone()]);

  protected readonly classes = computed(() => {
    const base = `pb-badge ${TONE_CLASS[this.tone()]}`;
    return this.pill() ? `${base} pb-badge-pill` : base;
  });
}
