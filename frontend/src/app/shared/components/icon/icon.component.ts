import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { PB_ICONS, type PbIconName } from './icon-registry';

/**
 * The application's icon.
 *
 * Wraps Lucide so no component imports it directly, which buys three things:
 *
 * 1. **One set of defaults.** Size and stroke weight are decided here, once, rather than in every
 *    call site's class list. The previous `mat-icon` call sites each carried
 *    `!h-5 !w-5 !text-[20px]` — three overrides repeated forty times to undo a default nobody
 *    wanted, and drifted to `!h-4 !w-4 !text-[16px]` in about a third of them.
 * 2. **A vocabulary instead of glyph names.** See `icon-registry.ts`.
 * 3. **A single place to change library.** The last icon migration touched forty files; this one
 *    would touch one.
 *
 * ## Why the stroke is 1.75 and not Lucide's 2
 *
 * At 16–20px a 2px stroke is heavy enough that a row of icons reads as a row of *marks* competing
 * with the text beside them. 1.75 is the weight Linear and Vercel sit at: still crisp on a 1× display
 * — below about 1.5 the strokes start to alias into grey at these sizes — and light enough that the
 * icon supports the label rather than shouting over it.
 *
 * `absoluteStrokeWidth` is deliberately **off**. With it on, Lucide scales the stroke down as the
 * icon grows, so a 32px empty-state icon would be drawn in hairlines while a 16px inline one stays
 * bold — the opposite of what a consistent set needs.
 *
 * ## Sizing
 *
 * `size` is in pixels and matches the design system's icon steps (14/16/20/24/32/48). It is a number
 * rather than a token name because it is passed straight to Lucide's `width`/`height`, and mapping a
 * name to a number here would just be the same table written twice.
 *
 * ## Accessibility
 *
 * **Every icon is `aria-hidden` and there is no way to turn that off.** An icon in this app is always
 * decorative: it either sits beside a visible label, or inside a control that carries its own
 * `aria-label`. Offering an `alt` input would invite a third pattern where the icon names itself and
 * the button names itself, and screen readers read both.
 */
@Component({
  selector: 'pb-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  host: {
    class: 'inline-grid shrink-0 place-items-center',
    'aria-hidden': 'true',
  },
  template: `
    <lucide-angular
      [img]="icon()"
      [size]="size()"
      [strokeWidth]="strokeWidth()"
      [absoluteStrokeWidth]="false"
    />
  `,
  styles: `
    :host {
      /* Sized by the icon itself. Without this the host is a full-width grid cell and an icon in a
         flex row pushes its label away by however much space is left over. */
      width: max-content;
      line-height: 0;
    }
  `,
})
export class IconComponent {
  readonly name = input.required<PbIconName>();

  /** Pixels. The design system's steps are 14, 16, 20, 24, 32, 48; 20 is the default in a control. */
  readonly size = input<number>(20);

  /** Overridable for the rare heavy mark — a filled-feeling active state, an empty-state hero. */
  readonly strokeWidth = input<number>(1.75);

  protected readonly icon = computed(() => PB_ICONS[this.name()]);
}
