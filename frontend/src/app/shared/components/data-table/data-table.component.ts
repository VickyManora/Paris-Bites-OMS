import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSortModule, type Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { map } from 'rxjs';
import type { PaginationMeta } from '../../../core/models/api-response.model';
import { MATERIAL_CORE_IMPORTS } from '../../material/material-imports';
import type { TableColumn } from '../../models/table-column.model';
import { EmptyStateComponent } from '../empty-state/empty-state.component';
import { IconComponent } from '../icon/icon.component';
import { StatusBadgeComponent } from '../status-badge/status-badge.component';
import type { PbIconName } from '../icon/icon-registry';
import { PaginatorComponent, type PageRequest } from '../paginator/paginator.component';
import { SkeletonComponent } from '../skeleton/skeleton.component';
import { SpinnerComponent } from '../spinner/spinner.component';
import { TablePreferencesService } from './table-preferences.service';

/**
 * Viewport width at which a table is shown instead of cards, in pixels.
 *
 * Tailwind's `lg`. It is a measurement, not a preference: the widest table in the app —
 * inventory, at eight columns — needs 830px, and the content area is the viewport less the 72px
 * sidebar rail, so the two only meet at 1024. Below it the table cannot fit and can only scroll
 * sideways.
 *
 * Two places depend on this and must not drift apart: `isMobile` observes it, and the
 * `hideOnMobile` class in `cellClass` must use the Tailwind prefix for the same breakpoint (`lg:`).
 * They were previously 600 and 640 respectively, which left a 40px band rendering a table with its
 * optional columns still hidden.
 */
const PB_TABLE_MIN_WIDTH = 1024;

/**
 * Generic, server-paginated table.
 *
 * Columns come from `TableColumn<T>` data, so every list feature shares this one
 * implementation. Paging and sorting are **emitted, never applied locally**: the
 * dataset lives on the server, and sorting only the page in hand would silently
 * produce wrong results.
 *
 * ## Responsive behaviour
 *
 * Below the `sm` breakpoint the table is replaced by a list of cards, each row
 * becoming label/value pairs. A horizontally scrolling table is technically
 * responsive but miserable to use on a phone — you cannot see the row you are
 * reading and the column headers at the same time. The card layout reuses the same
 * column definitions, so there is no second source of truth.
 *
 * Above that, the table scrolls inside its own container so the page body never scrolls
 * sideways, and columns marked `hideOnMobile` are dropped.
 *
 * ## Loading is a skeleton, not a spinner
 *
 * First load draws skeleton rows in the table's own shape. A spinner in place of the table means the
 * card collapses to spinner height and then reflows to full height when data lands — the single
 * biggest source of layout jump in the app, on six screens. Refresh keeps the existing rows under a
 * translucent overlay instead, so scroll position and the row you were reading both survive.
 *
 * ## Sticky header, and what it requires
 *
 * The header pins only when the wrapper actually scrolls, which means `maxHeight` has to be set —
 * `position: sticky` resolves against the nearest scrolling ancestor, and a wrapper with no height
 * limit never becomes one. Off by default for that reason: a table left to grow with the page scrolls
 * the *page*, and pinning a header to the top of a container that never moves does nothing.
 *
 * ## Selection
 *
 * Opt-in, and it needs `trackBy`: selection is stored as a set of keys rather than of object
 * references, because the store replaces row objects on every refresh and reference identity would
 * silently drop the selection each time the list reloaded.
 *
 * The bulk bar offers **CSV export of the selected rows** and nothing destructive. Export is honest
 * here — the table already holds the column definitions and the data, so it needs no endpoint. Bulk
 * delete is deliberately absent: there is no batch endpoint, and quietly looping N single-record
 * deletes gives partial failure with no way to report which half succeeded. Pages may project their
 * own actions into `slot=bulk-actions` when they have one that is genuinely atomic.
 */
