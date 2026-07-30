import { booleanAttribute, ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MATERIAL_CORE_IMPORTS } from '../../material/material-imports';

/**
 * The page's primary action, floating, on a phone.
 *
 * ## Why only on a phone
 *
 * On a list page the primary action already lives in the page header — "Add item", "Record purchase" —
 * where it reads with the title. That works while the header is on screen. It stops working the moment
 * someone scrolls a page of forty rows, which on a phone is immediately: the action they came to
 * perform is now a screenful of scrolling away, above content they have already read past.
 *
 * So this is `sm:hidden` by default and the header button is `hidden sm:inline-flex`'s counterpart —
 * one control, in whichever place is reachable. Showing both at once would put the same action on screen
 * twice, and a FAB on a desktop covers the bottom-right of a table for no benefit, since the header is
 * still visible there.
 *
 * ## Placement
 *
 * Above the safe-area inset, and offset far enough not to sit under a thumb resting on the edge. It is
 * deliberately **not** used on the POS order screen: that page already has a floating cart pill in the
 * same corner, and two floating controls fighting for one thumb is worse than either alone.
 *
 * ## It is a real button with a real label
 *
 * `aria-label` always, because the icon is the only visible content when collapsed — an unlabelled
 * floating icon is the classic FAB accessibility failure. `label` renders beside the icon when there is
 * room, which is what makes an unfamiliar icon legible; an icon-only FAB asks the user to guess.
 */
@Component({
  selector: 'pb-fab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...MATERIAL_CORE_IMPORTS],
  host: {
    class: 'contents',
  },
  template: `
    <div [class]="wrapperClass()">
      <button
        type="button"
        class="pb-pop flex min-h-14 cursor-pointer appearance-none items-center gap-pb-2 rounded-pb-full border-0 bg-primary px-pb-4 font-[inherit] text-pb-body font-semibold text-on-primary shadow-pb-lg transition-transform duration-pb-fast ease-pb-out active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100"
        [attr.aria-label]="ariaLabel() || label()"
        [disabled]="disabled()"
        (click)="pressed.emit()"
      >
        <mat-icon class="!h-6 !w-6 !text-[24px]">{{ icon() }}</mat-icon>
        @if (label()) {
          <span>{{ label() }}</span>
        }
      </button>
    </div>
  `,
})
export class FabComponent {
  readonly icon = input<string>('add');
  /** Rendered beside the icon. Omit for an icon-only FAB, and then set `ariaLabel`. */
  readonly label = input<string>('');
  /** Overrides the accessible name when the visible label is absent or abbreviated. */
  readonly ariaLabel = input<string>('');
  readonly disabled = input(false, { transform: booleanAttribute });

  /**
   * Show it above the `sm` breakpoint too.
   *
   * Off by default — see the class note. There is no page that needs it yet; the input exists so the
   * decision is made at the call site rather than by editing this component.
   */
  readonly alwaysVisible = input(false, { transform: booleanAttribute });

  readonly pressed = output<void>();

  protected wrapperClass(): string {
    const base =
      'fixed bottom-0 right-0 z-30 flex p-pb-4 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+1rem))]';
    return this.alwaysVisible() ? base : `${base} sm:hidden`;
  }
}
