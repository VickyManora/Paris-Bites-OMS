import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { MATERIAL_CORE_IMPORTS } from '../../material/material-imports';
import { SearchBoxComponent } from '../search-box/search-box.component';

/**
 * One applied filter, as the toolbar needs to describe it.
 *
 * `label` reads as a sentence fragment — "Category: Dairy", "From 1 Jul" — because the chip stands
 * alone and "Dairy" on its own does not say which control put it there.
 */
export interface FilterChip {
  /** Stable identity for `track`, and what `chipRemove` emits. */
  readonly key: string;
  readonly label: string;
}

/**
 * The controls above a list: search, filters, and what is currently applied.
 *
 * ## Why the six list pages needed this
 *
 * Each had built its own, and they had diverged in every dimension that matters. Inventory used a
 * four-column grid then a flex-wrap row; purchases used two four-column grids; transfers used a
 * flex row; sales used one grid with the clear button as a fourth grid cell. "Clear filters" sat in a
 * different place on all six, and on two of them it occupied a grid track, so the *other* controls
 * changed width depending on whether any filter was active.
 *
 * More importantly none of them said what was applied. The controls held the state, so answering
 * "why is this list only showing four rows" meant reading five collapsed selects — and on mobile,
 * where the filter row wraps to five stacked fields, scrolling past all of them.
 *
 * ## Chips are the actual improvement
 *
 * `filters` renders one removable chip per applied filter, so the answer to "what is narrowing this
 * list" is one line at the top, and undoing one of five filters does not mean hunting for the control
 * that set it. The page supplies the descriptors because only the page knows how to word them; the
 * toolbar owns the layout and the affordance.
 *
 * The chip row renders only when something is applied, so a clean list carries no empty furniture.
 *
 * ## Layout
 *
 * Search takes the remaining width and the projected filter controls sit beside it from `lg`, stacking
 * below that — a select at 390px is unusable at a third of the width. `slot=filters` is a real slot
 * rather than a data contract because filter controls are genuinely heterogeneous: selects, date
 * inputs, checkboxes, and one page's two-date range. Describing all of those as data would be a worse
 * abstraction than projecting them.
 */
@Component({
  selector: 'pb-list-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, SearchBoxComponent, ...MATERIAL_CORE_IMPORTS],
  host: {
    class: 'block',
  },
  template: `
    <div class="flex flex-col gap-pb-3">
      <!--
        'items-center', not 'items-start'.

        The search box is 40px and a Material select is 48; top-aligned they start level and end
        eight pixels apart, which reads as one control having slipped. Centring makes a row of
        mixed-height controls sit on one optical line, which is the whole reason this row exists.
      -->
      <div class="flex flex-col gap-pb-3 lg:flex-row lg:items-center">
        @if (showSearch()) {
          <pb-search-box
            class="lg:min-w-64 lg:flex-1"
            variant="bar"
            [label]="searchLabel()"
            [placeholder]="searchPlaceholder()"
            [initialValue]="searchValue()"
            (searchChange)="searchChange.emit($event)"
          />
        }

        <!--
          'contents' so the projected controls become direct children of this flex row rather than
          sitting inside a wrapper that would collapse them all into one flex item. Each page can then
          size its own controls, and they wrap independently on a narrow screen.
        -->
        <div class="flex flex-col gap-pb-3 lg:contents">
          <ng-content select="[slot=filters]" />
        </div>
      </div>

      <!--
        What is currently narrowing the list.

        Rendered only when something is applied — an empty chip row is furniture, and a row that is
        sometimes there and sometimes not is less confusing than a row that is always there and
        usually empty.
      -->
      @if (filters().length > 0) {
        <div class="flex flex-wrap items-center gap-pb-2">
          <span class="text-pb-overline uppercase text-pb-text-muted">Filtered by</span>

          @for (chip of filters(); track chip.key) {
            <!--
              A button, not a chip component with a nested remove button. The whole thing does one
              thing — remove this filter — so making it one target is both simpler and a larger
              hit area than an 18px × inside a pill.
            -->
            <button
              type="button"
              class="group flex min-h-8 cursor-pointer appearance-none items-center gap-pb-1 rounded-pb-full border border-pb-border bg-pb-surface py-1 pl-pb-3 pr-pb-2 text-pb-caption font-medium text-pb-text transition-[background-color,border-color] duration-pb-fast ease-pb-out hover:border-pb-danger-border hover:bg-pb-danger-surface hover:text-pb-danger-fg motion-reduce:transition-none"
              [attr.aria-label]="'Remove filter: ' + chip.label"
              (click)="chipRemove.emit(chip.key)"
            >
              {{ chip.label }}
              <!--
                The whole chip tints toward danger on hover, not just this glyph.

                A chip whose only hover signal is an 16px × changing colour asks the user to notice a
                detail before they understand that pressing it removes something. Tinting the object
                says "this will be taken away" from anywhere on it, which is the only place the
                pointer actually is.
              -->
              <pb-icon name="close" [size]="14" />
            </button>
          }

          @if (filters().length > 1) {
            <!-- Only offered when there is more than one to clear. With a single chip this button
                 and that chip do exactly the same thing, one beside the other. -->
            <button matButton type="button" class="!min-w-0" (click)="clearAll.emit()">
              Clear all
            </button>
          }
        </div>
      }
    </div>
  `,
})
export class ListToolbarComponent {
  readonly showSearch = input<boolean>(true);
  readonly searchLabel = input<string>('Search');
  readonly searchPlaceholder = input<string>('');
  readonly searchValue = input<string>('');

  /** Applied filters, in the order they should read. Empty hides the chip row. */
  readonly filters = input<readonly FilterChip[]>([]);

  readonly searchChange = output<string>();
  /** The `key` of the chip whose × was pressed. */
  readonly chipRemove = output<string>();
  readonly clearAll = output<void>();
}
