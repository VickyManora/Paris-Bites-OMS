import type { Page, PageRequest } from '../../../shared/pagination.js';
import type { Notification } from '../entities/notification.entity.js';
import type { NotificationType } from '../enums/notification.enum.js';

/** One message to deliver. `createMany` takes an array of these. */
export interface CreateNotificationData {
  readonly recipientId: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  /** Null when the system, not a person, caused the event. */
  readonly actorId: string | null;
}

export interface NotificationFilter {
  readonly recipientId: string;
  /** Defaults to false — the list returns read and unread together. */
  readonly unreadOnly?: boolean;
}

/**
 * Port for notification persistence.
 *
 * Every method is scoped to a recipient, including the writes. There is deliberately
 * no `findById(id)` returning any user's row: a repository that can hand back someone
 * else's notification is one forgotten check away from an inbox leak, so the ownership
 * requirement is expressed in the signatures instead of trusted to callers.
 */
export interface INotificationRepository {
  /**
   * Fans out one event to many recipients in a single statement.
   *
   * Batched rather than looped because a transfer request notifies every admin at
   * once, and N round trips inside a request handler is the wrong shape for something
   * on the critical path of approving stock.
   *
   * Returns the number of rows written. Implementations must **never** throw: a
   * notification that cannot be delivered must not fail the operation that caused it.
   */
  createMany(data: readonly CreateNotificationData[]): Promise<number>;

  findMany(filter: NotificationFilter, page: PageRequest): Promise<Page<Notification>>;

  /** Drives the bell badge. Its own method because it is polled far more than the list. */
  countUnread(recipientId: string): Promise<number>;

  /**
   * Marks one notification read, scoped to its owner.
   *
   * Returns false when the id does not exist **or** belongs to someone else — the two
   * are deliberately indistinguishable to the caller, so probing for another user's
   * notification ids reveals nothing.
   *
   * Idempotent: re-marking an already-read row leaves the original timestamp alone.
   */
  markRead(id: string, recipientId: string, at: Date): Promise<boolean>;

  /** Marks every unread notification for one recipient read. Returns how many changed. */
  markAllRead(recipientId: string, at: Date): Promise<number>;

  /**
   * Which entities have already been notified about, of this type, since `since`.
   *
   * The alert scan's memory. Recurring alerts have no natural stopping point — an item
   * below its reorder level is still below it on the next sweep, and on every sweep
   * after that — so without this the bell would gain the same twenty rows every quarter
   * of an hour until somebody restocked, which trains people to ignore it entirely.
   *
   * Deliberately **not** scoped to a recipient. The question is "has this alert gone
   * out", not "has this person seen it": per-recipient state would re-send the whole
   * backlog to whoever joined most recently.
   *
   * Returns entity ids, so the caller can filter its candidates in memory.
   */
  findAlertedEntityIds(type: NotificationType, since: Date): Promise<ReadonlySet<string>>;
}