@Component({
  selector: 'pb-data-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatTableModule,
    MatSortModule,
    MatCheckboxModule,
    EmptyStateComponent,
    IconComponent,
    PaginatorComponent,
    StatusBadgeComponent,
    SkeletonComponent,
    SpinnerComponent,
    NgTemplateOutlet,
    ...MATERIAL_CORE_IMPORTS,
  ],
  host: {
    class: 'block',
  },
  template: `
    <div class="flex flex-col gap-pb-2">
      <!--
        ======================= UTILITY ROW =======================
        Row count, density, and the bulk bar when something is selected. Rendered above the table so
        the controls that change how it looks sit with it rather than in each page's own toolbar,
        where they were six separate implementations waiting to happen.
      -->
      @if (showToolbar()) {
        <div class="flex min-h-9 flex-wrap items-center gap-pb-2">
          @if (selectedCount() > 0) {
            <!-- Selection replaces the count rather than sitting beside it: while a selection exists
                 it is the only thing in this row worth reading. -->
            <span class="text-pb-body font-medium text-pb-text">
              {{ selectedCount() }} selected
            </span>

            <button matButton type="button" class="!min-w-0" (click)="clearSelection()">
              Clear
            </button>

            <span class="h-5 w-px bg-pb-border" aria-hidden="true"></span>

            <ng-content select="[slot=bulk-actions]" />

            <button matButton type="button" class="!min-w-0" (click)="exportSelected()">
              <pb-icon name="download" [size]="16" class="mr-pb-1" />
              Export CSV
            </button>
          } @else if (rowCountLabel()) {
            <span class="text-pb-caption text-pb-text-secondary">{{ rowCountLabel() }}</span>
          }

          <span class="flex-1"></span>

          @if (!isMobile()) {
            <!--
              Density. An icon toggle rather than two radio buttons: it is a display preference used
              rarely and understood instantly from the icon, and the tooltip names the state it will
              move to. Hidden on mobile, where the layout is cards and row height means nothing.
            -->
            <button
              type="button"
              class="grid h-9 w-9 shrink-0 cursor-pointer appearance-none place-items-center rounded-pb-md border border-pb-border bg-pb-surface p-0 text-pb-text-secondary transition-colors duration-pb-fast ease-pb-out hover:border-pb-border-strong hover:bg-pb-hover-surface hover:text-pb-text motion-reduce:transition-none"
              [attr.aria-label]="
                density() === 'compact' ? 'Use comfortable rows' : 'Use compact rows'
              "
              [attr.aria-pressed]="density() === 'compact'"
              [matTooltip]="density() === 'compact' ? 'Comfortable rows' : 'Compact rows'"
              (click)="preferences.toggleDensity()"
            >
              <pb-icon
                [name]="density() === 'compact' ? 'densityComfortable' : 'densityCompact'"
                [size]="16"
              />
            </button>
          }
        </div>
      }

      <!-- 'relative' anchors the loading overlay to this region only. -->
      <div class="relative">
        @if (loading() && rows().length > 0) {
          <!-- Refreshing existing data: cover it rather than unmounting, so the
               page does not collapse and scroll position survives. -->
          <pb-spinner [overlay]="true" label="Updating…" />
        }

        @if (loading() && rows().length === 0) {
          <!--
            The shape of what is coming, not a spinner in the middle of nothing.

            One 'role="status"' on the region rather than one per placeholder — see the note on
            'pb-skeleton'. Every child is 'aria-hidden', so this announces once.
          -->
          <div role="status" aria-live="polite" aria-busy="true">
            <span class="sr-only">Loading</span>

            @if (isMobile()) {
              <ul class="m-0 flex list-none flex-col gap-pb-3 p-0">
                @for (row of skeletonRowArray(); track $index) {
                  <li class="pb-surface p-pb-4">
                    <pb-skeleton variant="text" width="55%" height="1rem" />
                    <div class="mt-pb-3 flex flex-col gap-pb-2">
                      <pb-skeleton variant="text" width="100%" />
                      <pb-skeleton variant="text" width="80%" />
                    </div>
                  </li>
                }
              </ul>
            } @else {
              <div class="overflow-hidden rounded-pb-lg border border-pb-border bg-pb-surface">
                <!-- A header band, so the placeholder reads as a table rather than as a stack of
                     grey bars. -->
                <div
                  class="flex gap-pb-4 border-b border-pb-border bg-pb-surface-sunken px-pb-3 py-pb-3"
                >
                  @for (column of visibleSkeletonColumns(); track column.key) {
                    <pb-skeleton class="flex-1" variant="text" height="0.6875rem" width="60%" />
                  }
                </div>

                @for (row of skeletonRowArray(); track $index) {
                  <div
                    class="flex items-center gap-pb-4 border-b border-pb-border-subtle px-pb-3 last:border-b-0"
                    [style.height]="density() === 'compact' ? '44px' : '56px'"
                  >
                    @for (column of visibleSkeletonColumns(); track column.key) {
                      <!-- Varied widths per column so the block does not read as a grid of identical
                           bars, which looks like a rendering fault rather than like loading. -->
                      <pb-skeleton class="flex-1" variant="text" [width]="skeletonWidth($index)" />
                    }
                  </div>
                }
              </div>
            }
          </div>
        } @else if (rows().length === 0) {
          <pb-empty-state
            [icon]="emptyIcon()"
            [iconName]="emptyIconName()"
            [title]="emptyTitle()"
            [message]="emptyMessage()"
            [actionLabel]="emptyActionLabel()"
            (action)="emptyAction.emit()"
          />
        } @else if (isMobile()) {
          <!-- Card layout: one card per row, built from the same columns. -->
          <ul class="m-0 flex list-none flex-col gap-pb-3 p-0">
            @for (row of rows(); track trackRow($index, row)) {
              <!--
                The row is a real <li>, and the interactive element sits *inside* it.

                An earlier version put role="button" on the <li> itself, which reads as a
                button to assistive technology and therefore stops being a list item — so the
                <ul> was left with no valid children and the list announced nothing. Nesting
                a real <button> keeps both semantics, and brings Space, Enter and the focus
                ring for free rather than the hand-rolled tabindex + keydown.enter it
                replaces, which never handled Space at all.
              -->
              <li
                class="pb-surface overflow-hidden transition-colors duration-pb-fast ease-pb-out"
                [class.pb-card-selected]="isSelected(row)"
              >
                <div class="flex items-start gap-pb-2">
                  @if (selection() === 'multiple') {
                    <div class="pl-pb-2 pt-pb-3">
                      <mat-checkbox
                        [checked]="isSelected(row)"
                        [attr.aria-label]="'Select ' + display(primaryColumn(), row)"
                        (change)="toggleRow(row)"
                      />
                    </div>
                  }

                  @if (selectable()) {
                    <!-- Tailwind's preflight is not loaded, so a bare <button> keeps the
                         browser's border, grey face and centred text. These reset it. -->
                    <button
                      type="button"
                      class="block min-w-0 flex-1 cursor-pointer appearance-none border-0 bg-transparent p-pb-4 text-left font-[inherit] text-inherit"
                      (click)="onRowClick(row)"
                    >
                      <ng-container [ngTemplateOutlet]="card" [ngTemplateOutletContext]="{ row }" />
                    </button>
                  } @else {
                    <div class="min-w-0 flex-1 p-pb-4">
                      <ng-container [ngTemplateOutlet]="card" [ngTemplateOutletContext]="{ row }" />
                    </div>
                  }
                </div>
              </li>
            }
          </ul>

          <!-- One definition of the card body, used by both the interactive and the static
               variant, so they cannot drift. -->
          <ng-template #card let-row="row">
            <!--
              The title row carries the chevron when the card opens something.

              A mobile card that is tappable and looks identical to one that is not is the single
              most common reason a list feels unresponsive on a phone: there is no hover to reveal
              the affordance, so it has to be drawn.
            -->
            <div class="mb-pb-3 flex items-start gap-pb-2">
              <p class="m-0 min-w-0 flex-1 truncate text-pb-subtitle font-semibold text-pb-text">
                {{ display(primaryColumn(), row) }}
              </p>
              @if (selectable()) {
                <pb-icon name="expand" [size]="16" class="mt-0.5 text-pb-text-muted" />
              }
            </div>

            <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-pb-3 gap-y-pb-2">
              @for (column of secondaryColumns(); track column.key) {
                <dt class="text-pb-caption text-pb-text-secondary">{{ column.header }}</dt>
                <dd
                  class="m-0 text-right text-pb-caption text-pb-text"
                  [class.tabular-nums]="column.numeric"
                >
                  @if (column.tone && column.tone(row); as tone) {
                    <pb-status-badge [tone]="tone" [label]="display(column, row)" />
                  } @else {
                    {{ display(column, row) }}
                  }
                </dd>
              }
            </dl>
          </ng-template>
        } @else {
          <!--
            'overflow-auto' on both axes, and a max-height only when one is given.

            Horizontal so a wide table scrolls inside the card rather than making the page scroll
            sideways; vertical so a sticky header has a scroll container to stick to.
          -->
          <div [class]="scrollerClass()" [style.max-height]="maxHeight() || null">
            <!--
              'matSortDisableClear' removes Material's third "unsorted" state, leaving a
              plain asc ↔ desc toggle.

              The default cycle is asc → desc → unsorted, which has no equivalent in a
              server-sorted list: the API always sorts by something. Keeping the third state
              meant Material's internal direction and the caller's could disagree, and a
              click would appear to do nothing while the two resynchronised.
            -->
            <table
              mat-table
              matSort
              matSortDisableClear
              [dataSource]="rows()"
              [matSortActive]="sortActive()"
              [matSortDirection]="sortDirection()"
              (matSortChange)="sortChange.emit($event)"
              [class]="tableClass()"
            >
              <!--
                Widths live here, in one place, rather than on each <th>.

                This is what makes column resizing a later change to this component instead of a
                rewrite of every column definition: a drag handle needs a single element per column
                whose width it can write to, and Material recreates header cells on sort. See
                'resizable' on TableColumn.
              -->
              <colgroup>
                @if (selection() === 'multiple') {
                  <col style="width: 48px" />
                }
                @for (column of columns(); track column.key) {
                  <col
                    [style.width]="column.width || null"
                    [style.min-width]="column.minWidth || null"
                  />
                }
              </colgroup>

              @if (selection() === 'multiple') {
                <ng-container matColumnDef="pb-select">
                  <th mat-header-cell *matHeaderCellDef class="!pr-0">
                    <!--
                      Select-all is explicitly *this page*, and says so.

                      A checkbox that appeared to select 4,000 records while only 25 are loaded would
                      be a lie the table tells silently; there is no endpoint that would honour it
                      either. Indeterminate covers the partial case.
                    -->
                    <mat-checkbox
                      [checked]="allOnPageSelected()"
                      [indeterminate]="someOnPageSelected()"
                      [attr.aria-label]="
                        allOnPageSelected()
                          ? 'Deselect all on this page'
                          : 'Select all on this page'
                      "
                      (change)="toggleAllOnPage()"
                    />
                  </th>

                  <td mat-cell *matCellDef="let row" class="!pr-0">
                    <!--
                      'stopPropagation' so ticking a box does not also fire the row's own click and
                      open a dialog over the list you are selecting in.
                    -->
                    <mat-checkbox
                      [checked]="isSelected(row)"
                      [attr.aria-label]="'Select ' + display(primaryColumn(), row)"
                      (click)="$event.stopPropagation()"
                      (change)="toggleRow(row)"
                    />
                  </td>
                </ng-container>
              }

              @for (column of columns(); track column.key) {
                <ng-container [matColumnDef]="column.key">
                  <th
                    mat-header-cell
                    *matHeaderCellDef
                    [mat-sort-header]="column.sortable ? column.key : ''"
                    [disabled]="!column.sortable"
                    [class]="cellClass(column)"
                  >
                    {{ column.header }}
                  </th>

                  <td mat-cell *matCellDef="let row" [class]="cellClass(column)">
                    @if (column.tone && column.tone(row); as tone) {
                      <pb-status-badge [tone]="tone" [label]="display(column, row)" />
                    } @else {
                      {{ display(column, row) }}
                    }
                  </td>
                </ng-container>
              }

              <tr mat-header-row *matHeaderRowDef="columnKeys(); sticky: stickyHeader()"></tr>
              <!--
                Class list built as a string: a Tailwind variant like 'hover:bg-…' cannot be used as
                a '[class.x]' binding key.

                ## The row is keyboard-operable, and was not

                A clickable row carried a '(click)' and nothing else — no tabindex, no key handler.
                Clicking one opens the detail dialog, so on eight tables the primary action of the
                screen was **reachable with a mouse and by no other means**. That is a WCAG 2.1.1
                failure, not a rough edge: a keyboard or switch user could reach the page, read it,
                and not open anything on it. The mobile card layout beside this has been correct all
                along, because it happens to wrap its body in a real '<button>'.

                'tabindex' is bound rather than fixed so a non-selectable table adds no tab stops —
                a read-only list should not put forty focus stops between the toolbar and the
                paginator.

                Enter and Space both activate, matching the button behaviour the cards already have.
                Space is prevented from scrolling first, which is what it would otherwise do.

                **What this deliberately is not.** The complete answer for a table whose rows are
                actionable is the ARIA grid pattern — 'role="grid"', roving tabindex, arrow-key
                navigation between cells. That is a larger change to Material's own table roles and
                a different interaction model for the whole app, so this fixes operability without
                claiming to be it. A row still announces as a row, which is honest.
              -->
              <tr
                mat-row
                *matRowDef="let row; columns: columnKeys()"
                [class]="rowClass()"
                [class.pb-row-selected]="isSelected(row)"
                [attr.tabindex]="selectable() ? 0 : null"
                [attr.aria-label]="selectable() ? rowLabel(row) : null"
                (click)="onRowClick(row)"
                (keydown.enter)="onRowKey($event, row)"
                (keydown.space)="onRowKey($event, row)"
              ></tr>
            </table>
          </div>
        }
      </div>

      @if (pagination(); as page) {
        @if (rows().length > 0 || page.total > 0) {
          <pb-paginator
            class="pb-paginator border-t border-outline-variant pt-pb-1"
            [pagination]="page"
            [disabled]="loading()"
            (pageChange)="pageChange.emit($event)"
          />
        }
      }
    </div>
  `,
})
export class DataTableComponent<T> {
  private readonly breakpoints = inject(BreakpointObserver);
  protected readonly preferences = inject(TablePreferencesService);

