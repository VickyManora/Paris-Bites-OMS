import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import { DEFAULT_PAGE_SIZE } from '../../../core/constants/app.constants';
import type { AppError } from '../../../core/errors/app-error';
import type { PaginationMeta } from '../../../core/models/api-response.model';
import type { InventoryLocation } from '../../inventory/models/inventory.model';
import type {
  ReportColumn,
  ReportDescriptor,
  ReportFilters,
  ReportId,
  ReportResult,
  ReportRow,
} from '../models/report.model';
import { ReportService } from './report.service';

const EMPTY_PAGINATION: PaginationMeta = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrevious: false,
};

/** The filter keys the page can set. `sortField`/`sortDirection` go through `setSort`. */
export type EditableFilter = 'search' | 'fromDate' | 'toDate' | 'location' | 'supplierId';

/** What the page restores from the URL on load. */
export interface RestoredState {
  readonly reportId?: ReportId | undefined;
  readonly search?: string | undefined;
  readonly fromDate?: string | undefined;
  readonly toDate?: string | undefined;
  readonly location?: string | undefined;
  readonly supplierId?: string | undefined;
  readonly sortField?: string | undefined;
  readonly sortDirection?: 'asc' | 'desc' | undefined;
  readonly page?: number | undefined;
}

/**
 * State for the reports screen.
 *
 * Signals throughout and an explicit `load()`, like the other feature stores. Two things
 * are particular to reports:
 *
 * **The descriptor list is fetched first and decides what can be selected.** The server
 * only returns reports the caller may run, so the picker cannot offer one that then 403s.
 *
 * **Changing report resets the filters that the new one does not honour.** Carrying a date
 * range onto the inventory report would leave it visible in the bar and silently ignored
 * by the query, which reads as a filtered result that is not filtered.
 */
@Injectable()
export class ReportsStore {
  private readonly service = inject(ReportService);

  private readonly reportsState = signal<readonly ReportDescriptor[]>([]);
  private readonly reportsLoadingState = signal(true);
  private readonly reportIdState = signal<ReportId | null>(null);
  private readonly resultState = signal<ReportResult | null>(null);
  private readonly filtersState = signal<ReportFilters>({});
  private readonly pageState = signal(1);
  private readonly pageSizeState = signal(DEFAULT_PAGE_SIZE);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<AppError | null>(null);

  /** Guards against a slow response for an old report overwriting a newer one. */
  private requestSequence = 0;

  /** State read from the URL, held until the descriptor list arrives to validate it. */
  private pending: RestoredState = {};

  readonly reports: Signal<readonly ReportDescriptor[]> = this.reportsState.asReadonly();
  readonly reportsLoading: Signal<boolean> = this.reportsLoadingState.asReadonly();
  readonly reportId: Signal<ReportId | null> = this.reportIdState.asReadonly();
  readonly result: Signal<ReportResult | null> = this.resultState.asReadonly();
  readonly filters: Signal<ReportFilters> = this.filtersState.asReadonly();
  readonly loading: Signal<boolean> = this.loadingState.asReadonly();
  readonly error: Signal<AppError | null> = this.errorState.asReadonly();

  readonly descriptor: Signal<ReportDescriptor | null> = computed(() => {
    const id = this.reportIdState();
    return this.reportsState().find((report) => report.id === id) ?? null;
  });

  readonly columns: Signal<readonly ReportColumn[]> = computed(
    () => this.resultState()?.columns ?? [],
  );
  readonly rows: Signal<readonly ReportRow[]> = computed(() => this.resultState()?.rows ?? []);
  readonly appliedFilters: Signal<readonly string[]> = computed(
    () => this.resultState()?.appliedFilters ?? [],
  );

  readonly pagination: Signal<PaginationMeta> = computed(
    () => this.resultState()?.pagination ?? { ...EMPTY_PAGINATION, pageSize: this.pageSizeState() },
  );

  /**
   * The URL's query params for the current view.
   *
   * Only what differs from the default is included, so a plain report link stays short and
   * the browser history is not filled with `search=&from=&to=`.
   */
  readonly urlState = computed<Record<string, string>>(() => {
    const filters = this.filtersState();
    const id = this.reportIdState();
    const params: Record<string, string> = {};

    if (id !== null) params['report'] = id;
    if (filters.search !== undefined) params['search'] = filters.search;
    if (filters.fromDate !== undefined) params['from'] = filters.fromDate;
    if (filters.toDate !== undefined) params['to'] = filters.toDate;
    if (filters.location !== undefined) params['location'] = filters.location;
    if (filters.supplierId !== undefined) params['supplier'] = filters.supplierId;
    if (filters.sortField !== undefined) params['sort'] = filters.sortField;
    if (filters.sortDirection !== undefined) params['dir'] = filters.sortDirection;
    if (this.pageState() > 1) params['page'] = String(this.pageState());

    return params;
  });

