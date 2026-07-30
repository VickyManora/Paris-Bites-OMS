import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiService } from '../../http/api.service';
import { skipLoading } from '../../http/interceptors/loading.interceptor';
import type { Paginated } from '../../models/api-response.model';
import type { AppNotification, NotificationFeed, UnreadCount } from '../models/notification.model';

const ENDPOINTS = {
  root: '/notifications',
  feed: '/notifications/feed',
  unreadCount: '/notifications/unread-count',
  read: (id: string): string => `/notifications/${id}/read`,
  readAll: '/notifications/read-all',
} as const;

/**
 * Typed HTTP access to the notification API.
 *
 * Not to be confused with `core/services/notification.service.ts`, which shows toasts.
 * This one talks to the server about the bell; that one puts a snackbar on the screen.
 *
 * Stateless, like the other feature services — every method is a request, and the state
 * lives in `NotificationStore`.
 *
 * The reads pass `skipLoading()`. They are background polls, and driving the global
 * progress bar from a timer would leave the app looking permanently busy.
 */
@Injectable({ providedIn: 'root' })
export class NotificationFeedService {
  private readonly api = inject(ApiService);

  /** Newest few plus the unread count — one request, so the two cannot disagree. */
  feed(limit = 10): Observable<NotificationFeed> {
    return this.api.get<NotificationFeed>(ENDPOINTS.feed, {
      params: { limit },
      context: skipLoading(),
    });
  }

  /** Just the badge. Polled, so it is deliberately the cheapest call in the app. */
  unreadCount(): Observable<UnreadCount> {
    return this.api.get<UnreadCount>(ENDPOINTS.unreadCount, { context: skipLoading() });
  }

  /** The full inbox, paginated. */
  list(page: number, pageSize: number, unreadOnly = false): Observable<Paginated<AppNotification>> {
    return this.api.getPage<AppNotification>(ENDPOINTS.root, {
      params: { page, pageSize, unreadOnly },
    });
  }

  /** Returns the resulting unread count, so the badge is never computed client-side. */
  markRead(id: string): Observable<UnreadCount> {
    return this.api.post<UnreadCount>(ENDPOINTS.read(id), {}, { context: skipLoading() });
  }

  markAllRead(): Observable<UnreadCount> {
    return this.api.post<UnreadCount>(ENDPOINTS.readAll, {}, { context: skipLoading() });
  }
}