  readonly columns = input.required<readonly TableColumn<T>[]>();
  readonly rows = input.required<readonly T[]>();
  readonly pagination = input<PaginationMeta | null>(null);
  readonly loading = input<boolean>(false);
  readonly selectable = input<boolean>(false);
  readonly sortActive = input<string>('');
  readonly sortDirection = input<'asc' | 'desc' | ''>('');

  readonly emptyIcon = input<string>('inbox');

  /**
   * A Lucide name for the empty state, taking precedence over `emptyIcon` when set.
   *
   * Additive rather than a replacement, for the reason `pb-empty-state` documents: this component
   * has eight call sites and `emptyIcon` still carries a Material name on the two that have not
   * moved. Passing `emptyIconName` opts a page in.
   */
  readonly emptyIconName = input<PbIconName | null>(null);
  readonly emptyTitle = input<string>('Nothing to show');
  readonly emptyMessage = input<string>('');
  readonly emptyActionLabel = input<string>('');

  /** Zebra striping. See the note on `.pb-table-striped` for why it is as faint as it is. */
  readonly striped = input(true, { transform: booleanAttribute });

  /**
   * Pins the header while the body scrolls. Requires `maxHeight` — see the class note.
   *
   * Off by default so a table that grows with the page is unaffected: the header would have nothing
   * to stick to, and Material's sticky implementation adds a positioned wrapper for no benefit.
   */
  readonly stickyHeader = input(false, { transform: booleanAttribute });