  /**
   * Applies state read from the URL and starts loading.
   *
   * The fetch is triggered here rather than in the constructor so the restored state is
   * always in hand before the descriptor list resolves — otherwise a fast response would
   * race the page's `restore()` call and land on the default report.
   */
  restore(state: RestoredState): void {
    this.pending = state;
    this.loadReports();
  }

  selectReport(id: ReportId): void {
    if (id === this.reportIdState()) {
      return;
    }

    const descriptor = this.reportsState().find((report) => report.id === id);

    this.reportIdState.set(id);
    this.pageState.set(1);
    // Filters the new report cannot honour are dropped rather than carried across: a date
    // range still showing in the bar while the query ignores it is a lie about the rows.
    this.filtersState.set(this.prune(this.filtersState(), descriptor));
    this.load();
  }

  setFilter(key: EditableFilter, value: string): void {
    const trimmed = value.trim();
    const next = { ...this.filtersState() };

    if (trimmed.length === 0) {
      delete next[key];
    } else if (key === 'location') {
      next.location = trimmed as InventoryLocation;
    } else {
      next[key] = trimmed;
    }

    this.filtersState.set(next);
    // Back to page one: staying on page 7 of a now-shorter result set shows an empty
    // table and reads as "no matches".
    this.pageState.set(1);
    this.load();
  }

  clearFilters(): void {
    const { sortField, sortDirection } = this.filtersState();

    this.filtersState.set({ sortField, sortDirection });
    this.pageState.set(1);
    this.load();
  }

  setSort(field: string, direction: 'asc' | 'desc'): void {
    this.filtersState.set({ ...this.filtersState(), sortField: field, sortDirection: direction });
    this.pageState.set(1);
    this.load();
  }

  setPage(page: number, pageSize: number): void {
    this.pageState.set(page);
    this.pageSizeState.set(pageSize);
    this.load();
  }

  load(): void {
    const id = this.reportIdState();

    if (id === null) {
      return;
    }

    const sequence = ++this.requestSequence;

    this.loadingState.set(true);
    this.errorState.set(null);

    this.service
      .run(id, {
        ...this.filtersState(),
        page: this.pageState(),
        pageSize: this.pageSizeState(),
      })
      .subscribe({
        next: (result) => {
          if (sequence !== this.requestSequence) {
            return;
          }

          this.resultState.set(result);
          this.loadingState.set(false);
        },
        error: (error: AppError) => {
          if (sequence !== this.requestSequence) {
            return;
          }

          this.errorState.set(error);
          this.resultState.set(null);
          this.loadingState.set(false);
        },
      });
  }

  private loadReports(): void {
    this.service.listReports().subscribe({
      next: (reports) => {
        this.reportsState.set(reports);
        this.reportsLoadingState.set(false);

        const restored = this.pending;
        const requested = reports.find((report) => report.id === restored.reportId);
        const selected = requested ?? reports[0];

        if (selected === undefined) {
          return;
        }

        this.reportIdState.set(selected.id);
        this.filtersState.set(
          this.prune(
            {
              search: restored.search,
              fromDate: restored.fromDate,
              toDate: restored.toDate,
              location: restored.location as InventoryLocation | undefined,
              supplierId: restored.supplierId,
              sortField: restored.sortField,
              sortDirection: restored.sortDirection,
            },
            selected,
          ),
        );
        this.pageState.set(restored.page !== undefined && restored.page > 0 ? restored.page : 1);
        this.load();
      },
      error: (error: AppError) => {
        this.errorState.set(error);
        this.reportsLoadingState.set(false);
      },
    });
  }

  /** Drops filters the given report does not honour, and blanks. */
  private prune(filters: ReportFilters, descriptor: ReportDescriptor | undefined): ReportFilters {
    const next: ReportFilters = {
      ...(filters.search === undefined || filters.search.length === 0
        ? {}
        : { search: filters.search }),
      ...(descriptor?.supportsDateRange === true
        ? {
            ...(filters.fromDate === undefined ? {} : { fromDate: filters.fromDate }),
            ...(filters.toDate === undefined ? {} : { toDate: filters.toDate }),
          }
        : {}),
      ...(descriptor?.supportsLocation === true && filters.location !== undefined
        ? { location: filters.location }
        : {}),
      ...(descriptor?.supportsSupplier === true && filters.supplierId !== undefined
        ? { supplierId: filters.supplierId }
        : {}),
    };

    // Sorting is kept only when the new report actually has that column, else it falls
    // back to the report's own default rather than being silently ignored by the server.
    const sortField =
      filters.sortField !== undefined && descriptor?.sortFields.includes(filters.sortField) === true
        ? filters.sortField
        : descriptor?.defaultSortField;
    const sortDirection =
      sortField === filters.sortField
        ? (filters.sortDirection ?? descriptor?.defaultSortDirection)
        : descriptor?.defaultSortDirection;

    return {
      ...next,
      ...(sortField === undefined ? {} : { sortField }),
      ...(sortDirection === undefined ? {} : { sortDirection }),
    };
  }
}
