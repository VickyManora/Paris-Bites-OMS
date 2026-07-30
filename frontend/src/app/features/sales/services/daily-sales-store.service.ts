import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import { DEFAULT_PAGE_SIZE } from '../../../core/constants/app.constants';
import type { AppError } from '../../../core/errors/app-error';
import type { PaginationMeta } from '../../../core/models/api-response.model';
import type {
  DailySalesEntry,
  DailySalesSortField,
  DailySalesSummary,
  SalesChannel,
} from '../models/daily-sales.model';
import { DailySalesService } from './daily-sales.service';

const EMPTY_PAGINATION: PaginationMeta = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrevious: false,
};

/**
 * List state for daily sales.
 *
 * Same shape as the other feature stores: signals throughout, an explicit `load()` rather
 * than a reactive effect, and a request sequence number so a slow response cannot
 * overwrite a newer one.
 *
 * The summary is fetched with the **same filter** as the list, in the same `load()`. A
 * totals strip that describes a different filter from the rows beneath it is the specific
 * way this kind of screen misleads people.
 */
@Injectable()
export class DailySalesStore {
  private readonly service = inject(DailySalesService);

  private readonly entriesState = signal<readonly DailySalesEntry[]>([]);
  private readonly paginationState = signal<PaginationMeta>(EMPTY_PAGINATION);
  private readonly summaryState = signal<DailySalesSummary | null>(null);
  private readonly fromDateState = signal<string | null>(null);
  private readonly toDateState = signal<string | null>(null);
  private readonly channelState = signal<SalesChannel | null>(null);
  private readonly sortFieldState = signal<DailySalesSortField>('entryDate');
  private readonly sortDirectionState = signal<'asc' | 'desc'>('desc');
  private readonly pageState = signal(1);
  private readonly pageSizeState = signal(DEFAULT_PAGE_SIZE);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<AppError | null>(null);

  private requestSequence = 0;

  readonly entries: Signal<readonly DailySalesEntry[]> = this.entriesState.asReadonly();
  readonly pagination: Signal<PaginationMeta> = this.paginationState.asReadonly();
  readonly summary: Signal<DailySalesSummary | null> = this.summaryState.asReadonly();
  readonly loading: Signal<boolean> = this.loadingState.asReadonly();
  readonly error: Signal<AppError | null> = this.errorState.asReadonly();
  readonly sortField: Signal<DailySalesSortField> = this.sortFieldState.asReadonly();
  readonly sortDirection: Signal<'asc' | 'desc'> = this.sortDirectionState.asReadonly();

  readonly filters = computed(() => ({
    fromDate: this.fromDateState(),
    toDate: this.toDateState(),
    channel: this.channelState(),
  }));

  readonly hasActiveFilters: Signal<boolean> = computed(() => {
    const filters = this.filters();
    return filters.fromDate !== null || filters.toDate !== null || filters.channel !== null;
  });

  readonly isEmpty: Signal<boolean> = computed(
    () => this.entriesState().length === 0 && !this.loadingState() && this.errorState() === null,
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

  setDateRange(fromDate: string | null, toDate: string | null): void {
    this.fromDateState.set(this.blankToNull(fromDate));
    this.toDateState.set(this.blankToNull(toDate));
    this.pageState.set(1);
    this.load();
  }

  setChannel(channel: SalesChannel | null): void {
    this.channelState.set(channel);
    this.pageState.set(1);
    this.load();
  }

  setSort(field: DailySalesSortField, direction: 'asc' | 'desc'): void {
    this.sortFieldState.set(field);
    this.sortDirectionState.set(direction);
    this.pageState.set(1);
    this.load();
  }

  setPage(page: number, pageSize: number): void {
    this.pageState.set(page);
    this.pageSizeState.set(pageSize);
    this.load();
  }

  clearFilters(): void {
    this.fromDateState.set(null);
    this.toDateState.set(null);
    this.channelState.set(null);
    this.pageState.set(1);
    this.load();
  }

  load(): void {
    // A backwards range would return nothing and read as "no sales", so it is refused
    // here rather than sent.
    if (this.invalidDateRange()) {
      return;
    }

    const sequence = ++this.requestSequence;
    const filters = this.filters();

    const query = {
      page: this.pageState(),
      pageSize: this.pageSizeState(),
      fromDate: filters.fromDate ?? undefined,
      toDate: filters.toDate ?? undefined,
      channel: filters.channel ?? undefined,
      sortField: this.sortFieldState(),
      sortDirection: this.sortDirectionState(),
    };

    this.loadingState.set(true);
    this.errorState.set(null);

    this.service.list(query).subscribe({
      next: (result) => {
        if (sequence !== this.requestSequence) {
          return;
        }

        this.entriesState.set(result.items);
        this.paginationState.set(result.pagination);
        this.loadingState.set(false);
      },
      error: (error: AppError) => {
        if (sequence !== this.requestSequence) {
          return;
        }

        this.errorState.set(error);
        this.loadingState.set(false);
      },
    });

    // Same filter, no paging — the totals describe the whole filtered set, not the page.
    this.service
      .summary({
        fromDate: query.fromDate,
        toDate: query.toDate,
        channel: query.channel,
      })
      .subscribe({
        next: (summary) => {
          if (sequence === this.requestSequence) {
            this.summaryState.set(summary);
          }
        },
        // A failed summary must not blank the list; the tiles simply stay as they were.
        error: () => undefined,
      });
  }

  private blankToNull(value: string | null): string | null {
    return value === null || value.trim().length === 0 ? null : value.trim();
  }
}
