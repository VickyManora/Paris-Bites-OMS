import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiService, type QueryParams } from '../../../core/http/api.service';
import type { Paginated } from '../../../core/models/api-response.model';
import type {
  DailySalesEntry,
  DailySalesQuery,
  DailySalesSummary,
  RecordDailySalesRequest,
  UpdateDailySalesRequest,
} from '../models/daily-sales.model';

const ENDPOINTS = {
  root: '/daily-sales',
  summary: '/daily-sales/summary',
  byId: (id: string): string => `/daily-sales/${id}`,
  byDate: (date: string): string => `/daily-sales/by-date/${date}`,
} as const;

/**
 * Typed HTTP access to the daily sales API.
 *
 * Stateless, like every other feature service here — state lives in `DailySalesStore`.
 */
@Injectable({ providedIn: 'root' })
export class DailySalesService {
  private readonly api = inject(ApiService);

  list(query: DailySalesQuery): Observable<Paginated<DailySalesEntry>> {
    return this.api.getPage<DailySalesEntry>(ENDPOINTS.root, { params: this.toParams(query) });
  }

  /** Totals for the *same* filter as the list, so the two never disagree. */
  summary(query: DailySalesQuery): Observable<DailySalesSummary> {
    return this.api.get<DailySalesSummary>(ENDPOINTS.summary, { params: this.toParams(query) });
  }

  /** Includes the full revision history, which the detail view renders. */
  getById(id: string): Observable<DailySalesEntry> {
    return this.api.get<DailySalesEntry>(ENDPOINTS.byId(id));
  }

  /**
   * The entry for one day, or `null` when it has not been recorded.
   *
   * Null is the expected answer most of the time — it is what the form asks before
   * deciding between recording and correcting — so the API returns it rather than a 404.
   */
  getByDate(date: string): Observable<DailySalesEntry | null> {
    return this.api.get<DailySalesEntry | null>(ENDPOINTS.byDate(date));
  }

  record(request: RecordDailySalesRequest): Observable<DailySalesEntry> {
    return this.api.post<DailySalesEntry>(ENDPOINTS.root, request);
  }

  /**
   * Replaces the day. `PUT`, not `PATCH`: the body is the complete set of figures, and an
   * omitted channel would otherwise be ambiguous between "unchanged" and "actually zero".
   */
  update(id: string, request: UpdateDailySalesRequest): Observable<DailySalesEntry> {
    return this.api.put<DailySalesEntry>(ENDPOINTS.byId(id), request);
  }

  private toParams(query: DailySalesQuery): QueryParams {
    return {
      page: query.page,
      pageSize: query.pageSize,
      fromDate: query.fromDate,
      toDate: query.toDate,
      channel: query.channel,
      sortField: query.sortField,
      sortDirection: query.sortDirection,
    };
  }
}