  /**
   * Height at which the table body starts scrolling, any CSS length. Empty lets it grow.
   *
   * This is what turns the wrapper into a scroll container, so it is also what makes `stickyHeader`
   * mean anything.
   */
  readonly maxHeight = input<string>('');

  /** `multiple` adds a checkbox column and the bulk bar. Requires `trackBy`. */
  readonly selection = input<'none' | 'multiple'>('none');

  /** Hides the count/density/bulk row entirely, for a table embedded in a dialog or a card body. */
  readonly showToolbar = input(true, { transform: booleanAttribute });

  /** Base name for the exported file; `.csv` and nothing else is appended. */
  readonly exportName = input<string>('export');

  /** How many placeholder rows to draw while loading. Roughly a screenful. */
  readonly skeletonRows = input<number>(8);

  /**
   * Identity function for `track`. Supply one whenever rows have a stable id —
   * without it Angular falls back to index and re-creates every row on each
   * refresh, losing focus and scroll position.
   *
   * Also the selection key: see the class note on why selection is keyed rather than by reference.
   */
  readonly trackBy = input<((row: T) => unknown) | null>(null);

  readonly sortChange = output<Sort>();
  readonly pageChange = output<PageRequest>();
  readonly rowClick = output<T>();
  readonly emptyAction = output<void>();
  /** The currently selected rows, emitted whenever the selection changes. */
  readonly selectionChange = output<readonly T[]>();

