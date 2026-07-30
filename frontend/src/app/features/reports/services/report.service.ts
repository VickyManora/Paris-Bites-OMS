import { HttpClient, type HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';
import { ApiService, type QueryParams } from '../../../core/http/api.service';
import type {
  ReportDescriptor,
  ReportFormat,
  ReportId,
  ReportQuery,
  ReportResult,
} from '../models/report.model';

const ENDPOINTS = {
  root: '/reports',
  byId: (id: ReportId): string => `/reports/${id}`,
  export: (id: ReportId): string => `/reports/${id}/export`,
} as const;

/** A downloaded file, with the name the server chose. */
export interface DownloadedFile {
  readonly blob: Blob;
  readonly filename: string;
}

/** Falls back to a sensible name if the header is unreadable, so a click is never lost. */
function filenameFrom(response: HttpResponse<Blob>, fallback: string): string {
  const header = response.headers.get('Content-Disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);

  return match?.[1] === undefined ? fallback : decodeURIComponent(match[1]);
}

@Injectable({ providedIn: 'root' })
export class ReportService {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);

  /**
   * The reports this user may run.
   *
   * The list is server-filtered, so the picker cannot offer a report that then 403s —
   * a Store Manager simply never sees Purchases.
   */
  listReports(): Observable<readonly ReportDescriptor[]> {
    return this.api.get<readonly ReportDescriptor[]>(ENDPOINTS.root);
  }

  run(id: ReportId, query: ReportQuery): Observable<ReportResult> {
    return this.api.get<ReportResult>(ENDPOINTS.byId(id), { params: this.toParams(query) });
  }

  /**
   * Downloads the whole filtered set as a file.
   *
   * Paging is deliberately not forwarded. The server exports everything the filters match;
   * sending the page would produce a spreadsheet of 25 rows that reads as the whole period.
   */
  export(
    id: ReportId,
    format: ReportFormat,
    query: Omit<ReportQuery, 'page' | 'pageSize'>,
  ): Observable<DownloadedFile> {
    return this.http
      .get(ENDPOINTS.export(id), {
        params: this.toHttpParams({ ...query, format }),
        responseType: 'blob',
        observe: 'response',
      })
      .pipe(
        map((response) => ({
          blob: response.body ?? new Blob(),
          filename: filenameFrom(response, `${id}.${format}`),
        })),
      );
  }

  private toParams(query: ReportQuery): QueryParams {
    return {
      page: query.page,
      pageSize: query.pageSize,
      ...this.filterParams(query),
    };
  }

  private filterParams(query: Omit<ReportQuery, 'page' | 'pageSize'>): QueryParams {
    return {
      // Blanks are normalised to `undefined` so `ApiService` drops them: the API rejects
      // an empty `search`, which would turn "user cleared the box" into a 422.
      search: this.blankToUndefined(query.search),
      fromDate: this.blankToUndefined(query.fromDate),
      toDate: this.blankToUndefined(query.toDate),
      location: this.blankToUndefined(query.location),
      supplierId: this.blankToUndefined(query.supplierId),
      sortField: this.blankToUndefined(query.sortField),
      sortDirection: this.blankToUndefined(query.sortDirection),
    };
  }

  /** `HttpParams` for the blob call, which bypasses `ApiService`. */
  private toHttpParams(
    query: Omit<ReportQuery, 'page' | 'pageSize'> & { format: ReportFormat },
  ): Record<string, string> {
    const params: Record<string, string> = { format: query.format };

    for (const [key, value] of Object.entries(this.filterParams(query))) {
      if (value !== null && value !== undefined) {
        params[key] = String(value);
      }
    }

    return params;
  }

  private blankToUndefined(value: string | undefined): string | undefined {
    return value === undefined || value.trim().length === 0 ? undefined : value.trim();
  }
}
