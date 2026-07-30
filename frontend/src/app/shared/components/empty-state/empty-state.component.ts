import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MATERIAL_CORE_IMPORTS } from '../../material/material-imports';
import { IconComponent } from '../icon/icon.component';
import type { PbIconName } from '../icon/icon-registry';

/**
 * Placeholder for "no data" and "no results" states.
 *
 * A distinct component because the two cases need different wording — an empty
 * inventory invites you to add a product, while an empty filter result invites
 * you to clear the filter. Passing the action label makes that explicit at the
 * call site.
 *
 * ## The title is not a heading
 *
 * It used to be an `<h2>`. An empty state is a message *inside* something — nearly always a card
 * whose own title is an `<h3>` — so that produced an `h3` followed by an `h2` in the document
 * outline, claiming the placeholder outranked the card containing it. On the redesigned dashboard,
 * where sections are real `<h2>`s, it got worse: "No takings recorded yet" appeared in the outline as
 * a sibling of "Sales", so navigating by heading landed on placeholder text as though it were a
 * section of the page.
 *
 * A `<p>` is the honest element. Nothing is lost — the text is read either way, and an empty state is
 * not a landmark anyone wants to jump to.
 *
 * ## The type is stated rather than inherited
 *
 * `text-pb-title` and `text-pb-body` match no rule in this app: `mat.theme()` emits Material's
 * tokens but not its typography classes. With Tailwind's preflight deliberately absent, the `<h2>`
 * was therefore rendering at the browser's own 24px/700 — a size nobody chose, and a loud one for a
 * placeholder sitting in a chart card. These now come from the `pb-` scale.
 */
@Component({
  selector: 'pb-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, ...MATERIAL_CORE_IMPORTS],
  template: `
    <div class="flex flex-col items-center justify-center gap-pb-3 px-pb-4 py-pb-7 text-center">
      <!-- The icon sits in a tile rather than loose, so an empty card keeps the shape of a full one
           and the placeholder reads as a state rather than as a missing image. -->
      <span class="pb-icon-tile pb-tone-neutral !h-12 !w-12" aria-hidden="true">
        @if (iconName(); as lucide) {
          <pb-icon [name]="lucide" [size]="22" />
        } @else {
          <mat-icon class="!h-6 !w-6 !text-[24px]">{{ icon() }}</mat-icon>
        }
      </span>

      <div class="flex flex-col gap-pb-1">
        <p class="m-0 text-pb-subtitle text-on-surface">{{ title() }}</p>

        @if (message()) {
          <p class="m-0 max-w-prose text-pb-caption text-on-surface-variant">{{ message() }}</p>
        }
      </div>

      @if (actionLabel()) {
        <button matButton="filled" type="button" class="mt-pb-1" (click)="action.emit()">
          {{ actionLabel() }}
        </button>
      }
    </div>
  `,
})
export class EmptyStateComponent {
  /** Material Symbols name — the original input, kept so no existing call site changes. */
  readonly icon = input<string>('inbox');

  /**
   * A Lucide name from the icon registry, which takes precedence over `icon` when set.
   *
   * Two inputs rather than a migration, because this component is used on a dozen feature pages and
   * this phase covers the dashboard only. Switching the single `icon` input to a `PbIconName` would
   * either break those call sites at compile time or, worse, silently change how they look. Passing
   * `iconName` opts a call site in; passing nothing leaves it exactly as it was.
   *
   * When the rest of the app moves to Lucide, `icon` goes and this becomes the only input.
   */
  readonly iconName = input<PbIconName | null>(null);

  readonly title = input.required<string>();
  readonly message = input<string>('');
  /** Omit to render no button. */
  readonly actionLabel = input<string>('');

  readonly action = output<void>();
}
