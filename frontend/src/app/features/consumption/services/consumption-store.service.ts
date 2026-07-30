import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import { DEFAULT_PAGE_SIZE } from '../../../core/constants/app.constants';
import type { AppError } from '../../../core/errors/app-error';
import type { PaginationMeta } from '../../../core/models/api-response.model';
import type { InventoryLocation } from '../../inventory/models/inventory.model';
import type {
  ConsumptionEntry,
  ConsumptionQuery,
  ConsumptionSortField,
  ConsumptionSummary,
} from '../models/consumption.model';
import { ConsumptionService } from './consumption.service';

const EMPTY_PAGINATION: PaginationMeta = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrevious: false,
};

/**
 * List state for the consumption log.
 *
 * Same shape as the other feature stores: signals throughout, explicit `load()` rather
 * than a reactive effect, and a request sequence number so a slow response cannot
 * overwrite a newer one. The summary is fetched with the same query as the list.
 */
@Injectable()
export class ConsumptionStore {
  private readonly service = inject(ConsumptionService);

  private readonly entriesState = signal<readonly ConsumptionEntry[]>([]);
  private readonly paginationState = signal<PaginationMeta>(EMPTY_PAGINATION);
  private readonly summaryState = signal<ConsumptionSummary | null>(null);
  private readonly searchState = signal('');
  private readonly locationState = signal<InventoryLocation | null>(null);
  private readonly fromDateState = signal<string | null>(null);
  private readonly toDateState = signal<string | null>(null);
  private readonly includeVoidedState = signal(false);
  private readonly sortFieldState = signal<ConsumptionSortField>('entryDate');
  private readonly sortDirectionState = signal<'asc' | 'desc'>('desc');
  private readonly loadingState = signal(false);
  private readonly errorState = signal<AppError | null>(null);

  private requestSequence = 0;

  readonly entries: Signal<readonly ConsumptionEntry[]> = this.entriesState.asReadonly();
  readonly pagination: Signal<PaginationMeta> = this.paginationState.asReadonly();
  readonly summary: Signal<ConsumptionSummary | null> = this.summaryState.asReadonly();
  readonly loading: Signal<boolean> = this.loadingState.asReadonly();
  readonly error: Signal<AppError | null> = this.errorState.asReadonly();
  readonly searchTerm: Signal<string> = this.searchState.asReadonly();
  readonly sortField: Signal<ConsumptionSortField> = this.sortFieldState.asReadonly();
  readonly sortDirection: Signal<'asc' | 'desc'> = this.sortDirectionState.asReadonly();

  readonly filters = computed(() => ({
    location: this.locationState(),
    fromDate: this.fromDateState(),
    toDate: this.toDateState(),
    includeVoided: this.includeVoidedState(),
  }));

  readonly hasActiveFilters: Signal<boolean> = computed(() => {
    const filters = this.filters();
    return (
      this.searchState().length > 0 ||
      filters.location !== null ||
      filters.fromDate !== null ||
      filters.toDate !== null ||
      filters.includeVoided
    );
  });

  readonly isEmptyDueToFilters: Signal<boolean> = computed(
    () => this.entriesState().length === 0 && this.hasActiveFilters() && !this.loadingState(),
  );

  /**
   * True when the date range is the wrong way round.
   *
   * Surfaced rather than silently swapped: the user meant one of the two bounds to be
   * different, and guessing which would hide the mistake behind plausible results.
   */
  readonly invalidDateRange: Signal<boolean> = computed(() => {
    const from = this.fromDateState();
    const to = this.toDateState();
    return from !== null && to !== null && from > to;
  });

  readonly query: Signal<ConsumptionQuery> = computed(() => {
    const search = this.searchState();
    const filters = this.filters();
    const pagination = this.paginationState();

    return {
      page: pagination.page,
      pageSize: pagination.pageSize,
      sortField: this.sortFieldState(),
      sortDirection: this.sortDirectionState(),
      ...(search.length > 0 && { search }),
      ...(filters.location !== null && { location: filters.location }),
      ...(filters.fromDate !== null && { fromDate: filters.fromDate }),
      ...(filters.toDate !== null && { toDate: filters.toDate }),
      // Only sent when on: the server hides voided entries by default, and sending
      // `false` would be a filter that means the same as absence.
      ...(filters.includeVoided && { includeVoided: true }),
    };
  });

  load(): void {
    if (this.invalidDateRange()) {
      this.entriesState.set([]);
      this.summaryState.set(null);
      this.loadingState.set(false);
      return;
    }

    const sequence = ++this.requestSequence;
    const query = this.query();

    this.loadingState.set(true);
    this.errorState.set(null);

    this.service.list(query).subscribe({
      next: (page) => {
        if (sequence !== this.requestSequence) {
          return;
        }

        this.entriesState.set(page.items);
        this.paginationState.set(page.pagination);
        this.loadingState.set(false);
      },
      error: (error: AppError) => {
        if (sequence !== this.requestSequence) {
          return;
        }

        this.errorState.set(error);
        this.entriesState.set([]);
        this.loadingState.set(false);
      },
    });

    this.service.summary(query).subscribe({
      next: (summary) => {
        if (sequence === this.requestSequence) {
          this.summaryState.set(summary);
        }
      },
      // Swallowed: the counts are a header decoration and the list's own error banner
      // already reports a broken connection.
      error: () => {
        if (sequence === this.requestSequence) {
          this.summaryState.set(null);
        }
      },
    });
  }

  setSearch(search: string): void {
    this.searchState.set(search);
    this.resetToFirstPage();
    this.load();
  }

  setLocation(location: InventoryLocation | null): void {
    this.locationState.set(location);
    this.resetToFirstPage();
    this.load();
  }

  setFromDate(date: string | null): void {
    this.fromDateState.set(this.normaliseDate(date));
    this.resetToFirstPage();
    this.load();
  }

  setToDate(date: string | null): void {
    this.toDateState.set(this.normaliseDate(date));
    this.resetToFirstPage();
    this.load();
  }

  toggleIncludeVoided(): void {
    this.includeVoidedState.update((value) => !value);
    this.resetToFirstPage();
    this.load();
  }

  clearFilters(): void {
    this.searchState.set('');
    this.locationState.set(null);
    this.fromDateState.set(null);
    this.toDateState.set(null);
    this.includeVoidedState.set(false);
    this.resetToFirstPage();
    this.load();
  }

  setSort(field: ConsumptionSortField, direction: 'asc' | 'desc'): void {
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
   * Full reload after any mutation.
   *
   * Not a local row replacement: recording or voiding changes the summary counts, and a
   * voided entry may no longer belong in the list at all when the filter excludes them.
   */
  reload(): void {
    this.load();
  }

  private normaliseDate(date: string | null): string | null {
    return date === null || date.length === 0 ? null : date;
  }

  private resetToFirstPage(): void {
    this.paginationState.update((pagination) => ({ ...pagination, page: 1 }));
  }
}
