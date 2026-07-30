import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  signal,
  type Signal,
} from '@angular/core';
import { type Subscription, switchMap, timer } from 'rxjs';
import { AuthService } from '../../auth/services/auth.service';
import type { AppError } from '../../errors/app-error';
import { LoggerService } from '../../services/logger.service';
import type { AppNotification } from '../models/notification.model';
import { NotificationFeedService } from './notification-feed.service';

/**
 * How often the badge is refreshed while a tab is open.
 *
 * A minute is a deliberate compromise. Transfers are approved on a human timescale — the
 * requester is not watching the bell for a sub-second update — and this is one query per
 * signed-in tab per minute against an index. Anything faster buys nothing real and
 * multiplies by staff count; anything slower makes the bell feel broken.
 *
 * Real-time delivery wants SSE or a websocket, which needs sticky sessions or a shared
 * bus once the API runs on more than one instance. Polling is the honest choice at this
 * scale, and the store is the only thing that would change.
 */
const POLL_INTERVAL_MS = 60_000;

/** Newest N shown in the bell panel. The API caps this at 20 regardless. */
const FEED_LIMIT = 10;

/** Above this the badge reads "9+", so the button never changes width. */
const BADGE_CAP = 9;

/**
 * Bell state: what the panel shows and how many are unread.
 *
 * Root-provided rather than supplied by a page, because the bell lives in the shell and
 * outlives every route. That is also why it owns its polling lifecycle instead of relying
 * on a component's.
 *
 * The unread count is **always** whatever the server last said. Nothing here decrements
 * it locally: a second tab, or the poll, will have counted the same read, and a badge
 * that drifts below zero — or sticks at one forever — is the classic bug in this feature.
 * Every mutation endpoint returns the fresh count for exactly this reason.
 */
@Injectable({ providedIn: 'root' })
export class NotificationStore {
  private readonly service = inject(NotificationFeedService);
  private readonly auth = inject(AuthService);
  private readonly logger = inject(LoggerService);

  private readonly itemsState = signal<readonly AppNotification[]>([]);
  private readonly unreadCountState = signal(0);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<AppError | null>(null);

  /** Guards against rendering a superseded feed response. */
  private requestSequence = 0;
  private pollSubscription: Subscription | null = null;

  readonly items: Signal<readonly AppNotification[]> = this.itemsState.asReadonly();
  readonly unreadCount: Signal<number> = this.unreadCountState.asReadonly();
  readonly loading: Signal<boolean> = this.loadingState.asReadonly();
  readonly error: Signal<AppError | null> = this.errorState.asReadonly();

  readonly hasUnread: Signal<boolean> = computed(() => this.unreadCountState() > 0);
  readonly isEmpty: Signal<boolean> = computed(
    () => this.itemsState().length === 0 && !this.loadingState(),
  );

  /** `"9+"` past the cap, so a busy inbox cannot resize the toolbar button. */
  readonly badgeLabel: Signal<string> = computed(() => {
    const count = this.unreadCountState();
    return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
  });

  /** Announced to screen readers, which need the real number and a noun. */
  readonly badgeDescription: Signal<string> = computed(() => {
    const count = this.unreadCountState();

    if (count === 0) {
      return 'Notifications — none unread';
    }

    return `Notifications — ${count} unread`;
  });

  constructor() {
    /*
     * Polling follows the session, not the component tree.
     *
     * Starting on sign-in and stopping on sign-out is what keeps an unauthenticated tab
     * from firing a 401 every minute, and — more importantly — stops one user's unread
     * count surviving into the next user's session on a shared terminal.
     */
    effect(() => {
      if (this.auth.isAuthenticated()) {
        this.startPolling();
      } else {
        this.stopPolling();
        this.reset();
      }
    });

    inject(DestroyRef).onDestroy(() => this.stopPolling());
  }

