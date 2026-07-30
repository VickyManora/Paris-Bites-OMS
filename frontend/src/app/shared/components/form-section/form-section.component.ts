import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MATERIAL_CORE_IMPORTS } from '../../material/material-imports';

/**
 * A named group of fields.
 *
 * ## Why long forms need this
 *
 * The item form asks for eleven things — name, category, unit, location, quantities, reorder level,
 * price, supplier, expiry, notes — in one flat column of identical fields. Nothing said that the first
 * four identify the item and the next four are about stock levels, so the only way to find "reorder
 * level" was to read every label on the way down. A flat form of eleven fields is not eleven decisions,
 * it is one long decision.
 *
 * The heading is an `<h3>`: a dialog's own title is the `<h2>`, so these are its children and a screen
 * reader can jump between them. `<fieldset>` with a `<legend>` would be the textbook markup and is
 * deliberately not used — browsers apply their own `legend` positioning that cannot be fully overridden
 * without absolute positioning, and `role="group"` with `aria-labelledby` announces the same thing
 * without fighting it.
 *
 * ## `description` versus a field's own hint
 *
 * A hint explains one input. A description explains why the *group* exists, and it earns its line only
 * when the grouping is not self-evident from the heading — "Stock levels" needs no gloss, "Tax" does.
 */
@Component({
  selector: 'pb-form-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...MATERIAL_CORE_IMPORTS],
  host: {
    class: 'block',
  },
  template: `
    <section role="group" [attr.aria-labelledby]="headingId()">
      <div class="mb-pb-3 flex items-start gap-pb-2">
        @if (icon()) {
          <mat-icon
            class="!h-5 !w-5 shrink-0 !text-[20px] text-on-surface-variant"
            aria-hidden="true"
          >
            {{ icon() }}
          </mat-icon>
        }

        <div class="min-w-0">
          <h3 [id]="headingId()" class="m-0 text-pb-subtitle text-on-surface">{{ title() }}</h3>
          @if (description()) {
            <p class="m-0 mt-0.5 text-pb-caption text-on-surface-variant">{{ description() }}</p>
          }
        </div>
      </div>

      <!--
        'gap-pb-3' between fields — 16px.

        The forms this replaces used 12px, which is too tight for Material's outline appearance: the
        field's floating label sits above its own box, so two stacked fields put a label 4px from the
        border of the one above and the label reads as belonging to the wrong input.
      -->
      <div class="flex flex-col gap-pb-3">
        <ng-content />
      </div>
    </section>
  `,
})
export class FormSectionComponent {
  readonly title = input.required<string>();
  readonly description = input<string>('');
  readonly icon = input<string>('');

  /**
   * Id for `aria-labelledby`, derived from the title.
   *
   * Slugged rather than a counter because a counter would need shared mutable state and could collide
   * across two dialogs open at once; two sections with the same title in one form would be a naming
   * problem worth fixing anyway.
   */
  protected headingId(): string {
    return `pb-section-${this.title()
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}`;
  }
}
