import { HttpClient, type HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';
import { ApiService } from '../../../core/http/api.service';
import type { ReportFormat } from '../../reports/models/report.model';
import type { Analytics, AnalyticsQuery } from '../models/analytics.model';

const ENDPOINTS = {
  root: '/analytics',
  export: '/analytics/export',
} as const;

export interface DownloadedFile {
  readonly blob: Blob;
  readonly filename: string;
}

function filenameFrom(response: HttpResponse<Blob>, fallback: string): string {
  const header = response.headers.get('Content-Disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);

  return match?.[1] === undefined ? fallback : decodeURIComponent(match[1]);
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);

  get(query: AnalyticsQuery): Observable<Analytics> {
    return this.api.get<Analytics>(ENDPOINTS.root, { params: { ...query } });
  }

  /**
   * Downloads the snapshot as a file.
   *
   * The server re-runs the same query rather than accepting figures from here — a file
   * built from numbers the browser supplied would be a file anyone could put any number
   * into.
   */
  export(query: AnalyticsQuery, format: ReportFormat): Observable<DownloadedFile> {
    return this.http
      .get(ENDPOINTS.export, {
        params: { ...query, format },
        responseType: 'blob',
        observe: 'response',
      })
      .pipe(
        map((response) => ({
          blob: response.body ?? new Blob(),
          filename: filenameFrom(response, `analytics.${format}`),
        })),
      );
  }
}
