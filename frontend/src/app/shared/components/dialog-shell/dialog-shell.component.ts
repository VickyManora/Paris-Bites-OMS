import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatDialogModule } from '@angular/material/dialog';
import { MATERIAL_CORE_IMPORTS } from '../../material/material-imports';

/**
 * The frame every dialog in the app sits in: header, scrolling body, pinned footer.
 *
 * ## Why a frame rather than each dialog spelling it out
 *
 * Ten dialogs had each written their own `mat-dialog-title` / `mat-dialog-content` /
 * `mat-dialog-actions`, and they had drifted. Two had a subtitle and eight did not, so the same kind
 * of dialog explained itself on some screens and not others. The action row was
 * `!flex-col-reverse !items-stretch gap-2 sm:!flex-row sm:!justify-end` on the two that had thought
 * about mobile and plain `mat-dialog-actions` on the rest, which on a phone puts a full-width Cancel
 * *above* the primary button on some dialogs and a pair of squeezed buttons on others.
 *
 * ## The footer is pinned, and Material's is not quite
 *
 * `mat-dialog-actions` already sits outside the scrolling content, so it does not scroll away — that
 * part Material gets right. What it does not do is *look* pinned: there is no divider, so on a long
 * form the buttons appear to float in the same plane as the last field, and it is not obvious that
 * the content above them has more to scroll. The border and the surface here are what make it read as
 * a footer.
 *
 * The header gets the same treatment for the same reason: a long form scrolled halfway leaves the
 * title still visible but visually attached to whatever field happens to be under it.
 *
 * ## Errors have a place
 *
 * `slot=error` sits between the header and the body, above the first field and inside the scroll
 * region. Form-level failures were previously the first child of the form, which meant a server error
 * on a long dialog could arrive below the fold — the user pressed Save, nothing appeared to happen,
 * and the reason was 300px down.
 */
@Component({
  selector: 'pb-dialog-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, ...MATERIAL_CORE_IMPORTS],
  host: {
    class: 'block',
  },
  template: `
    <!--
      'mat-dialog-title' on a div rather than an h2, with the heading inside it.

      The directive supplies the id that 'aria-labelledby' points at; putting it on a wrapper lets the
      header hold an icon and a subtitle while the accessible name stays the title text alone.
    -->
    <div mat-dialog-title class="!m-0 !flex !items-start !gap-pb-3 !p-pb-4 !pb-pb-3">
      @if (icon()) {
        <span [class]="tileClass()" aria-hidden="true">
          <mat-icon class="!h-5 !w-5 !text-[20px]">{{ icon() }}</mat-icon>
        </span>
      }

      <div class="min-w-0 flex-1">
        <h2 class="m-0 text-pb-title text-pb-text">{{ title() }}</h2>
        @if (subtitle()) {
          <p class="m-0 mt-pb-1 text-pb-caption text-pb-text-secondary">{{ subtitle() }}</p>
        }
      </div>

      @if (dismissible()) {
        <!--
          A close button as well as Escape and the backdrop.

          On a touch screen there is no Escape key and the backdrop of a near-full-screen dialog is a
          few pixels wide, so without this a mobile user's only way out is the Cancel button — which a
          dialog in a saving state disables.
        -->
        <!--
          No negative top margin.

          It used to carry '-mt-pb-1', which pulled the button 4px above the icon tile at the other end
          of this row. Both are 36px squares bracketing the header, so the eye reads them as a pair and
          a 4px offset reads as a mistake — measured as a 4px difference between their centre lines.
          With the row's 'items-start' they now share a top edge and therefore a centre.

          The negative *right* margin stays: that one cancels an icon button's internal padding so the
          glyph lines up with the header's right edge, which is optical alignment rather than an offset.
        -->
        <button
          matIconButton
          type="button"
          class="!-mr-pb-2 !h-9 !w-9 shrink-0"
          mat-dialog-close
          aria-label="Close"
        >
          <mat-icon class="!h-5 !w-5 !text-[20px]">close</mat-icon>
        </button>
      }
    </div>

    <div class="border-b border-pb-border"></div>

    <mat-dialog-content class="!px-pb-4 !pb-pb-5 !pt-pb-4">
      <!-- Above the first field, inside the scroll region: see the class note. -->
      <div class="mb-pb-3 empty:hidden">
        <ng-content select="[slot=error]" />
      </div>

      <ng-content />
    </mat-dialog-content>

    <div class="border-t border-pb-border"></div>

    <!--
      Reversed on mobile so the primary action is the lowest thing on screen — nearest the thumb — and
      a row from 'sm' up with the primary on the right, which is where a pointer user looks for it.
    -->
    <mat-dialog-actions
      class="!flex-col-reverse !items-stretch !gap-pb-2 !p-pb-4 sm:!flex-row sm:!items-center sm:!justify-end"
    >
      <!-- Anything that belongs on the left: a destructive action, a step counter. -->
      <div class="flex items-center gap-pb-2 sm:mr-auto">
        <ng-content select="[slot=footer-start]" />
      </div>

      <ng-content select="[slot=actions]" />
    </mat-dialog-actions>
  `,
})
export class DialogShellComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  readonly icon = input<string>('');

  /**
   * Tone for the header icon tile. `danger` for a dialog that destroys something, so the framing is
   * set before the user reads the message rather than by the colour of the confirm button.
   */
  readonly tone = input<'neutral' | 'accent' | 'warning' | 'danger'>('neutral');

  /** Renders the × in the header. Off for a dialog that must be resolved by choosing. */
  readonly dismissible = input(true, { transform: booleanAttribute });

  protected tileClass(): string {
    const base = 'pb-icon-tile !h-9 !w-9 shrink-0';

    switch (this.tone()) {
      case 'accent':
        return `${base} pb-tone-accent`;
      case 'warning':
        return `${base} pb-tone-warning`;
      case 'danger':
        return `${base} pb-tone-danger`;
      default:
        return `${base} pb-tone-neutral`;
    }
  }
}