  /**
   * Loads the panel contents. Called when the bell is opened.
   *
   * Always refetches rather than trusting what the last poll left behind: the panel is
   * the one moment the user is actually looking, so it is worth a round trip to be
   * current.
   */
  loadFeed(): void {
    const sequence = ++this.requestSequence;

    this.loadingState.set(true);
    this.errorState.set(null);

    this.service.feed(FEED_LIMIT).subscribe({
      next: (feed) => {
        if (sequence !== this.requestSequence) {
          return;
        }

        this.itemsState.set(feed.items);
        this.unreadCountState.set(feed.unreadCount);
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
   * The row is flipped locally *and* the count is taken from the response. The local flip
   * is what makes the click feel instant; the server's count is what keeps the badge
   * honest. Deliberately not `unreadCount - 1`.
   */
  markRead(notification: AppNotification): void {
    if (notification.isRead) {
      return;
    }

    this.itemsState.update((items) =>
      items.map((item) =>
        item.id === notification.id
          ? { ...item, isRead: true, readAt: new Date().toISOString() }
          : item,
      ),
    );

    this.service.markRead(notification.id).subscribe({
      next: ({ unreadCount }) => this.unreadCountState.set(unreadCount),
      error: (error: AppError) => {
        // Put the row back: a bell that silently lies about what has been read is worse
        // than one that occasionally fails to clear.
        this.itemsState.update((items) =>
          items.map((item) =>
            item.id === notification.id ? { ...item, isRead: false, readAt: null } : item,
          ),
        );
        this.logger.error('Failed to mark notification read', error);
      },
    });
  }

  /**
   * Adopts an unread count produced by another surface.
   *
   * The notification centre marks things read too, and the badge must follow immediately
   * rather than at the next poll — up to a minute of a badge insisting there are unread
   * items the user has just cleared is exactly the drift this store exists to prevent.
   *
   * Takes the server's number, like everything else here; it is never derived locally.
   * The panel's own list needs no patching, because opening the bell always refetches.
   */
  applyUnreadCount(unreadCount: number): void {
    this.unreadCountState.set(unreadCount);
  }

  markAllRead(): void {
    if (!this.hasUnread()) {
      return;
    }

    const previous = this.itemsState();
    const readAt = new Date().toISOString();

    this.itemsState.update((items) => items.map((item) => ({ ...item, isRead: true, readAt })));

    this.service.markAllRead().subscribe({
      next: ({ unreadCount }) => this.unreadCountState.set(unreadCount),
      error: (error: AppError) => {
        this.itemsState.set(previous);
        this.logger.error('Failed to mark all notifications read', error);
      },
    });
  }

  /**
   * Restarts the badge poll.
   *
   * `timer(0, …)` fires immediately, so a fresh sign-in shows its badge without waiting
   * out an interval. `switchMap` drops an in-flight request when the next tick arrives,
   * which is what stops a slow response queueing up behind a slower one.
   *
   * The error handler swallows and logs rather than surfacing a toast: a failed
   * background poll is not something the user asked for or can act on. It does end the
   * subscription, so the next sign-in — or `loadFeed` on opening the panel — is what
   * recovers.
   */
  private startPolling(): void {
    this.stopPolling();

    this.pollSubscription = timer(0, POLL_INTERVAL_MS)
      .pipe(switchMap(() => this.service.unreadCount()))
      .subscribe({
        next: ({ unreadCount }) => this.unreadCountState.set(unreadCount),
        error: (error: AppError) => this.logger.error('Notification poll failed', error),
      });
  }

  private stopPolling(): void {
    this.pollSubscription?.unsubscribe();
    this.pollSubscription = null;
  }

  private reset(): void {
    // Invalidate any in-flight feed request, so a response that lands after sign-out
    // cannot repopulate the panel for the next user.
    this.requestSequence++;
    this.itemsState.set([]);
    this.unreadCountState.set(0);
    this.errorState.set(null);
    this.loadingState.set(false);
  }
}
