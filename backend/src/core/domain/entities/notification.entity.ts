import {
  iconOf,
  type NotificationSeverity,
  severityOf,
  type NotificationType,
} from '../enums/notification.enum.js';

export interface NotificationProps {
  readonly id: string;
  readonly recipientId: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;

  /** What the notification is about, for deep-linking. Both null, or both set. */
  readonly entityType: string | null;
  readonly entityId: string | null;

  readonly actorId: string | null;
  readonly actorName: string | null;

  /** Null means unread. */
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

/**
 * One delivered message for one person.
 *
 * Deliberately thin. Unlike `StockTransfer`, a notification owns no state machine worth
 * the name — it is unread, then read, and that is the whole lifecycle. What it does own
 * is the rule that marking read is **idempotent**: the first timestamp wins, so a
 * duplicate request from a double-click cannot rewrite when the user actually saw it.
 */
export class Notification {
  private constructor(private readonly props: NotificationProps) {}

  static fromPersistence(props: NotificationProps): Notification {
    return new Notification(props);
  }

  get id(): string {
    return this.props.id;
  }

  get recipientId(): string {
    return this.props.recipientId;
  }

  get type(): NotificationType {
    return this.props.type;
  }

  get title(): string {
    return this.props.title;
  }

  get body(): string {
    return this.props.body;
  }

  get entityType(): string | null {
    return this.props.entityType;
  }

  get entityId(): string | null {
    return this.props.entityId;
  }

  get actorId(): string | null {
    return this.props.actorId;
  }

  get actorName(): string | null {
    return this.props.actorName;
  }

  get readAt(): Date | null {
    return this.props.readAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get isRead(): boolean {
    return this.props.readAt !== null;
  }

  get severity(): NotificationSeverity {
    return severityOf(this.props.type);
  }

  get icon(): string {
    return iconOf(this.props.type);
  }

  /**
   * Whether this notification belongs to the given user.
   *
   * Every read and write path asks this before acting. Notifications are the one
   * resource here that a permission cannot protect — an admin holds every permission
   * in the system, and must still not be able to read a Store Manager's inbox or mark
   * their messages read. Ownership is the only correct check, so the domain owns it
   * rather than leaving each controller to remember.
   */
  isOwnedBy(userId: string): boolean {
    return this.props.recipientId === userId;
  }
}
