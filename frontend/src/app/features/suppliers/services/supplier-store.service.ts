import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import { DEFAULT_PAGE_SIZE } from '../../../core/constants/app.constants';
import type { AppError } from '../../../core/errors/app-error';
import type { PaginationMeta } from '../../../core/models/api-response.model';
import type { Supplier, SupplierQuery, SupplierSortField } from '../models/supplier.model';
import { SupplierService } from './supplier.service';

const EMPTY_PAGINATION: PaginationMeta = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrevious: false,
};

/**
 * List state for the suppliers page.
 *
 * Same shape as `InventoryStore` and `TransferStore`: signals throughout, an explicit
 * `load()` rather than a reactive effect — so changing a filter and resetting the page
 * fires one request, not two — and a request sequence number so a slow response cannot
 * overwrite a newer one.
 *
 * Provided by the list page, not at the root, so its filters are scoped to that page and
 * reset when the user leaves.
 */
@Injectable()
export class SupplierStore {
  private readonly service = inject(SupplierService);

  private readonly suppliersState = signal<readonly Supplier[]>([]);
  private readonly paginationState = signal<PaginationMeta>(EMPTY_PAGINATION);
  private readonly searchState = signal('');
  private readonly isActiveState = signal<boolean | null>(null);
  private readonly stateCodeState = signal<string | null>(null);
  private readonly sortFieldState = signal<SupplierSortField>('name');
  private readonly sortDirectionState = signal<'asc' | 'desc'>('asc');
  private readonly loadingState = signal(false);
  private readonly errorState = signal<AppError | null>(null);

  private requestSequence = 0;

  readonly suppliers: Signal<readonly Supplier[]> = this.suppliersState.asReadonly();
  readonly pagination: Signal<PaginationMeta> = this.paginationState.asReadonly();
  readonly loading: Signal<boolean> = this.loadingState.asReadonly();
  readonly error: Signal<AppError | null> = this.errorState.asReadonly();
  readonly searchTerm: Signal<string> = this.searchState.asReadonly();
  readonly sortField: Signal<SupplierSortField> = this.sortFieldState.asReadonly();
  readonly sortDirection: Signal<'asc' | 'desc'> = this.sortDirectionState.asReadonly();

  readonly filters = computed(() => ({
    isActive: this.isActiveState(),
    stateCode: this.stateCodeState(),
  }));

  readonly hasActiveFilters: Signal<boolean> = computed(
    () =>
      this.searchState().length > 0 ||
      this.isActiveState() !== null ||
      this.stateCodeState() !== null,
  );

  readonly isEmptyDueToFilters: Signal<boolean> = computed(
    () => this.suppliersState().length === 0 && this.hasActiveFilters() && !this.loadingState(),
  );

  readonly query: Signal<SupplierQuery> = computed(() => {
    const search = this.searchState();
    const isActive = this.isActiveState();
    const stateCode = this.stateCodeState();
    const pagination = this.paginationState();

    return {
      page: pagination.page,
      pageSize: pagination.pageSize,
      sortField: this.sortFieldState(),
      sortDirection: this.sortDirectionState(),
      ...(search.length > 0 && { search }),
      ...(isActive !== null && { isActive }),
      ...(stateCode !== null && { stateCode }),
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

        this.suppliersState.set(page.items);
        this.paginationState.set(page.pagination);
        this.loadingState.set(false);
      },
      error: (error: AppError) => {
        if (sequence !== this.requestSequence) {
          return;
        }

        this.errorState.set(error);
        this.suppliersState.set([]);
        this.loadingState.set(false);
      },
    });
  }

  setSearch(search: string): void {
    this.searchState.set(search);
    this.resetToFirstPage();
    this.load();
  }

  setIsActive(isActive: boolean | null): void {
    this.isActiveState.set(isActive);
    this.resetToFirstPage();
    this.load();
  }

  setStateCode(stateCode: string | null): void {
    this.stateCodeState.set(stateCode);
    this.resetToFirstPage();
    this.load();
  }

  clearFilters(): void {
    this.searchState.set('');
    this.isActiveState.set(null);
    this.stateCodeState.set(null);
    this.resetToFirstPage();
    this.load();
  }

  setSort(field: SupplierSortField, direction: 'asc' | 'desc'): void {
    this.sortFieldState.set(field);
    this.sortDirectionState.set(direction);
    this.resetToFirstPage();
    this.load();
  }

  setPage(page: number, pageSize: number): void {
    this.paginationState.update((pagination) => ({ ...pagination, page, pageSize }));
    this.load();
  }

  private resetToFirstPage(): void {
    this.paginationState.update((pagination) => ({ ...pagination, page: 1 }));
  }
}
