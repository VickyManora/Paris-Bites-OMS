import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import { DEFAULT_PAGE_SIZE } from '../../../core/constants/app.constants';
import type { AppError } from '../../../core/errors/app-error';
import type { PaginationMeta } from '../../../core/models/api-response.model';
import type {
  GstTreatment,
  Purchase,
  PurchaseQuery,
  PurchaseSortField,
  PurchaseSummary,
} from '../models/purchase.model';
import { PurchaseService } from './purchase.service';

const EMPTY_PAGINATION: PaginationMeta = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrevious: false,
};

/**
 * List state for the purchase history page.
 *
 * Same shape as the other feature stores: signals throughout, explicit `load()` rather
 * than a reactive effect, and a request sequence number so a slow response cannot
 * overwrite a newer one.
 *
 * **The summary is fetched with the same filter as the list**, not globally. A totals row
 * that ignored the filters would say ₹2,00,000 while the four visible rows add to ₹8,000,
 * and the user would have no way to tell which number answered their question.
 */
@Injectable()
export class PurchaseStore {
  private readonly service = inject(PurchaseService);

  private readonly purchasesState = signal<readonly Purchase[]>([]);
  private readonly paginationState = signal<PaginationMeta>(EMPTY_PAGINATION);
  private readonly summaryState = signal<PurchaseSummary | null>(null);
  private readonly searchState = signal('');
  private readonly supplierIdState = signal<string | null>(null);
  private readonly gstTreatmentState = signal<GstTreatment | null>(null);
  private readonly fromDateState = signal<string | null>(null);
  private readonly toDateState = signal<string | null>(null);
  private readonly hasInvoiceFileState = signal<boolean | null>(null);
  private readonly sortFieldState = signal<PurchaseSortField>('invoiceDate');
  private readonly sortDirectionState = signal<'asc' | 'desc'>('desc');
  private readonly loadingState = signal(false);
  private readonly errorState = signal<AppError | null>(null);

  private requestSequence = 0;

  readonly purchases: Signal<readonly Purchase[]> = this.purchasesState.asReadonly();
  readonly pagination: Signal<PaginationMeta> = this.paginationState.asReadonly();
  readonly summary: Signal<PurchaseSummary | null> = this.summaryState.asReadonly();
  readonly loading: Signal<boolean> = this.loadingState.asReadonly();
  readonly error: Signal<AppError | null> = this.errorState.asReadonly();
  readonly searchTerm: Signal<string> = this.searchState.asReadonly();
  readonly sortField: Signal<PurchaseSortField> = this.sortFieldState.asReadonly();
  readonly sortDirection: Signal<'asc' | 'desc'> = this.sortDirectionState.asReadonly();

  readonly filters = computed(() => ({
    supplierId: this.supplierIdState(),
    gstTreatment: this.gstTreatmentState(),
    fromDate: this.fromDateState(),
    toDate: this.toDateState(),
    hasInvoiceFile: this.hasInvoiceFileState(),
  }));

  readonly hasActiveFilters: Signal<boolean> = computed(() => {
    const filters = this.filters();
    return (
      this.searchState().length > 0 ||
      filters.supplierId !== null ||
      filters.gstTreatment !== null ||
      filters.fromDate !== null ||
      filters.toDate !== null ||
      filters.hasInvoiceFile !== null
    );
  });

  readonly isEmptyDueToFilters: Signal<boolean> = computed(
    () => this.purchasesState().length === 0 && this.hasActiveFilters() && !this.loadingState(),
  );

  /**
   * True when the date range is the wrong way round.
   *
   * Surfaced rather than silently swapped: the user meant one of the two bounds to be
   * different, and guessing which would hide the mistake behind plausible-looking results.
   */
  readonly invalidDateRange: Signal<boolean> = computed(() => {
    const from = this.fromDateState();
    const to = this.toDateState();
    return from !== null && to !== null && from > to;
  });

  readonly query: Signal<PurchaseQuery> = computed(() => {
    const search = this.searchState();
    const filters = this.filters();
    const pagination = this.paginationState();

    return {
      page: pagination.page,
      pageSize: pagination.pageSize,
      sortField: this.sortFieldState(),
      sortDirection: this.sortDirectionState(),
      ...(search.length > 0 && { search }),
      ...(filters.supplierId !== null && { supplierId: filters.supplierId }),
      ...(filters.gstTreatment !== null && { gstTreatment: filters.gstTreatment }),
      ...(filters.fromDate !== null && { fromDate: filters.fromDate }),
      ...(filters.toDate !== null && { toDate: filters.toDate }),
      ...(filters.hasInvoiceFile !== null && { hasInvoiceFile: filters.hasInvoiceFile }),
    };
  });

  load(): void {
    // A backwards range would return nothing and read as "no invoices exist"; the page
    // shows the range error instead and does not ask the server a meaningless question.
    if (this.invalidDateRange()) {
      this.purchasesState.set([]);
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

        this.purchasesState.set(page.items);
        this.paginationState.set(page.pagination);
        this.loadingState.set(false);
      },
      error: (error: AppError) => {
        if (sequence !== this.requestSequence) {
          return;
        }

        this.errorState.set(error);
        this.purchasesState.set([]);
        this.loadingState.set(false);
      },
    });

    // Guarded by the same sequence: the totals must describe the filter the rows do.
    this.service.summary(query).subscribe({
      next: (summary) => {
        if (sequence === this.requestSequence) {
          this.summaryState.set(summary);
        }
      },
      // Swallowed: the counts are a header decoration and the list's own error banner
      // already reports a broken connection. Two banners for one outage is noise.
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

  /**
   * `options.load: false` sets the filter without fetching.
   *
   * For the one caller that applies a filter from the URL *before* the page's first load:
   * without it the page would fire an unfiltered request and then immediately supersede it
   * with a filtered one, and the user would see the wrong rows flash past.
   */
  setSupplier(supplierId: string | null, options?: { readonly load?: boolean }): void {
    this.supplierIdState.set(supplierId);
    this.resetToFirstPage();

    if (options?.load !== false) {
      this.load();
    }
  }

  setGstTreatment(treatment: GstTreatment | null): void {
    this.gstTreatmentState.set(treatment);
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

  setHasInvoiceFile(hasFile: boolean | null): void {
    this.hasInvoiceFileState.set(hasFile);
    this.resetToFirstPage();
    this.load();
  }

  clearFilters(): void {
    this.searchState.set('');
    this.supplierIdState.set(null);
    this.gstTreatmentState.set(null);
    this.fromDateState.set(null);
    this.toDateState.set(null);
    this.hasInvoiceFileState.set(null);
    this.resetToFirstPage();
    this.load();
  }

  setSort(field: PurchaseSortField, direction: 'asc' | 'desc'): void {
    this.sortFieldState.set(field);
    this.sortDirectionState.set(direction);
    this.resetToFirstPage();
    this.load();
  }

  setPage(page: number, pageSize: number): void {
    this.paginationState.update((pagination) => ({ ...pagination, page, pageSize }));
    this.load();
  }

  /** Replaces one row in place — used after an invoice upload, which changes only that row. */
  replace(purchase: Purchase): void {
    this.purchasesState.update((rows) =>
      rows.map((row) => (row.id === purchase.id ? purchase : row)),
    );
  }

  reload(): void {
    this.load();
  }

  /** An emptied date input reports `''`, which is not a filter. */
  private normaliseDate(date: string | null): string | null {
    return date === null || date.length === 0 ? null : date;
  }

  private resetToFirstPage(): void {
    this.paginationState.update((pagination) => ({ ...pagination, page: 1 }));
  }
}