  /** Selected row keys. Keys, not rows — the store hands back new objects on every refresh. */
  private readonly selectedKeys = signal<ReadonlySet<unknown>>(new Set());

  protected readonly density = this.preferences.density;

  /**
   * Drives the table/card switch. Bridged from the CDK's observable API.
   *
   * The threshold is the width at which a full table actually fits, which is not the width at
   * which a phone stops being a phone. This used to be `Breakpoints.XSmall` (599.98px) and the
   * result was a table that rendered from 600px and then scrolled sideways for the next 400:
   * inventory's eight columns need 830px, and the content area — the viewport less the 72px
   * sidebar rail — does not reach that until the viewport is 1024. Measured across the range, the
   * overflow was +362px at 640, +234 at 768, +158 at 844 (a phone in landscape) and +42 at 960,
   * reaching zero only at 1024.
   *
   * Below that the card layout is not a downgrade. It renders every column as a label and value,
   * so a tablet shows *more* of each row than a truncated table would, and nothing has to be
   * dragged into view.
   *
   * `PB_TABLE_MIN_WIDTH` is shared with the `hideOnMobile` class in `cellClass`, which is applied
   * by CSS and must agree with this. When they disagreed — 599.98 here against Tailwind's 640
   * there — rows between 600 and 639 rendered as a table whose optional columns were still
   * hidden, which is why the table looked deceptively narrow at exactly 600px.
   */
  protected readonly isMobile = toSignal(
    this.breakpoints.observe(`(max-width: ${PB_TABLE_MIN_WIDTH - 0.02}px)`).pipe(
      map((state) => state.matches),
    ),
    { initialValue: false },
  );

