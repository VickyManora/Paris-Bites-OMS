import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** What the placeholder is standing in for, which decides its shape. */
export type SkeletonVariant = 'text' | 'heading' | 'block' | 'circle' | 'button';

/**
 * Placeholder shown while content loads.
 *
 * **Why this exists next to `pb-spinner`.** A spinner says "something is happening"; a skeleton
 * says "*this* is arriving, and it will be shaped like this". On a dashboard of eight tiles a
 * single spinner replaces the whole layout and it reflows when data lands. Skeletons hold the
 * layout still, so nothing jumps — which is most of what makes an interface feel fast, more than
 * the actual load time does.
 *
 * Use a spinner for an action whose result you cannot predict (saving, exporting), and skeletons
 * for content whose shape you already know.
 *
 * **Accessibility.** One `role="status"` per *region*, not per placeholder — a card of six
 * skeleton lines announcing six times is worse than silence. So this element is
 * `aria-hidden="true"` and the region around it owns the announcement:
 *
 * ```html
 * <div role="status" aria-live="polite" aria-busy="true">
 *   <span class="sr-only">Loading inventory</span>
 *   <pb-skeleton variant="heading" />
 *   <pb-skeleton [lines]="3" />
 * </div>
 * ```
 */
@Component({
  selector: 'pb-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', 'aria-hidden': 'true' },
  template: `
    @if (variant() === 'text' && lines() > 1) {
      <!--
        A multi-line paragraph, with the last line short.

        Uniform full-width lines read as a table, not prose — the ragged last line is the cue
        that says "text goes here".
      -->
      <div class="flex flex-col gap-pb-2">
        @for (line of lineArray(); track $index) {
          <span
            class="pb-skeleton block"
            [style.height.rem]="0.875"
            [style.width]="$last ? lastLineWidth() : '100%'"
          ></span>
        }
      </div>
    } @else {
      <span
        class="pb-skeleton block"
        [class.rounded-pb-full]="variant() === 'circle'"
        [class.rounded-pb-md]="variant() === 'button'"
        [style.height]="effectiveHeight()"
        [style.width]="effectiveWidth()"
      ></span>
    }
  `,
})
export class SkeletonComponent {
  readonly variant = input<SkeletonVariant>('text');

  /** Only meaningful for `text`. More than one renders a paragraph with a short last line. */
  readonly lines = input(1);

  /** CSS width. Defaults per variant; override for a placeholder of a known size. */
  readonly width = input<string>('');

  /** CSS height. Defaults per variant. */
  readonly height = input<string>('');

  protected readonly lineArray = computed(() => Array.from({ length: Math.max(1, this.lines()) }));

  /**
   * Per-variant defaults, overridable.
   *
   * A skeleton with no size is an invisible skeleton, so every variant has to resolve to real
   * dimensions without the caller supplying any — the common case is `<pb-skeleton />` and it has
   * to look like something.
   */
  private static readonly DEFAULTS: Readonly<
    Record<SkeletonVariant, { readonly w: string; readonly h: string }>
  > = {
    text: { w: '100%', h: '0.875rem' },
    heading: { w: '45%', h: '1.5rem' },
    block: { w: '100%', h: '6rem' },
    circle: { w: '2.5rem', h: '2.5rem' },
    button: { w: '6rem', h: '2.5rem' },
  };

  protected readonly effectiveWidth = computed(
    () => this.width() || SkeletonComponent.DEFAULTS[this.variant()].w,
  );

  protected readonly effectiveHeight = computed(
    () => this.height() || SkeletonComponent.DEFAULTS[this.variant()].h,
  );

  /**
   * The short last line, varied by line count rather than fixed.
   *
   * A constant 60% across every paragraph on a page produces a visible vertical edge, which
   * looks like a layout rather than like text.
   */
  protected readonly lastLineWidth = computed(() => {
    const widths = ['72%', '58%', '64%', '48%'];
    return widths[this.lines() % widths.length] ?? '60%';
  });
}
