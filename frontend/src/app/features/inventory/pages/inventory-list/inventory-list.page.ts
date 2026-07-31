import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';
import type { Sort } from '@angular/material/sort';
import { AuthService } from '../../../../core/auth/services/auth.service';
import { Permission } from '../../../../core/models/permission.model';
import { Role } from '../../../../core/models/role.model';
import { NotificationService } from '../../../../core/services/notification.service';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { ConfirmDialogService } from '../../../../shared/components/confirm-dialog/confirm-dialog.service';
import { DataTableComponent } from '../../../../shared/components/data-table/data-table.component';
import { ErrorStateComponent } from '../../../../shared/components/error-state/error-state.component';
import { FabComponent } from '../../../../shared/components/fab/fab.component';
import { InlineAlertComponent } from '../../../../shared/components/inline-alert/inline-alert.component';
import {
  ListToolbarComponent,
  type FilterChip,
} from '../../../../shared/components/list-toolbar/list-toolbar.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import type { PageRequest } from '../../../../shared/components/paginator/paginator.component';
import { StatCardComponent } from '../../../../shared/components/stat-card/stat-card.component';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import {
  MATERIAL_CORE_IMPORTS,
  MATERIAL_FORM_IMPORTS,
} from '../../../../shared/material/material-imports';
import type { TableColumn } from '../../../../shared/models/table-column.model';
import {
  AdjustQuantityDialogComponent,
  type AdjustQuantityDialogData,
} from '../../components/adjust-quantity-dialog/adjust-quantity-dialog.component';
import {
  HistoryDialogComponent,
  type HistoryDialogData,
} from '../../components/history-dialog/history-dialog.component';
import {
  ItemActionsDialogComponent,
  type ItemAction,
  type ItemActionsDialogData,
} from '../../components/item-actions-dialog/item-actions-dialog.component';
import {
  ItemFormDialogComponent,
  type ItemFormDialogData,
} from '../../components/item-form-dialog/item-form-dialog.component';
import {
  INVENTORY_CATEGORY_OPTIONS,
  INVENTORY_LOCATION_OPTIONS,
  INVENTORY_STATUS_OPTIONS,
  STOCK_STATUS_LABELS,
  STOCK_STATUS_TONES,
  type InventoryItem,
  type InventoryLocation,
  type InventorySortField,
} from '../../models/inventory.model';
import { InventoryService } from '../../services/inventory.service';
import { InventoryStore } from '../../services/inventory-store.service';

/**
 * Inventory list — the module's main screen.
 *
 * All state lives in `InventoryStore` (signals); this component renders it and translates
 * user actions into store calls. `InventoryStore` is provided here rather than at the root
 * so its filters and paging are scoped to this page and reset when the user leaves.
 *
 * Dialogs are used for add/edit/adjust/history because the list is the working context:
 * staff work through it while looking at what is already there, and navigating away would
 * lose their filters and scroll position.
 */