  /**
   * `hideOnMobile` is applied as a CSS class to both the `<th>` and the `<td>`,
   * never by removing the column from this list: `matHeaderRowDef` requires the
   * header and cell key lists to match exactly, so dropping a key from one would
   * break the table.
   */
  protected readonly columnKeys = computed(() => {
    const keys = this.columns().map((column) => column.key);
    return this.selection() === 'multiple' ? ['pb-select', ...keys] : keys;
  });

  protected readonly tableClass = computed(() => {
    const classes = ['pb-table', `pb-table-${this.density()}`];

    if (this.striped()) {
      classes.push('pb-table-striped');
    }
    if (this.stickyHeader()) {
      classes.push('pb-table-sticky');
    }

    return classes.join(' ');
  });

  protected readonly scrollerClass = computed(() => {
    // 'rounded-pb-lg' and the surface colour, so the table is a card rather than a bordered
    // rectangle — and squared at the bottom when a paginator follows, so the two read as one object.
    const base = 'overflow-x-auto rounded-pb-lg border border-pb-border bg-pb-surface';
    // Vertical scrolling only when a ceiling was given; otherwise `overflow-y: auto` on a
    // full-height table adds a scrollbar gutter that never scrolls.
    return this.maxHeight().length > 0 ? `${base} overflow-y-auto` : base;
  });

