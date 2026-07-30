import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { MATERIAL_CORE_IMPORTS } from '../../material/material-imports';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

/**
 * General-purpose content container.
 *
 * Built on Material's surface tokens rather than wrapping `MatCard`: it needs
 * optional header, action and footer regions with consistent dividers, and
 * expressing that through `mat-card`'s fixed slots means fighting its internal
 * padding on every use. Colours still come from `--mat-sys-*`, so it themes with
 * everything else.
 *
 * Regions are projected content, so the card owns layout and never behaviour:
 *
 * ```html
 * <pb-card title="Low stock" subtitle="Needs reordering">
 *   <button slot="actions" matButton>View all</button>
 *   <p>…body…</p>
 *   <span slot="footer">Updated 5 minutes ago</span>
 * </pb-card>
 * ```
 */
@Component({
  selector: 'pb-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...MATERIAL_CORE_IMPORTS],
  host: {
    class: 'block',
  },
  template: `
    <!--
      The surface class is built as a string, and that is a fix rather than a style.

      This was four '[class.x]' bindings, two of which were Tailwind variants — '[class.hover:shadow-md]'
      and '[class.transition-shadow]'. A variant cannot be a binding key: Angular writes the literal
      token 'hover:shadow-md' onto the element, Tailwind's scanner never saw it used in a way it
      generates CSS for, and the rule did not exist. **So 'interactive' has never done anything
      visible** — every card that asked to look pressable rendered identically to one that did not.
      The same trap is documented in 'pb-data-table', which builds its row class as a string for
      exactly this reason.
    -->
    <section [class]="surfaceClass()">
      @if (title() || subtitle() || icon()) {
        <header [class]="headerClass()">
          <div class="flex min-w-0 items-start gap-3">
            @if (icon()) {
              <mat-icon class="mt-0.5 shrink-0 text-primary" aria-hidden="true">
                {{ icon() }}
              </mat-icon>
            }

            <div class="min-w-0">
              @if (title()) {
                <h3 [class]="titleClass()">{{ title() }}</h3>
              }
              @if (subtitle()) {
                <p [class]="subtitleClass()">{{ subtitle() }}</p>
              }
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <ng-content select="[slot=actions]" />
          </div>
        </header>
      }

      <!-- 'flex-1' so a card in a grid row stretches to match its siblings
           instead of leaving a ragged bottom edge. -->
      <div class="flex-1 min-w-0" [class]="bodyPadding()">
        <ng-content />
      </div>

      <ng-content select="[slot=footer-wrapper]" />
    </section>
  `,
})
export class CardComponent {
  readonly title = input<string>('');
  readonly subtitle = input<string>('');
  readonly icon = input<string>('');
  readonly padding = input<CardPadding>('md');
  /*
   * `booleanAttribute` on all three, so `<pb-card dense>` works as well as `[dense]="true"`.
   *
   * A signal input does no attribute coercion of its own: a bare attribute hands the component the
   * empty string, which is not a boolean and fails the template type check. Every consumer would
   * otherwise have to write the long form for a flag, which is not how a flag reads.
   */
  readonly elevated = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Adds hover affordances. Set only when the whole card is clickable. */
  readonly interactive = input<boolean, unknown>(false, { transform: booleanAttribute });

  /**
   * The card's own frame.
   *
   * An interactive card lifts 2px and deepens its shadow on hover — the same figure the POS product
   * card and the dashboard tiles use, so "this responds to you" is one movement across the app
   * rather than three. Two pixels rather than six: a card that leaps under the pointer reads as
   * cheap, and on a grid of them the whole page twitches as the cursor crosses it.
   *
   * `motion-reduce` cancels the transform but keeps the shadow, so the affordance survives for
   * someone who has turned movement off.
   */
  protected readonly surfaceClass = computed(() => {
    const base =
      'flex h-full flex-col overflow-hidden rounded-pb-lg border border-pb-border bg-pb-surface';

    if (!this.interactive()) {
      return this.elevated() ? `${base} shadow-pb-xs` : base;
    }

    return (
      `${base} cursor-pointer shadow-pb-xs transition-[box-shadow,transform,border-color] ` +
      'duration-pb-fast ease-pb-out hover:-translate-y-0.5 hover:border-pb-border-strong ' +
      'hover:shadow-pb-md focus-within:border-pb-border-strong focus-within:shadow-pb-md ' +
      'motion-reduce:transition-none motion-reduce:hover:translate-y-0'
    );
  });

  /**
   * A quieter, tighter header — for a card that sits *inside* a titled section.
   *
   * Default `false`, so every existing call site renders exactly as before.
   *
   * ## Why this variant has to exist
   *
   * The default header's type is not a design decision, it is an accident that has to be preserved
   * until it is fixed deliberately. `mat.theme()` in `styles.scss` emits Material's *tokens* but not
   * its typography *classes*, so `text-pb-subtitle` and `text-pb-caption` match no rule anywhere in the
   * app — and because Tailwind's preflight is deliberately not loaded, the bare `<h3>` and `<p>`
   * beneath them fall back to the browser's own styles. The card title measures 19px/700 and the
   * subtitle 16px/400 for that reason, and nothing in the codebase asked for either.
   *
   * That is survivable on a page where the card is the outermost thing. It is not survivable inside a
   * dashboard section, where a 19px bold card title is *louder than the 18px section heading above
   * it* and the hierarchy reads upside down. A 121px-tall header before any content does not help.
   *
   * So `dense` states the type explicitly from the `pb-` scale — subtitle-weight title, caption
   * subtitle, tighter padding, and no divider, since inside a section the spacing already separates
   * the header from the body. Fixing the default means either including Material's typography
   * hierarchy or replacing every `mat-*` class in the app, which is a change to every screen and
   * belongs in its own piece of work.
   */
  readonly dense = input<boolean, unknown>(false, { transform: booleanAttribute });

  protected readonly headerClass = computed(() => {
    const base = 'flex items-start justify-between gap-3';
    return this.dense()
      ? `${base} px-pb-4 pb-pb-2 pt-pb-4`
      : `${base} border-b border-outline-variant px-4 py-3`;
  });

  protected readonly titleClass = computed(() =>
    this.dense() ? 'm-0 truncate text-pb-subtitle text-on-surface' : 'text-pb-subtitle truncate',
  );

  protected readonly subtitleClass = computed(() =>
    this.dense()
      ? 'm-0 mt-0.5 text-pb-caption text-on-surface-variant'
      : 'text-pb-caption mt-0.5 text-on-surface-variant',
  );

  /**
   * `none` exists for cards whose body is a table or list that must reach the
   * card's edges — padding there would leave an odd gutter beside row dividers.
   */
  protected readonly bodyPadding = computed(() => {
    switch (this.padding()) {
      case 'none':
        return '';
      case 'sm':
        return 'p-3';
      case 'lg':
        return 'p-6';
      case 'md':
        return 'p-4';
    }
  });
}
