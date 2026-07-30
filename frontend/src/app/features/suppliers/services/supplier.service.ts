import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';
import { ApiService, type QueryParams } from '../../../core/http/api.service';
import type { ApiSuccessResponse, Paginated } from '../../../core/models/api-response.model';
import type {
  CreateSupplierRequest,
  Supplier,
  SupplierOption,
  SupplierQuery,
  UpdateSupplierRequest,
} from '../models/supplier.model';

const ENDPOINTS = {
  root: '/suppliers',
  options: '/suppliers/options',
  byId: (id: string): string => `/suppliers/${id}`,
} as const;

/**
 * Typed HTTP access to the supplier API.
 *
 * Stateless, like every other feature service here — state lives in `SupplierStore`.
 * Root-provided because the purchase form needs `options()` without inheriting the
 * supplier list page's filters.
 */
@Injectable({ providedIn: 'root' })
export class SupplierService {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);

  list(query: SupplierQuery): Observable<Paginated<Supplier>> {
    const params: QueryParams = {
      page: query.page,
      pageSize: query.pageSize,
      sortField: query.sortField,
      sortDirection: query.sortDirection,
      search: query.search,
      stateCode: query.stateCode,
      // The API's schema accepts only the string forms, and `undefined` is dropped by
      // `ApiService` so an unset filter is absent rather than sent as "undefined".
      isActive: query.isActive === undefined ? undefined : String(query.isActive),
    };

    return this.api.getPage<Supplier>(ENDPOINTS.root, { params });
  }

  /** Every selectable supplier, unpaginated — a paged vendor select is unusable. */
  options(): Observable<readonly SupplierOption[]> {
    return this.api.get<readonly SupplierOption[]>(ENDPOINTS.options);
  }

  getById(id: string): Observable<Supplier> {
    return this.api.get<Supplier>(ENDPOINTS.byId(id));
  }

  create(request: CreateSupplierRequest): Observable<Supplier> {
    return this.api.post<Supplier>(ENDPOINTS.root, request);
  }

  update(id: string, request: UpdateSupplierRequest): Observable<Supplier> {
    return this.api.patch<Supplier>(ENDPOINTS.byId(id), request);
  }

  /**
   * Removes a supplier, and reports which of the two things the server did.
   *
   * The endpoint is not a plain delete. A supplier **with** purchase history is
   * deactivated instead of removed — its invoices must keep naming it — and the response
   * is `200` carrying the now-inactive supplier. One **without** history is soft-deleted
   * and the response is `204`. Those are different outcomes and the user has to be told
   * them apart, so this returns the supplier or `null` rather than `void`.
   *
   * `HttpClient` directly rather than `ApiService.delete`, which maps every response to
   * `undefined` and would throw that distinction away.
   */
  remove(id: string): Observable<Supplier | null> {
    return this.http
      .delete<ApiSuccessResponse<Supplier> | null>(ENDPOINTS.byId(id))
      .pipe(map((response) => response?.data ?? null));
  }
}