  protected readonly rowClass = computed(() => (this.selectable() ? 'cursor-pointer' : ''));

  /** Card title on mobile: the column flagged `primary`, else the first one. */
  protected readonly primaryColumn = computed<TableColumn<T> | null>(() => {
    const all = this.columns();
    return all.find((column) => column.primary === true) ?? all[0] ?? null;
  });

  protected readonly secondaryColumns = computed(() => {
    const primary = this.primaryColumn();
    return this.columns().filter((column) => column !== primary);
  });

  protected readonly skeletonRowArray = computed(() =>
    Array.from({ length: Math.max(1, this.skeletonRows()) }),
  );

  /**
   * Columns the skeleton draws, capped at six.
   *
   * A placeholder for a nine-column table at 1440px is nine 40px bars, which reads as noise rather
   * than as a table arriving. The point is to hold the shape, and six columns does that.
   *
   * Deliberately **not** filtered by `hideOnMobile`: this is only rendered in the desktop branch,
   * where those columns are exactly the ones that *are* shown. Filtering them out drew a three-bar
   * placeholder in front of an eight-column table — the shape it exists to hold was the shape it was
   * getting wrong.
   */
  protected readonly visibleSkeletonColumns = computed(() => this.columns().slice(0, 6));

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  protected readonly selectedCount = computed(() => this.selectedRows().length);

  /**
   * The selected rows, resolved from keys against what is currently loaded.
   *
   * Rows on other pages stay in `selectedKeys` but are not resolvable here, so they are not exported
   * or counted. That is the honest behaviour for a server-paginated list: the table cannot export a
   * record it does not have.
   */
  protected readonly selectedRows = computed<readonly T[]>(() => {
    const keys = this.selectedKeys();

    if (keys.size === 0) {
      return [];
    }

    return this.rows().filter((row) => keys.has(this.keyFor(row)));
  });

  protected readonly allOnPageSelected = computed(() => {
    const rows = this.rows();
    return rows.length > 0 && this.selectedRows().length === rows.length;
  });

  protected readonly someOnPageSelected = computed(() => {
    const count = this.selectedRows().length;
    return count > 0 && count < this.rows().length;
  });

  protected readonly rowCountLabel = computed(() => {
    const page = this.pagination();
    const loaded = this.rows().length;

    if (page === null) {
      return loaded === 0 ? '' : `${String(loaded)} ${loaded === 1 ? 'row' : 'rows'}`;
    }
    if (page.total === 0) {
      return '';
    }

    // "25 of 412" rather than the paginator's own "1 – 25 of 412": this is a scope statement for the
    // density and bulk controls beside it, not a second copy of the pager.
    return loaded === page.total
      ? `${String(page.total)} ${page.total === 1 ? 'row' : 'rows'}`
      : `${String(loaded)} of ${String(page.total)} rows`;
  });

  protected isSelected(row: T): boolean {
    return this.selectedKeys().has(this.keyFor(row));
  }

  protected toggleRow(row: T): void {
    const key = this.keyFor(row);

    this.selectedKeys.update((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });

    this.selectionChange.emit(this.selectedRows());
  }

  protected toggleAllOnPage(): void {
    const shouldSelect = !this.allOnPageSelected();
    const pageKeys = this.rows().map((row) => this.keyFor(row));

    this.selectedKeys.update((current) => {
      const next = new Set(current);

      for (const key of pageKeys) {
        if (shouldSelect) {
          next.add(key);
        } else {
          next.delete(key);
        }
      }

      return next;
    });

    this.selectionChange.emit(this.selectedRows());
  }

  protected clearSelection(): void {
    this.selectedKeys.set(new Set());
    this.selectionChange.emit([]);
  }

