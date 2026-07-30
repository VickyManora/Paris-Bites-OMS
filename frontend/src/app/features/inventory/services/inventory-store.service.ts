import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import { DEFAULT_PAGE_SIZE } from '../../../core/constants/app.constants';
import type { PaginationMeta } from '../../../core/models/api-response.model';
import type { AppError } from '../../../core/errors/app-error';
import type {
  InventoryCategory,
  InventoryItem,
  InventoryItemStatus,
  InventoryLocation,
  InventoryQuery,
  InventorySortField,
  InventoryUnit,
} from '../models/inventory.model';
import { InventoryService } from './inventory.service';

/** Everything that narrows the list. Kept together so one signal drives one fetch. */
interface InventoryFilters {
  readonly search: string;
  readonly category: InventoryCategory | null;
  readonly location: InventoryLocation | null;
  readonly unit: InventoryUnit | null;
  readonly status: InventoryItemStatus | null;
  readonly needsRestocking: boolean;
}

const EMPTY_FILTERS: InventoryFilters = {
  search: '',
  category: null,
  location: null,
  unit: null,
  status: null,
  needsRestocking: false,
};

const EMPTY_PAGINATION: PaginationMeta = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrevious: false,
};

/**
 * List state for the inventory page.
 *
 * Signals throughout, so the page reads state synchronously under `OnPush` with no
 * `async` pipe and no subscription to leak. The service stays stateless; this owns the
 * filters, paging, sort, rows and error.
 *
 * **Fetching is explicit, not reactive.** An `effect` that refetched whenever the query
 * signal changed would look elegant and misbehave: changing a filter and resetting the
 * page in the same handler would fire two requests, and the responses could arrive out
 * of order. Every mutator therefore calls `load()` once, deliberately.
 *
 * Out-of-order responses are handled by a request sequence number — see `load`.
 */
@Injectable()
export class InventoryStore {
  private readonly service = inject(InventoryService);

  private readonly itemsState = signal<readonly InventoryItem[]>([]);
  private readonly paginationState = signal<PaginationMeta>(EMPTY_PAGINATION);
  private readonly filtersState = signal<InventoryFilters>(EMPTY_FILTERS);
  private readonly sortFieldState = signal<InventorySortField>('name');
  private readonly sortDirectionState = signal<'asc' | 'desc'>('asc');
  private readonly loadingState = signal(false);
  private readonly errorState = signal<AppError | null>(null);

  /**
   * Guards against out-of-order responses.
   *
   * Typing quickly produces overlapping requests, and the slower one can land last. Only
   * the response matching the latest sequence number is applied, so the list always shows
   * the most recent query rather than whichever request happened to finish last.
   */
  private requestSequence = 0;

  readonly items: Signal<readonly InventoryItem[]> = this.itemsState.asReadonly();
  readonly pagination: Signal<PaginationMeta> = this.paginationState.asReadonly();
  readonly loading: Signal<boolean> = this.loadingState.asReadonly();
  readonly error: Signal<AppError | null> = this.errorState.asReadonly();
  readonly sortField: Signal<InventorySortField> = this.sortFieldState.asReadonly();
  readonly sortDirection: Signal<'asc' | 'desc'> = this.sortDirectionState.asReadonly();
  readonly filters: Signal<InventoryFilters> = this.filtersState.asReadonly();

  readonly searchTerm: Signal<string> = computed(() => this.filtersState().search);
  readonly showingLowStockOnly: Signal<boolean> = computed(
    () => this.filtersState().needsRestocking,
  );

  /** True when any filter is narrowing the list — drives the "Clear filters" affordance. */
  readonly hasActiveFilters: Signal<boolean> = computed(() => {
    const filters = this.filtersState();
    return (
      filters.search.length > 0 ||
      filters.category !== null ||
      filters.location !== null ||
      filters.unit !== null ||
      filters.status !== null ||
      filters.needsRestocking
    );
  });

  /**
   * Distinguishes "no items at all" from "no items match".
   *
   * The empty state needs to say different things: one invites adding an item, the other
   * invites clearing a filter.
   */
  readonly isEmptyDueToFilters: Signal<boolean> = computed(
    () => this.itemsState().length === 0 && this.hasActiveFilters() && !this.loadingState(),
  );