@Component({
  selector: 'pb-inventory-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [InventoryStore],
  imports: [
    PageHeaderComponent,
    CardComponent,
    DataTableComponent,
    ErrorStateComponent,
    FabComponent,
    InlineAlertComponent,
    ListToolbarComponent,
    StatCardComponent,
    HasPermissionDirective,
    ...MATERIAL_CORE_IMPORTS,
    ...MATERIAL_FORM_IMPORTS,
  ],
  template: `
    <div class="flex flex-col gap-6">
      <pb-page-header title="Inventory" [subtitle]="pageSubtitle()">
        <button
          slot="actions"
          matButton="outlined"
          type="button"
          [disabled]="store.loading()"
          (click)="store.reload()"
        >
          <mat-icon>refresh</mat-icon>
          Refresh
        </button>
        <!--
          Hidden below 'sm': the FAB at the foot of the page is the same action, and it stays reachable
          once the header has scrolled away. Two copies on screen at once would be one action in two
          places.
        -->
        <button
          slot="actions"
          matButton="filled"
          type="button"
          class="!hidden sm:!inline-flex"
          *pbHasPermission="createPermission"
          (click)="openCreate()"
        >
          <mat-icon>add</mat-icon>
          Add item
        </button>
      </pb-page-header>

      <!-- Totals: 2 columns on mobile so they stay readable, 4 from lg. -->
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <pb-stat-card
          label="Items"
          [value]="store.pagination().total"
          iconName="inventory"
          [loading]="store.loading()"
        />
        <!--
          These three count the loaded page; only "Items" is the filtered total.

          Captioned rather than left bare: "Needs restocking 25" sitting beside "Items 40"
          reads as an inventory-wide figure and is not one. The caption appears only when
          the page actually holds less than the filter matched, so it is information rather
          than boilerplate.
        -->
        <pb-stat-card
          label="Needs restocking"
          [value]="lowStockCount()"
          iconName="warning"
          positiveWhen="down"
          [caption]="pageScopeCaption()"
          [loading]="store.loading()"
        />
        <!-- Always zero once the list is pinned to the cart, and a zero that means "not shown"
             rather than "none in stock" is the kind of figure that gets believed. -->
        @if (!cartOnly()) {
          <pb-stat-card
            label="Home Warehouse"
            [value]="countAt('HOME_WAREHOUSE')"
            iconName="value"
            [caption]="pageScopeCaption()"
            [loading]="store.loading()"
          />
        }
        <pb-stat-card
          label="Cart"
          [value]="countAt('CART')"
          iconName="suppliers"
          [caption]="pageScopeCaption()"
          [loading]="store.loading()"
        />
      </div>

      <pb-card padding="none">
        <div class="flex flex-col gap-pb-3 p-pb-4">
          <pb-list-toolbar
            searchLabel="Search items"
            searchPlaceholder="Name or notes…"
            [searchValue]="store.searchTerm()"
            [filters]="filterChips()"
            (searchChange)="onSearchChange($event)"
            (chipRemove)="removeFilter($event)"
            (clearAll)="store.clearFilters()"
          >
            <mat-form-field slot="filters" class="lg:!w-48" subscriptSizing="dynamic">
              <mat-label>Category</mat-label>
              <mat-select
                [value]="store.filters().category"
                (valueChange)="store.setCategory($event)"
              >
                <mat-option [value]="null">All categories</mat-option>
                @for (option of categoryOptions; track option.value) {
                  <mat-option [value]="option.value">{{ option.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <!-- Dropped entirely when the page is pinned to the cart: a control whose only
                 option is the current value is furniture, and one that can be changed would
                 undo the pin. -->
            @if (!cartOnly()) {
              <mat-form-field slot="filters" class="lg:!w-44" subscriptSizing="dynamic">
                <mat-label>Location</mat-label>
                <mat-select
                  [value]="store.filters().location"
                  (valueChange)="store.setLocation($event)"
                >
                  <mat-option [value]="null">All locations</mat-option>
                  @for (option of locationOptions; track option.value) {
                    <mat-option [value]="option.value">{{ option.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }

            <mat-form-field slot="filters" class="lg:!w-36" subscriptSizing="dynamic">
              <mat-label>Status</mat-label>
              <mat-select [value]="store.filters().status" (valueChange)="store.setStatus($event)">
                <mat-option [value]="null">Any</mat-option>
                @for (option of statusOptions; track option.value) {
                  <mat-option [value]="option.value">{{ option.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <!--
              A checkbox, not a chip-listbox: a single-select listbox does not reliably deselect its
              only option, so the filter could be switched on but not off. A checkbox also states its
              on/off state unambiguously to a screen reader.

              'lg:self-center' because it has no floating label to align with, so matching the
              selects' top edge would leave it sitting a few pixels high.
            -->
            <mat-checkbox
              slot="filters"
              class="lg:shrink-0 lg:self-center"
              [checked]="store.showingLowStockOnly()"
              (change)="store.toggleLowStockOnly()"
            >
              <span class="text-pb-body">Needs restocking only</span>
            </mat-checkbox>
          </pb-list-toolbar>

          @if (store.error(); as failure) {
            <!--
              An inline alert while there are rows to keep, a full error state when there is nothing.
              A page showing forty stale rows under a red banner is still usable; a page showing
              nothing needs to explain itself, and an illustration is what makes that read as a state
              rather than as a failure to render.
            -->
            @if (store.items().length > 0) {
              <pb-inline-alert title="Could not refresh inventory" [message]="failure.message">
                <button slot="actions" matButton type="button" (click)="store.reload()">
                  Try again
                </button>
              </pb-inline-alert>
            } @else {
              <pb-error-state
                title="Could not load inventory"
                [message]="failure.message"
                hint="The list is still there — this is the connection, not your data."
                (retry)="store.reload()"
              />
            }
          }
        </div>

        <div class="px-pb-4 pb-pb-4">
          <pb-data-table
            [columns]="columns()"
            [rows]="store.items()"
            [pagination]="store.pagination()"
            [loading]="store.loading()"
            [selectable]="true"
            selection="multiple"
            stickyHeader
            maxHeight="60vh"
            exportName="inventory"
            [sortActive]="store.sortField()"
            [sortDirection]="store.sortDirection()"
            [trackBy]="trackById"
            [emptyIconName]="store.isEmptyDueToFilters() ? 'searchEmpty' : 'inventory'"
            [emptyTitle]="
              store.isEmptyDueToFilters() ? 'No items match your filters' : 'No inventory items yet'
            "
            [emptyMessage]="
              store.isEmptyDueToFilters()
                ? 'Try a different search, or clear the filters to see everything again.'
                : 'Add your first item to start tracking what is on the shelf.'
            "
            [emptyActionLabel]="store.isEmptyDueToFilters() ? 'Clear filters' : ''"
            (emptyAction)="store.clearFilters()"
            (sortChange)="onSort($event)"
            (pageChange)="onPageChange($event)"
            (rowClick)="openRowActions($event)"
          />
        </div>
      </pb-card>

      <!-- Mobile only; see the note on 'pb-fab'. -->
      <pb-fab
        *pbHasPermission="createPermission"
        icon="add"
        label="Add item"
        (pressed)="openCreate()"
      />
    </div>
  `,
})
export class InventoryListPage {
  protected readonly store = inject(InventoryStore);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthService);

  /**
   * A Store Manager sees the cart and nothing else on this page.
   *
   * ## Why this is a page default and not enforced on the server
   *
   * Everywhere else in this app the rule is the opposite — a Store Manager's dashboard omits sales
   * figures from the *payload* rather than hiding them in the template, because a number that reaches
   * the browser has been disclosed. That rule does not apply here, and the difference is worth being
   * explicit about: warehouse stock is not confidential to a manager. They hold `TRANSFER_CREATE`
   * precisely so they can *request stock out of the warehouse*, and the create-transfer dialog asks
   * this same `/inventory/items` endpoint for `location=HOME_WAREHOUSE` to populate its picker.
   *
   * So scoping the endpoint by role would break the manager's own replenishment workflow — they would
   * open the transfer dialog to an empty list and have no way to ask for stock. What was asked for
   * here is focus, not confidentiality, and focus is a default.
   *
   * The scope is *stated* on the page rather than applied silently, because a list that quietly
   * omits rows is worse than one that explains itself.
   */
  protected readonly cartOnly = computed(() => this.auth.hasRole(Role.STORE_MANAGER));
  private readonly service = inject(InventoryService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /**
   * `?search=` from the URL.
   *
   * Set by the topbar's global search, and also what makes a filtered list linkable and
   * reload-proof. Tracked as a signal so arriving here from the topbar while already on
   * the page still applies the new term.
   */
  private readonly searchParam = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('search') ?? '')),
    { initialValue: '' },
  );

  protected readonly categoryOptions = INVENTORY_CATEGORY_OPTIONS;
  protected readonly locationOptions = INVENTORY_LOCATION_OPTIONS;
  protected readonly statusOptions = INVENTORY_STATUS_OPTIONS;
  protected readonly createPermission = Permission.PRODUCT_CREATE;

  /**
   * Says that the tile beside it describes the loaded page, not the filtered set.
   *
   * Empty when the page holds everything the filter matched — there is no distinction to
   * draw then, and a permanent "on this page" would train people to stop reading it.
   */
  /**
   * The subtitle carries the scope, so a pinned list explains itself.
   *
   * The alternative — leaving "Stock across the warehouse and cart" in place while showing only the
   * cart — would be the page stating something untrue about its own contents.
   */
  protected readonly pageSubtitle = computed(() =>
    this.cartOnly() ? 'Stock at the cart' : 'Stock across the warehouse and cart',
  );

  protected readonly pageScopeCaption = computed(() => {
    const loaded = this.store.items().length;
    const total = this.store.pagination().total;

    return total > loaded ? `of ${String(loaded)} on this page` : '';
  });

  /**
   * Counts describe the **current page**, not the whole inventory, because that is what
   * this page has loaded. The dashboard shows inventory-wide figures from the summary
   * endpoint; duplicating that here would mean a second request per filter change — and
   * `pageScopeCaption` says so on the tile rather than leaving the reader to assume.
   */
  protected readonly lowStockCount = computed(
    () => this.store.items().filter((item) => item.needsRestocking).length,
  );

  /**
   * What is currently narrowing the list, as removable chips.
   *
   * Built here rather than in the toolbar because only this page can word them: the store holds a
   * category *code*, and "Category: DAIRY" is not what anyone selected. Each label is resolved back
   * through the same option list the select is populated from, so the chip and the control cannot
   * disagree about what a value is called.
   *
   * Search is deliberately **not** a chip. It has a visible input holding the term two rows above,
   * with its own clear button — a chip would be a second place to remove the same thing, and the one
   * filter whose state is already obvious.
   */
  /**
   * The Location column is dropped once every row is the cart.
   *
   * A column repeating one value down the whole table costs horizontal room on the screen this page
   * most needs it — and reads as though it might vary.
   */
  protected readonly columns = computed<readonly TableColumn<InventoryItem>[]>(() =>
    this.cartOnly()
      ? this.allColumns.filter((column) => column.key !== 'location')
      : this.allColumns,
  );

  protected readonly filterChips = computed<readonly FilterChip[]>(() => {
    const filters = this.store.filters();
    const chips: FilterChip[] = [];

    if (filters.category !== null) {
      chips.push({
        key: 'category',
        label: `Category: ${this.labelFor(this.categoryOptions, filters.category)}`,
      });
    }

    /* No chip while pinned: every chip carries a remove button, so offering one here would hand
       back the filter the pin exists to hold. The header states the scope instead. */
    if (filters.location !== null && !this.cartOnly()) {
      chips.push({
        key: 'location',
        label: `Location: ${this.labelFor(this.locationOptions, filters.location)}`,
      });
    }

    if (filters.status !== null) {
      chips.push({
        key: 'status',
        label: `Status: ${this.labelFor(this.statusOptions, filters.status)}`,
      });
    }

    if (this.store.showingLowStockOnly()) {
      chips.push({ key: 'lowStock', label: 'Needs restocking only' });
    }

    return chips;
  });

  /** Falls back to the raw code, so an option the API adds before the UI does still names itself. */
  private labelFor(
    options: readonly { readonly value: string; readonly label: string }[],
    value: string,
  ): string {
    return options.find((option) => option.value === value)?.label ?? value;
  }

  protected removeFilter(key: string): void {
    switch (key) {
      case 'category':
        this.store.setCategory(null);
        break;
      case 'location':
        this.store.setLocation(null);
        break;
      case 'status':
        this.store.setStatus(null);
        break;
      case 'lowStock':
        this.store.toggleLowStockOnly();
        break;
      default:
        break;
    }
  }

  private readonly allColumns: readonly TableColumn<InventoryItem>[] = [
    { key: 'name', header: 'Item', value: (row) => row.name, sortable: true, primary: true },
    {
      key: 'category',
      header: 'Category',
      value: (row) => row.categoryLabel,
      sortable: true,
      hideOnMobile: true,
    },
    {
      key: 'currentQuantity',
      header: 'In stock',
      // Shown with its unit: a bare number invites reading kg as pieces.
      value: (row) => row.displayQuantity,
      sortable: true,
      align: 'right',
      numeric: true,
    },
    {
      key: 'minimumQuantity',
      header: 'Minimum',
      value: (row) =>
        row.minimumQuantity > 0 ? `${row.minimumQuantity} ${row.unitAbbreviation}` : '—',
      sortable: true,
      align: 'right',
      numeric: true,
      hideOnMobile: true,
    },
    {
      key: 'location',
      header: 'Location',
      value: (row) => row.locationLabel,
      sortable: true,
      hideOnMobile: true,
    },
    {
      key: 'supplier',
      header: 'Supplier',
      // Resolved by the API, so no second request is needed to name it.
      value: (row) => row.supplierName ?? '—',
      // Not sortable: the column shows a joined name, and the API's closed set of sort
      // fields does not include it. Offering a control that silently does nothing is
      // worse than not offering it.
      hideOnMobile: true,
    },
    {
      key: 'expiryDate',
      header: 'Expiry',
      // Rendered from the `YYYY-MM-DD` string as-is rather than through a Date, which
      // would re-interpret a calendar day in the browser's timezone and can show the
      // day before.
      value: (row) => row.expiryDate ?? '—',
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Stock',
      // The derived stock status, not the lifecycle status — it is what staff act on.
      value: (row) => STOCK_STATUS_LABELS[row.stockStatus],
      tone: (row) => STOCK_STATUS_TONES[row.stockStatus],
      sortable: true,
    },
  ];

  constructor() {
    /*
     * The URL is the single source of truth for the search term.
     *
     * Both the topbar's global search and this page's own search box write to
     * `?search=`; this effect is the only thing that pushes it into the store. One
     * direction of flow — input → URL → store → request — means the two boxes cannot
     * fight, and a filtered list is linkable and survives a reload.
     *
     * `untracked` around the store read is load-bearing: tracking `searchTerm` would make
     * this effect re-run whenever the store changed and immediately overwrite the term
     * with the (unchanged) URL value, wiping what the user had typed.
     */
    effect(() => {
      const term = this.searchParam();

      if (term !== untracked(() => this.store.searchTerm())) {
        this.store.setSearch(term);
      }
    });

    /*
     * Only load here when there is no term to apply. Arriving with `?search=butter` lets
     * the effect above issue a single already-filtered request, rather than fetching
     * everything and then fetching again.
     */
    /*
     * Pinned before the first request, so a manager never briefly sees warehouse rows. Set through
     * the store's own setter rather than by reaching into its state, so the applied-filter chips and
     * the request stay consistent with it.
     */
    if (this.cartOnly()) {
      this.store.setLocation('CART');
    }

    if (this.searchParam().length === 0) {
      this.store.load();
    }
  }

  /**
   * Search input goes to the URL, not straight to the store.
   *
   * `replaceUrl` so a debounced sequence of terms does not fill the back button with every
   * intermediate query.
   */
  protected onSearchChange(term: string): void {
    const search = term.trim();

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { search: search.length > 0 ? search : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected readonly trackById = (row: InventoryItem): string => row.id;

  protected countAt(location: InventoryLocation): number {
    return this.store.items().filter((item) => item.location === location).length;
  }

  protected onSort(sort: Sort): void {
    /*
     * `pb-data-table` sets `matSortDisableClear`, so the direction is always 'asc' or
     * 'desc' — never the empty "unsorted" state. The guard remains because `Sort` still
     * types it as possible, and defaulting is better than sending a direction the API
     * would reject.
     */
    if (sort.direction === '') {
      this.store.setSort('name', 'asc');
      return;
    }

    this.store.setSort(sort.active as InventorySortField, sort.direction);
  }

  protected onPageChange(request: PageRequest): void {
    this.store.setPage(request.page, request.pageSize);
  }

  protected openCreate(): void {
    const ref = this.dialog.open<ItemFormDialogComponent, ItemFormDialogData, InventoryItem>(
      ItemFormDialogComponent,
      { data: {}, width: '640px', maxWidth: 'calc(100vw - 2rem)', autoFocus: 'first-tabbable' },
    );

    ref.afterClosed().subscribe((created) => {
      if (created !== undefined) {
        this.notifications.success(`"${created.name}" added.`);
        // Full reload: a new item changes the total and may not belong on this page.
        this.store.reload();
      }
    });
  }

  /**
   * Row tap opens an action sheet of what the user may do with this item.
   *
   * On a phone there is no room for per-row action buttons, and a row that does nothing
   * when tapped feels broken — so the row itself is the affordance on every size.
   */
  protected openRowActions(item: InventoryItem): void {
    void this.showActions(item);
  }

  private async showActions(item: InventoryItem): Promise<void> {
    // A confirm dialog would be the wrong shape here, so the choice is offered as
    // sequential intents: adjust is the overwhelmingly common one, so it leads.
    const canAdjust = this.auth.can(Permission.STOCK_ADJUST);
    const canEdit = this.auth.can(Permission.PRODUCT_UPDATE);
    const canDelete = this.auth.can(Permission.PRODUCT_DELETE);

    const ref = this.dialog.open<
      ItemActionsDialogComponent,
      ItemActionsDialogData,
      ItemAction | undefined
    >(ItemActionsDialogComponent, {
      data: { item, canAdjust, canEdit, canDelete },
      width: '380px',
      maxWidth: 'calc(100vw - 2rem)',
    });

    const action = await firstValueFrom(ref.afterClosed());

    switch (action) {
      case 'adjust':
        this.openAdjust(item);
        break;
      case 'edit':
        this.openEdit(item);
        break;
      case 'history':
        this.openHistory(item);
        break;
      case 'delete':
        await this.confirmDelete(item);
        break;
      default:
        break;
    }
  }

  private openEdit(item: InventoryItem): void {
    const ref = this.dialog.open<ItemFormDialogComponent, ItemFormDialogData, InventoryItem>(
      ItemFormDialogComponent,
      { data: { item }, width: '640px', maxWidth: 'calc(100vw - 2rem)' },
    );

    ref.afterClosed().subscribe((updated) => {
      if (updated !== undefined) {
        this.notifications.success(`"${updated.name}" updated.`);
        // In-place replace keeps the page and scroll position.
        this.store.replaceItem(updated);
      }
    });
  }

  private openAdjust(item: InventoryItem): void {
    const ref = this.dialog.open<
      AdjustQuantityDialogComponent,
      AdjustQuantityDialogData,
      InventoryItem
    >(AdjustQuantityDialogComponent, {
      data: { item },
      width: '460px',
      maxWidth: 'calc(100vw - 2rem)',
    });

    ref.afterClosed().subscribe((updated) => {
      if (updated === undefined) {
        return;
      }

      this.store.replaceItem(updated);

      // Crossing the reorder threshold is worth surfacing immediately, not just as a
      // badge the user might not look at.
      if (updated.needsRestocking) {
        this.notifications.warning(
          `"${updated.name}" is now ${STOCK_STATUS_LABELS[updated.stockStatus].toLowerCase()} (${updated.displayQuantity}).`,
        );
      } else {
        this.notifications.success(`"${updated.name}" is now ${updated.displayQuantity}.`);
      }
    });
  }

  private openHistory(item: InventoryItem): void {
    this.dialog.open<HistoryDialogComponent, HistoryDialogData>(HistoryDialogComponent, {
      data: { item },
      width: '560px',
      maxWidth: 'calc(100vw - 2rem)',
    });
  }

  private async confirmDelete(item: InventoryItem): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: 'Delete item?',
      message: `This removes "${item.name}" from the inventory list. Its history is kept.`,
      detail: `${item.displayQuantity} currently recorded at ${item.locationLabel}`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      variant: 'danger',
      icon: 'delete_forever',
    });

    if (!confirmed) {
      return;
    }

    // Awaited so a failure surfaces here rather than leaving the list looking reloaded.
    // `errorInterceptor` has already shown the message, so this only has to avoid the
    // success path.
    try {
      await firstValueFrom(this.service.delete(item.id));
    } catch {
      return;
    }

    this.notifications.success(`"${item.name}" deleted.`);
    // Full reload: deletion changes the total and therefore the paging.
    this.store.reload();
  }
}
