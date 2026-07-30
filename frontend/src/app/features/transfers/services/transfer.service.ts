import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiService, type QueryParams } from '../../../core/http/api.service';
import type { Paginated } from '../../../core/models/api-response.model';
import type {
  CreateTransferRequest,
  StockTransfer,
  TransferQuery,
  TransferResult,
  TransferSummary,
} from '../models/transfer.model';

const ENDPOINTS = {
  root: '/transfers',
  summary: '/transfers/summary',
  byId: (id: string): string => `/transfers/${id}`,
  approve: (id: string): string => `/transfers/${id}/approve`,
  reject: (id: string): string => `/transfers/${id}/reject`,
  complete: (id: string): string => `/transfers/${id}/complete`,
} as const;

/**
 * Typed HTTP access to the stock transfer API.
 *
 * Stateless, like `InventoryService` — every method is a request. List state lives in
 * `TransferStore`.
 */
@Injectable({ providedIn: 'root' })
export class TransferService {
  private readonly api = inject(ApiService);

  list(query: TransferQuery): Observable<Paginated<StockTransfer>> {
    const params: QueryParams = {
      page: query.page,
      pageSize: query.pageSize,
      sortField: query.sortField,
      sortDirection: query.sortDirection,
      search: query.search,
      status: query.status,
    };

    return this.api.getPage<StockTransfer>(ENDPOINTS.root, { params });
  }

  getById(id: string): Observable<StockTransfer> {
    return this.api.get<StockTransfer>(ENDPOINTS.byId(id));
  }

  summary(): Observable<TransferSummary> {
    return this.api.get<TransferSummary>(ENDPOINTS.summary);
  }

  create(request: CreateTransferRequest): Observable<StockTransfer> {
    return this.api.post<StockTransfer>(ENDPOINTS.root, request);
  }

  /** Deducts the source location. Returns the per-item before/after. */
  approve(id: string, note?: string): Observable<TransferResult> {
    return this.api.post<TransferResult>(ENDPOINTS.approve(id), note === undefined ? {} : { note });
  }

  /** No stock moves. The reason is mandatory. */
  reject(id: string, reason: string): Observable<StockTransfer> {
    return this.api.post<StockTransfer>(ENDPOINTS.reject(id), { reason });
  }

  /** Credits the destination location. */
  complete(id: string): Observable<TransferResult> {
    return this.api.post<TransferResult>(ENDPOINTS.complete(id), {});
  }
}
