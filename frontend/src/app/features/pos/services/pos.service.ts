import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiService, type QueryParams } from '../../../core/http/api.service';
import { skipErrorNotification } from '../../../core/http/interceptors/error.interceptor';
import { skipLoading } from '../../../core/http/interceptors/loading.interceptor';
import type { Paginated } from '../../../core/models/api-response.model';
import type {
  MenuCategory,
  Order,
  OrderQuery,
  PlaceOrderRequest,
  PaymentMethod,
  PosDaySummary,
  Product,
} from '../models/pos.model';

const ENDPOINTS = {
  menu: '/pos/menu',
  summary: '/pos/summary',
  orders: '/pos/orders',
  order: (id: string): string => `/pos/orders/${id}`,
  payment: (id: string): string => `/pos/orders/${id}/payment`,
  cancel: (id: string): string => `/pos/orders/${id}/cancel`,
  availability: (id: string): string => `/pos/products/${id}/availability`,
} as const;

/**
 * Typed HTTP access to the POS API.
 *
 * Stateless, like every other feature service here — the cart lives in `PosCartStore`.
 */
@Injectable({ providedIn: 'root' })
export class PosService {
  private readonly api = inject(ApiService);

  /** The whole menu in one request. Sixteen products; paging it would cost round trips. */
  menu(includeUnavailable = true): Observable<readonly MenuCategory[]> {
    return this.api.get<readonly MenuCategory[]>(ENDPOINTS.menu, {
      params: { includeUnavailable: String(includeUnavailable) },
    });
  }

  /**
   * Today's figures. Passes `skipLoading()` because the POS home polls it, and driving the
   * global progress bar from a timer would leave the app looking permanently busy.
   */
  summary(date?: string): Observable<PosDaySummary> {
    return this.api.get<PosDaySummary>(ENDPOINTS.summary, {
      params: date === undefined ? {} : { date },
      context: skipLoading(),
    });
  }

  orders(query: OrderQuery): Observable<Paginated<Order>> {
    return this.api.getPage<Order>(ENDPOINTS.orders, { params: query as QueryParams });
  }

  order(id: string): Observable<Order> {
    return this.api.get<Order>(ENDPOINTS.order(id));
  }

  /**
   * Takes the whole order, payment included when the money is already in hand.
   *
   * `idempotencyKey` identifies the *attempt*, not the order, and the caller must hold the same
   * one across every retry of one cart. That is what makes a second tap after a lost reply
   * return the original order instead of charging the customer twice — the server keys on it
   * and answers with what it already saved.
   *
   * A fresh key is therefore required for a genuinely new order, and reusing one across two
   * different carts would silently discard the second.
   */
  place(request: PlaceOrderRequest, idempotencyKey: string): Observable<Order> {
    return this.api.post<Order>(ENDPOINTS.orders, request, {
      headers: { 'Idempotency-Key': idempotencyKey },
      /*
       * No toast on failure: the payment sheet reports it inline, beside the amount and the
       * method that were just keyed. A snackbar as well would say the same thing twice, in the
       * corner of a phone, and vanish while the order is still unsaved.
       */
      context: skipErrorNotification(),
    });
  }

  receivePayment(id: string, method: PaymentMethod, reference?: string): Observable<Order> {
    return this.api.post<Order>(ENDPOINTS.payment(id), { method, reference });
  }

  cancel(id: string, reason: string): Observable<Order> {
    return this.api.post<Order>(ENDPOINTS.cancel(id), { reason });
  }

  setAvailability(id: string, isAvailable: boolean): Observable<Product> {
    return this.api.patch<Product>(ENDPOINTS.availability(id), { isAvailable });
  }
}
