import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, shareReplay, type Observable } from 'rxjs';
import { ApiService, type QueryParams } from '../../../core/http/api.service';
import type { ApiSuccessResponse, Paginated } from '../../../core/models/api-response.model';
import type {
  CreatePurchaseRequest,
  Purchase,
  PurchaseQuery,
  PurchaseResult,
  PurchaseSummary,
} from '../models/purchase.model';

const ENDPOINTS = {
  root: '/purchases',
  summary: '/purchases/summary',
  byId: (id: string): string => `/purchases/${id}`,
  invoice: (id: string): string => `/purchases/${id}/invoice`,
} as const;

/** The service descriptor at the API root, which carries the business's GST state. */
interface ApiDescriptor {
  readonly name: string;
  readonly version: string;
  readonly businessStateCode: string;
  readonly businessStateName: string;
}

@Injectable({ providedIn: 'root' })
export class PurchaseService {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);

  /**
   * The business's own GST state, fetched once and shared.
   *
   * `shareReplay({ refCount: false })` so every subscriber after the first gets the cached
   * value without a second request — this is deployment configuration, not data, and it
   * cannot change while the tab is open.
   */
  private readonly descriptor$: Observable<ApiDescriptor> = this.api
    .get<ApiDescriptor>('/')
    .pipe(shareReplay({ bufferSize: 1, refCount: false }));

  list(query: PurchaseQuery): Observable<Paginated<Purchase>> {
    return this.api.getPage<Purchase>(ENDPOINTS.root, { params: this.toParams(query) });
  }

  /** Totals for the *same* filter as the list, so the two never disagree. */
  summary(query: PurchaseQuery): Observable<PurchaseSummary> {
    return this.api.get<PurchaseSummary>(ENDPOINTS.summary, { params: this.toParams(query) });
  }

  getById(id: string): Observable<Purchase> {
    return this.api.get<Purchase>(ENDPOINTS.byId(id));
  }

  /** Records the invoice and adds its stock, in one transaction on the server. */
  create(request: CreatePurchaseRequest): Observable<PurchaseResult> {
    return this.api.post<PurchaseResult>(ENDPOINTS.root, request);
  }

  businessStateCode(): Observable<string> {
    return this.descriptor$.pipe(map((descriptor) => descriptor.businessStateCode));
  }

  /**
   * Uploads the scanned bill.
   *
   * Goes through `HttpClient` directly rather than `ApiService`, because the body is
   * `FormData`: setting `Content-Type: application/json` on it would strip the multipart
   * boundary and the server would parse nothing.
   *
   * The URL stays **relative** so `apiUrlInterceptor` still prefixes the base and attaches
   * the credentials and CSRF marker every other request carries — bypassing `ApiService`
   * should skip its JSON handling, not the app's transport policy.
   *
   * Typed as the success envelope, not `ApiResponse`: `errorInterceptor` converts every
   * failure into a thrown `AppError`, so a response that reaches here has already
   * succeeded and narrowing a union at each call site would be ceremony.
   */
  uploadInvoice(id: string, file: File): Observable<Purchase> {
    const body = new FormData();
    body.append('invoice', file);

    return this.http
      .post<ApiSuccessResponse<Purchase>>(ENDPOINTS.invoice(id), body)
      .pipe(map((response) => response.data));
  }

  /**
   * Fetches the bill as a blob.
   *
   * Not a plain `<a href>`: the endpoint requires an `Authorization` header, which a
   * browser navigation cannot carry. The caller turns this into an object URL.
   */
  downloadInvoice(id: string): Observable<Blob> {
    return this.http.get(ENDPOINTS.invoice(id), { responseType: 'blob' });
  }

  private toParams(query: PurchaseQuery): QueryParams {
    return {
      page: query.page,
      pageSize: query.pageSize,
      sortField: query.sortField,
      sortDirection: query.sortDirection,
      search: query.search,
      supplierId: query.supplierId,
      gstTreatment: query.gstTreatment,
      fromDate: query.fromDate,
      toDate: query.toDate,
      // The API's schema accepts only the string forms; `undefined` is dropped by
      // `ApiService`, so an unset filter is absent rather than sent as "undefined".
      hasInvoiceFile: query.hasInvoiceFile === undefined ? undefined : String(query.hasInvoiceFile),
    };
  }
}
