import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import { DEFAULT_PAGE_SIZE } from '../../../core/constants/app.constants';
import type { AppError } from '../../../core/errors/app-error';
import type { PaginationMeta } from '../../../core/models/api-response.model';
import type { AppNotification } from '../../../core/notifications/models/notification.model';
import { NotificationFeedService } from '../../../core/notifications/services/notification-feed.service';
import { NotificationStore } from '../../../core/notifications/services/notification-store.service';

const EMPTY_PAGINATION: PaginationMeta = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrevious: false,
};

/**
 * State for the notification centre.
 *
 * Separate from the root `NotificationStore`, which owns the bell: that one holds the
 * newest ten and a polled count and lives for the whole session, this one holds a page of
 * history and dies with the route. Merging them would give the bell a page number.
 *
 * They are not independent, though — **both show the same unread count**, and every
 * mutation here pushes the server's fresh count into the bell's store. Marking a
 * notification read on this page while the badge kept its old number for up to a minute
 * is the obvious bug in a two-surface inbox, and this is where it is avoided.
 */
@Injectable()
export class NotificationCenterStore {
  private readonly service = inject(NotificationFeedService);
  /** The bell's store, so the badge follows what happens on this page immediately. */
  private readonly bell = inject(NotificationStore);

  private readonly itemsState = signal<readonly AppNotification[]>([]);
  private readonly paginationState = signal<PaginationMeta>(EMPTY_PAGINATION);
  private readonly unreadOnlyState = signal(false);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<AppError | null>(null);
  private readonly pageState = signal(1);
  private readonly pageSizeState = signal(DEFAULT_PAGE_SIZE);

  /** Guards against a slow response for an old filter overwriting a newer one. */
  private requestSequence = 0;

  readonly items: Signal<readonly AppNotification[]> = this.itemsState.asReadonly();
  readonly pagination: Signal<PaginationMeta> = this.paginationState.asReadonly();
  readonly unreadOnly: Signal<boolean> = this.unreadOnlyState.asReadonly();
  readonly loading: Signal<boolean> = this.loadingState.asReadonly();
  readonly error: Signal<AppError | null> = this.errorState.asReadonly();

  /** Straight from the bell's store, which is the one place the count is kept. */
  readonly unreadCount: Signal<number> = this.bell.unreadCount;
  readonly hasUnread: Signal<boolean> = computed(() => this.unreadCount() > 0);

  readonly isEmpty: Signal<boolean> = computed(
    () => this.itemsState().length === 0 && !this.loadingState() && this.errorState() === null,
  );

  setUnreadOnly(unreadOnly: boolean): void {
    if (unreadOnly === this.unreadOnlyState()) {
      return;
    }

    this.unreadOnlyState.set(unreadOnly);
    // Back to page one: page 4 of "all" is usually past the end of "unread".
    this.pageState.set(1);
    this.load();
  }

  setPage(page: number, pageSize: number): void {
    this.pageState.set(page);
    this.pageSizeState.set(pageSize);
    this.load();
  }

  load(): void {
    const sequence = ++this.requestSequence;

    this.loadingState.set(true);
    this.errorState.set(null);

    this.service.list(this.pageState(), this.pageSizeState(), this.unreadOnlyState()).subscribe({
      next: (result) => {
        if (sequence !== this.requestSequence) {
          return;
        }

        this.itemsState.set(result.items);
        this.paginationState.set(result.pagination);
        this.loadingState.set(false);
      },
      error: (error: AppError) => {
        if (sequence !== this.requestSequence) {
          return;
        }

        this.errorState.set(error);
        this.loadingState.set(false);
      },
    });
  }

  /**
   * Marks one read.
   *
   * The row is updated locally rather than by refetching the page: a refetch under the
   * "unread only" filter would make the row vanish from under the cursor mid-click, and
   * the user would not see which one they just dealt with.
   *
   * The count still comes from the server's response, never from decrementing here.
   */
  markRead(notification: AppNotification): void {
    if (notification.isRead) {
      return;
    }

    const readAt = new Date().toISOString();

    this.itemsState.update((items) =>
      items.map((item) => (item.id === notification.id ? { ...item, isRead: true, readAt } : item)),
    );

    this.service.markRead(notification.id).subscribe({
      next: (result) => this.bell.applyUnreadCount(result.unreadCount),
      // Left as read locally on failure would be a lie; the reload restores the truth.
      error: () => this.load(),
    });
  }

  markAllRead(): void {
    const readAt = new Date().toISOString();

    this.itemsState.update((items) =>
      items.map((item) => (item.isRead ? item : { ...item, isRead: true, readAt })),
    );

    this.service.markAllRead().subscribe({
      next: (result) => {
        this.bell.applyUnreadCount(result.unreadCount);

        // Under "unread only" the list is now, by definition, empty — reload so the page
        // says so rather than showing rows that no longer match the filter.
        if (this.unreadOnlyState()) {
          this.load();
        }
      },
      error: () => this.load(),
    });
  }
}