  readonly query: Signal<InventoryQuery> = computed(() => {
    const filters = this.filtersState();
    const pagination = this.paginationState();

    return {
      page: pagination.page,
      pageSize: pagination.pageSize,
      sortField: this.sortFieldState(),
      sortDirection: this.sortDirectionState(),
      ...(filters.search.length > 0 && { search: filters.search }),
      ...(filters.category !== null && { category: filters.category }),
      ...(filters.location !== null && { location: filters.location }),
      ...(filters.unit !== null && { unit: filters.unit }),
      ...(filters.status !== null && { status: filters.status }),
      ...(filters.needsRestocking && { needsRestocking: true }),
    };
  });

  /** Fetches the current query. Safe to call repeatedly. */
  load(): void {
    const sequence = ++this.requestSequence;

    this.loadingState.set(true);
    this.errorState.set(null);

    this.service.list(this.query()).subscribe({
      next: (page) => {
        // A superseded response is discarded rather than rendered.
        if (sequence !== this.requestSequence) {
          return;
        }

        this.itemsState.set(page.items);
        this.paginationState.set(page.pagination);
        this.loadingState.set(false);
      },
      error: (error: AppError) => {
        if (sequence !== this.requestSequence) {
          return;
        }

        this.errorState.set(error);
        this.itemsState.set([]);
        this.loadingState.set(false);
      },
    });
  }

  setSearch(search: string): void {
    // Page 1, because a narrower filter can leave the current page beyond the last one,
    // which would show an empty table with rows that do exist.
    this.filtersState.update((filters) => ({ ...filters, search }));
    this.resetToFirstPage();
    this.load();
  }

  setCategory(category: InventoryCategory | null): void {
    this.filtersState.update((filters) => ({ ...filters, category }));
    this.resetToFirstPage();
    this.load();
  }

  setLocation(location: InventoryLocation | null): void {
    this.filtersState.update((filters) => ({ ...filters, location }));
    this.resetToFirstPage();
    this.load();
  }

  setUnit(unit: InventoryUnit | null): void {
    this.filtersState.update((filters) => ({ ...filters, unit }));
    this.resetToFirstPage();
    this.load();
  }

  setStatus(status: InventoryItemStatus | null): void {
    this.filtersState.update((filters) => ({ ...filters, status }));
    this.resetToFirstPage();
    this.load();
  }

  toggleLowStockOnly(): void {
    this.filtersState.update((filters) => ({
      ...filters,
      needsRestocking: !filters.needsRestocking,
    }));
    this.resetToFirstPage();
    this.load();
  }

  clearFilters(): void {
    this.filtersState.set(EMPTY_FILTERS);
    this.resetToFirstPage();
    this.load();
  }

  setSort(field: InventorySortField, direction: 'asc' | 'desc'): void {
    this.sortFieldState.set(field);
    this.sortDirectionState.set(direction);
    this.resetToFirstPage();
    this.load();
  }

  setPage(page: number, pageSize: number): void {
    this.paginationState.update((pagination) => ({ ...pagination, page, pageSize }));
    this.load();
  }

  /**
   * Replaces one row in place after an edit or adjustment.
   *
   * Avoids a full refetch for the common case, so the user's scroll position and page
   * survive. Note the row may no longer match the active filter — adjusting an item back
   * above its threshold while filtering by low stock leaves it visible until the next
   * load. That is the deliberate trade: silently removing the row the user just acted on
   * is more disorienting than briefly showing a stale one.
   */
  replaceItem(updated: InventoryItem): void {
    this.itemsState.update((items) =>
      items.map((item) => (item.id === updated.id ? updated : item)),
    );
  }

  /**
   * Refetches after a create or delete.
   *
   * A full reload rather than a local splice, because both change the total count and
   * therefore the paging, and a created item may not belong on the current page under the
   * active sort.
   */
  reload(): void {
    this.load();
  }

  private resetToFirstPage(): void {
    this.paginationState.update((pagination) => ({ ...pagination, page: 1 }));
  }
}
