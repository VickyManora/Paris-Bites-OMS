import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import { DEFAULT_PAGE_SIZE } from '../../../core/constants/app.constants';
import type { AppError } from '../../../core/errors/app-error';
import type { PaginationMeta } from '../../../core/models/api-response.model';
import type {
  StockTransfer,
  StockTransferStatus,
  TransferQuery,
  TransferSortField,
  TransferSummary,
} from '../models/transfer.model';
import { TransferService } from './transfer.service';

const EMPTY_PAGINATION: PaginationMeta = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrevious: false,
};

/**
 * List state for the transfers page.
 *
 * Same shape as `InventoryStore`: signals throughout, explicit `load()` rather than a
 * reactive effect (so changing a filter and resetting the page fires one request, not two),
 * and a request sequence number so a slow response cannot overwrite a newer one.
 *
 * The summary is fetched alongside the list because every mutation changes both — approving a
 * transfer moves it out of "pending" and into "in transit" — and refetching them separately
 * would let the counts disagree with the rows.
 */
@Injectable()
export class TransferStore {
  private readonly service = inject(TransferService);

  private readonly transfersState = signal<readonly StockTransfer[]>([]);
  private readonly paginationState = signal<PaginationMeta>(EMPTY_PAGINATION);
  private readonly summaryState = signal<TransferSummary | null>(null);
  private readonly statusState = signal<StockTransferStatus | null>(null);
  private readonly searchState = signal('');
  private readonly sortFieldState = signal<TransferSortField>('requestedAt');
  private readonly sortDirectionState = signal<'asc' | 'desc'>('desc');
  private readonly loadingState = signal(false);
  private readonly errorState = signal<AppError | null>(null);

  private requestSequence = 0;

  readonly transfers: Signal<readonly StockTransfer[]> = this.transfersState.asReadonly();
  readonly pagination: Signal<PaginationMeta> = this.paginationState.asReadonly();
  readonly summary: Signal<TransferSummary | null> = this.summaryState.asReadonly();
  readonly loading: Signal<boolean> = this.loadingState.asReadonly();
  readonly error: Signal<AppError | null> = this.errorState.asReadonly();
  readonly status: Signal<StockTransferStatus | null> = this.statusState.asReadonly();
  readonly searchTerm: Signal<string> = this.searchState.asReadonly();
  readonly sortField: Signal<TransferSortField> = this.sortFieldState.asReadonly();
  readonly sortDirection: Signal<'asc' | 'desc'> = this.sortDirectionState.asReadonly();

  readonly hasActiveFilters: Signal<boolean> = computed(
    () => this.statusState() !== null || this.searchState().length > 0,
  );

  readonly isEmptyDueToFilters: Signal<boolean> = computed(
    () => this.transfersState().length === 0 && this.hasActiveFilters() && !this.loadingState(),
  );

  /** Transfers awaiting a decision — what an approver opens the page for. */
  readonly pendingCount: Signal<number> = computed(() => this.summaryState()?.pending ?? 0);
  readonly inTransitCount: Signal<number> = computed(() => this.summaryState()?.inTransit ?? 0);

  readonly query: Signal<TransferQuery> = computed(() => {
    const status = this.statusState();
    const search = this.searchState();
    const pagination = this.paginationState();

    return {
      page: pagination.page,
      pageSize: pagination.pageSize,
      sortField: this.sortFieldState(),
      sortDirection: this.sortDirectionState(),
      ...(status !== null && { status }),
      ...(search.length > 0 && { search }),
    };
  });

  load(): void {
    const sequence = ++this.requestSequence;

    this.loadingState.set(true);
    this.errorState.set(null);

    this.service.list(this.query()).subscribe({
      next: (page) => {
        // Discard a superseded response rather than rendering it.
        if (sequence !== this.requestSequence) {
          return;
        }

        this.transfersState.set(page.items);
        this.paginationState.set(page.pagination);
        this.loadingState.set(false);
      },
      error: (error: AppError) => {
        if (sequence !== this.requestSequence) {
          return;
        }

        this.errorState.set(error);
        this.transfersState.set([]);
        this.loadingState.set(false);
      },
    });

    this.loadSummary();
  }

  setStatus(status: StockTransferStatus | null): void {
    this.statusState.set(status);
    this.resetToFirstPage();
    this.load();
  }

  setSearch(search: string): void {
    this.searchState.set(search);
    this.resetToFirstPage();
    this.load();
  }

  clearFilters(): void {
    this.statusState.set(null);
    this.searchState.set('');
    this.resetToFirstPage();
    this.load();
  }

  setSort(field: TransferSortField, direction: 'asc' | 'desc'): void {
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
   * Full reload after any transition.
   *
   * Not a local row replacement: a status change alters the summary counts, and if a status
   * filter is active the row may no longer belong in the list at all. Refetching keeps the
   * counts, the rows and the filter consistent.
   */
  reload(): void {
    this.load();
  }

  private loadSummary(): void {
    // Failure is swallowed: the counts are a header decoration, and the list's own error
    // banner already reports a broken connection. Two banners for one outage is noise.
    this.service.summary().subscribe({
      next: (summary) => this.summaryState.set(summary),
      error: () => this.summaryState.set(null),
    });
  }

  private resetToFirstPage(): void {
    this.paginationState.update((pagination) => ({ ...pagination, page: 1 }));
  }
}
