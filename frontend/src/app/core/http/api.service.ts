import { HttpClient, type HttpContext, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, type Observable } from 'rxjs';
import type { ApiSuccessResponse, Paginated, PaginationMeta } from '../models/api-response.model';

/** Query parameter values accepted by `ApiService`. `undefined` keys are dropped. */
export type QueryParams = Readonly<
  Record<string, string | number | boolean | readonly string[] | null | undefined>
>;

export interface RequestOptions {
  readonly params?: QueryParams;
  readonly context?: HttpContext;
  /**
   * Extra request headers.
   *
   * For protocol concerns the server reads directly, such as `Idempotency-Key`. Anything the
   * *client* needs to inspect belongs in `context` instead, which stays local and is typed.
   *
   * Note that a non-safelisted header triggers a CORS preflight, so the backend allowlist has
   * to name it — see `allowedHeaders` in the API's CORS setup.
   */
  readonly headers?: Readonly<Record<string, string>>;
}

const EMPTY_PAGINATION: PaginationMeta = {
  page: 1,
  pageSize: 0,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrevious: false,
};

/**
 * Typed wrapper over `HttpClient` that unwraps the API's response envelope.
 *
 * Without this, every feature service repeats `.pipe(map((r) => r.data))` and
 * each one is a chance to get the generic parameter wrong. Feature services
 * extend or inject this and stay focused on endpoints and domain types.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  get<T>(url: string, options?: RequestOptions): Observable<T> {
    return this.http
      .get<ApiSuccessResponse<T>>(url, this.buildOptions(options))
      .pipe(map((response) => response.data));
  }

  /**
   * `GET` for a paginated collection, flattening `data` and `meta.pagination`
   * into one object so callers do not reach into `meta`.
   */
  getPage<T>(url: string, options?: RequestOptions): Observable<Paginated<T>> {
    return this.http.get<ApiSuccessResponse<readonly T[]>>(url, this.buildOptions(options)).pipe(
      map((response) => ({
        items: response.data,
        pagination: response.meta?.pagination ?? {
          ...EMPTY_PAGINATION,
          pageSize: response.data.length,
          total: response.data.length,
        },
      })),
    );
  }

  post<T>(url: string, body: unknown, options?: RequestOptions): Observable<T> {
    return this.http
      .post<ApiSuccessResponse<T>>(url, body, this.buildOptions(options))
      .pipe(map((response) => response.data));
  }

  put<T>(url: string, body: unknown, options?: RequestOptions): Observable<T> {
    return this.http
      .put<ApiSuccessResponse<T>>(url, body, this.buildOptions(options))
      .pipe(map((response) => response.data));
  }

  patch<T>(url: string, body: unknown, options?: RequestOptions): Observable<T> {
    return this.http
      .patch<ApiSuccessResponse<T>>(url, body, this.buildOptions(options))
      .pipe(map((response) => response.data));
  }

  /** `DELETE`. Typed as `void` because the API replies 204 with no body. */
  delete(url: string, options?: RequestOptions): Observable<void> {
    return this.http.delete<void>(url, this.buildOptions(options)).pipe(map(() => undefined));
  }

  /**
   * Builds `HttpParams`, skipping null and undefined so an unset filter is
   * absent rather than sent as the string "undefined".
   */
  private buildOptions(options?: RequestOptions): {
    params?: HttpParams;
    context?: HttpContext;
    headers?: HttpHeaders;
  } {
    const result: { params?: HttpParams; context?: HttpContext; headers?: HttpHeaders } = {};

    if (options?.context !== undefined) {
      result.context = options.context;
    }

    if (options?.headers !== undefined) {
      result.headers = new HttpHeaders(options.headers);
    }

    if (options?.params === undefined) {
      return result;
    }

    let params = new HttpParams();

    for (const [key, value] of Object.entries(options.params)) {
      if (value === null || value === undefined) {
        continue;
      }

      // `Array.isArray` widens a `readonly string[]` to `any[]`, so re-narrow
      // explicitly rather than appending an implicitly-typed value.
      if (Array.isArray(value)) {
        for (const entry of value as readonly string[]) {
          params = params.append(key, entry);
        }
      } else {
        params = params.set(key, String(value));
      }
    }

    result.params = params;
    return result;
  }
}
