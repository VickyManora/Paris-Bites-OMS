import { inject, Injectable } from '@angular/core';
import { EMPTY, expand, reduce, type Observable } from 'rxjs';
import { ApiService, type QueryParams } from '../../../core/http/api.service';
import type { Paginated } from '../../../core/models/api-response.model';
import type {
  AdjustQuantityRequest,
  CreateInventoryItemRequest,
  InventoryDashboard,
  InventoryHistoryEntry,
  InventoryItem,
  InventoryQuery,
  SupplierOption,
  UpdateInventoryItemRequest,
} from '../models/inventory.model';

const ENDPOINTS = {
  items: '/inventory/items',
  item: (id: string): string => `/inventory/items/${id}`,
  quantity: (id: string): string => `/inventory/items/${id}/quantity`,
  history: (id: string): string => `/inventory/items/${id}/history`,
  dashboard: '/inventory/dashboard',
  supplierOptions: '/suppliers/options',
} as const;

/**
 * Typed HTTP access to the inventory API.
 *
 * Deliberately stateless — every method is a request. State lives in
 * `InventoryStore`, which is signal-based. Keeping the two apart means the service can be
 * called from anywhere (a dashboard widget, a future export) without inheriting a list
 * page's filters, and the store can be tested by faking this one class.
 */
@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly api = inject(ApiService);

  /**
   * Paginated, filtered, sorted list.
   *
   * `undefined` filter values are dropped by `ApiService`, so an unset filter is absent
   * from the query string rather than sent as the string "undefined".
   */
  list(query: InventoryQuery): Observable<Paginated<InventoryItem>> {
    const params: QueryParams = {
      page: query.page,
      pageSize: query.pageSize,
      sortField: query.sortField,
      sortDirection: query.sortDirection,
      search: query.search,
      category: query.category,
      location: query.location,
      unit: query.unit,
      status: query.status,
      // Sent only when true: `needsRestocking=false` would be a meaningless filter, and
      // the API's schema only accepts the string forms.
      needsRestocking: query.needsRestocking === true ? 'true' : undefined,
    };

    return this.api.getPage<InventoryItem>(ENDPOINTS.items, { params });
  }

  getById(id: string): Observable<InventoryItem> {
    return this.api.get<InventoryItem>(ENDPOINTS.item(id));
  }

  create(request: CreateInventoryItemRequest): Observable<InventoryItem> {
    return this.api.post<InventoryItem>(ENDPOINTS.items, request);
  }

  update(id: string, request: UpdateInventoryItemRequest): Observable<InventoryItem> {
    return this.api.patch<InventoryItem>(ENDPOINTS.item(id), request);
  }

  /** Stock changes only. Metadata edits go through `update`. */
  adjustQuantity(id: string, request: AdjustQuantityRequest): Observable<InventoryItem> {
    return this.api.patch<InventoryItem>(ENDPOINTS.quantity(id), request);
  }

  delete(id: string): Observable<void> {
    return this.api.delete(ENDPOINTS.item(id));
  }

  /**
   * Suppliers for the item form's dropdown, unpaginated.
   *
   * Reaches outside the inventory endpoints because the client has no suppliers feature
   * yet and this form is the only consumer. It belongs in a `SupplierService` as soon as
   * a second screen needs one.
   */
  supplierOptions(): Observable<readonly SupplierOption[]> {
    return this.api.get<readonly SupplierOption[]>(ENDPOINTS.supplierOptions);
  }

  history(
    id: string,
    page: number,
    pageSize: number,
  ): Observable<Paginated<InventoryHistoryEntry>> {
    return this.api.getPage<InventoryHistoryEntry>(ENDPOINTS.history(id), {
      params: { page, pageSize },
    });
  }

  dashboard(): Observable<InventoryDashboard> {
    return this.api.get<InventoryDashboard>(ENDPOINTS.dashboard);
  }

  /**
   * Every active Home Warehouse item, following pagination to the end.
   *
   * For pickers that must list everything — the purchase form's item select, above all.
   * A paged select is one the user cannot find their ingredient in.
   *
   * It **walks the pages** rather than asking for one big one. Requesting `pageSize=200`
   * is the obvious shortcut and it is wrong: the API caps a page at 100 and answers 422,
   * which surfaced as a silently empty dropdown.
   *
   * `MAX_PAGES` is a backstop, not a business limit. It bounds the loop if `hasNext` is
   * ever wrong, so a server bug degrades to a truncated list instead of hanging the form
   * on an infinite request chain.
   */
  listAllSelectable(): Observable<readonly InventoryItem[]> {
    const PAGE_SIZE = 100;
    const MAX_PAGES = 20;

    const fetchPage = (page: number): Observable<Paginated<InventoryItem>> =>
      this.list({
        page,
        pageSize: PAGE_SIZE,
        sortField: 'name',
        sortDirection: 'asc',
        location: 'HOME_WAREHOUSE',
        status: 'ACTIVE',
      });

    return fetchPage(1).pipe(
      expand((result) =>
        result.pagination.hasNext && result.pagination.page < MAX_PAGES
          ? fetchPage(result.pagination.page + 1)
          : EMPTY,
      ),
      reduce<Paginated<InventoryItem>, InventoryItem[]>(
        (all, result) => [...all, ...result.items],
        [],
      ),
    );
  }
}
