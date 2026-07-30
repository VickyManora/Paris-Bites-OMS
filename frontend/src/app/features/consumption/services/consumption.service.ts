import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiService, type QueryParams } from '../../../core/http/api.service';
import type { Paginated } from '../../../core/models/api-response.model';
import type {
  ConsumptionEntry,
  ConsumptionQuery,
  ConsumptionResult,
  ConsumptionSummary,
  RecordConsumptionRequest,
  UpdateConsumptionRequest,
  VoidConsumptionRequest,
} from '../models/consumption.model';

const ENDPOINTS = {
  root: '/consumption',
  summary: '/consumption/summary',
  byId: (id: string): string => `/consumption/${id}`,
  void: (id: string): string => `/consumption/${id}/void`,
} as const;

/**
 * Typed HTTP access to the daily-consumption API.
 *
 * Stateless, like every other feature service here — state lives in `ConsumptionStore`.
 */
@Injectable({ providedIn: 'root' })
export class ConsumptionService {
  private readonly api = inject(ApiService);

  list(query: ConsumptionQuery): Observable<Paginated<ConsumptionEntry>> {
    return this.api.getPage<ConsumptionEntry>(ENDPOINTS.root, { params: this.toParams(query) });
  }

  /** Totals for the *same* filter as the list, so the two never disagree. */
  summary(query: ConsumptionQuery): Observable<ConsumptionSummary> {
    return this.api.get<ConsumptionSummary>(ENDPOINTS.summary, { params: this.toParams(query) });
  }

  /** Includes the full revision history, which the detail view renders. */
  getById(id: string): Observable<ConsumptionEntry> {
    return this.api.get<ConsumptionEntry>(ENDPOINTS.byId(id));
  }

  /** Records the sheet and deducts its stock, in one transaction on the server. */
  record(request: RecordConsumptionRequest): Observable<ConsumptionResult> {
    return this.api.post<ConsumptionResult>(ENDPOINTS.root, request);
  }

  /**
   * Replaces the sheet. `PUT`, not `PATCH`: the body is the complete desired state and
   * the server computes the stock movement as a diff against what is stored.
   */
  update(id: string, request: UpdateConsumptionRequest): Observable<ConsumptionResult> {
    return this.api.put<ConsumptionResult>(ENDPOINTS.byId(id), request);
  }

  /** Returns the stock and marks the entry voided. Admin-only on the server. */
  void(id: string, request: VoidConsumptionRequest): Observable<ConsumptionResult> {
    return this.api.post<ConsumptionResult>(ENDPOINTS.void(id), request);
  }

  private toParams(query: ConsumptionQuery): QueryParams {
    return {
      page: query.page,
      pageSize: query.pageSize,
      sortField: query.sortField,
      sortDirection: query.sortDirection,
      search: query.search,
      location: query.location,
      itemId: query.itemId,
      fromDate: query.fromDate,
      toDate: query.toDate,
      // The API's schema accepts only the string forms; `undefined` is dropped by
      // `ApiService`, so an unset filter is absent rather than sent as "undefined".
      includeVoided: query.includeVoided === undefined ? undefined : String(query.includeVoided),
    };
  }
}