  /**
   * Writes the selected rows out as CSV, client-side.
   *
   * No endpoint is involved: the column definitions already describe every value, and `csv` on a
   * column supplies the unformatted figure where the cell shows a formatted one. Quoting is applied
   * to every field rather than only the ones that look like they need it — a supplier name with a
   * comma in it is exactly the case that breaks an export nobody tested.
   *
   * A BOM leads the file because Excel reads a UTF-8 CSV without one as Latin-1, which turns ₹ into
   * mojibake on the first column of money anyone opens.
   */
  protected exportSelected(): void {
    const rows = this.selectedRows();

    if (rows.length === 0) {
      return;
    }

    const columns = this.columns().filter((column) => column.noExport !== true);
    const escape = (value: string | number | null | undefined): string => {
      const text = value === null || value === undefined ? '' : String(value);
      return `"${text.replaceAll('"', '""')}"`;
    };

    const lines = [
      columns.map((column) => escape(column.header)).join(','),
      ...rows.map((row) =>
        columns.map((column) => escape((column.csv ?? column.value)(row))).join(','),
      ),
    ];

    // '\uFEFF' rather than the literal character: a raw BOM in source is invisible, and both the
    // linter and the next person to touch this file would be right to be suspicious of it.
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `${this.exportName()}-${String(rows.length)}-rows.csv`;
    link.click();

    // Released on the next task rather than immediately: revoking synchronously after `click()`
    // races the download in Safari, which has not started reading the blob yet.
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  }

  /**
   * Selection key for a row.
   *
   * Falls back to the row object itself when no `trackBy` was supplied, which makes selection
   * reference-based and therefore reset on refresh — acceptable, because `selection="multiple"`
   * without `trackBy` is a call-site mistake and this at least degrades to "selection is transient"
   * rather than to selecting the wrong records.
   */
  private keyFor(row: T): unknown {
    return this.trackBy()?.(row) ?? row;
  }

  protected trackRow(index: number, row: T): unknown {
    return this.trackBy()?.(row) ?? index;
  }

  /** Varies the placeholder bar widths down the rows, so the block does not read as a grid. */
  protected skeletonWidth(index: number): string {
    const widths = ['82%', '64%', '73%', '56%', '88%', '68%'];
    return widths[index % widths.length] ?? '70%';
  }

  /** Renders an em dash for absent values, so cells never look broken. */
  protected display(column: TableColumn<T> | null, row: T): string {
    if (column === null) {
      return '—';
    }

    const value = column.value(row);
    return value === null || value === undefined || value === '' ? '—' : String(value);
  }

  protected cellClass(column: TableColumn<T>): string {
    const classes: string[] = [];

    if (column.align === 'right') classes.push('text-right');
    if (column.align === 'center') classes.push('text-center');
    if (column.numeric === true) classes.push('tabular-nums');
    // `lg:` must match `PB_TABLE_MIN_WIDTH`, which `isMobile` observes. It was `sm:`, which
    // revealed every optional column from 640px — 384px before the table had room for them.
    if (column.hideOnMobile === true) classes.push('hidden', 'lg:table-cell');

    return classes.join(' ');
  }

  protected onRowClick(row: T): void {
    if (this.selectable()) {
      this.rowClick.emit(row);
    }
  }

  /**
   * Keyboard activation for a row, matching what a click does.
   *
   * `preventDefault` before emitting: Space on a focused element scrolls the page, so without it
   * activating a row would also jump the list out from under the user.
   */
  protected onRowKey(event: Event, row: T): void {
    if (!this.selectable()) {
      return;
    }

    event.preventDefault();
    this.rowClick.emit(row);
  }

  /**
   * What a focused row announces.
   *
   * The primary column's value — the product name, the invoice number — rather than the whole row
   * read out cell by cell, which is what a screen reader does anyway once the row has focus. This is
   * the label for the *action*, so it names the thing the action is about.
   */
  protected rowLabel(row: T): string {
    return this.display(this.primaryColumn(), row);
  }
}
