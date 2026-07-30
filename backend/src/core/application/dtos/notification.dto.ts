import type {
  NotificationSeverity,
  NotificationType,
} from '../../domain/enums/notification.enum.js';

export interface NotificationDto {
  readonly id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;

  /** Derived from the type, so every client renders the same icon and colour. */
  readonly severity: NotificationSeverity;
  readonly icon: string;

  readonly entityType: string | null;
  readonly entityId: string | null;

  readonly actorName: string | null;

  readonly isRead: boolean;
  readonly readAt: string | null;
  readonly createdAt: string;
}

/**
 * The bell's payload.
 *
 * `unreadCount` is returned alongside the newest few rather than as a separate call:
 * the badge and the panel must never disagree, and two requests can interleave with a
 * mark-read in between.
 */
export interface NotificationFeedDto {
  readonly items: readonly NotificationDto[];
  readonly unreadCount: number;
}

export interface UnreadCountDto {
  readonly unreadCount: number;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Every input carries `recipientId` — taken from the authenticated caller in the
 * controller, never from the request body. A client-supplied recipient would let any
 * signed-in user read any inbox.
 */
export interface ListNotificationsInput {
  readonly recipientId: string;
  readonly unreadOnly?: boolean | undefined;
  readonly page: number;
  readonly pageSize: number;
}

export interface GetNotificationFeedInput {
  readonly recipientId: string;
  readonly limit: number;
}

export interface MarkNotificationReadInput {
  readonly recipientId: string;
  readonly id: string;
}

export interface MarkAllNotificationsReadInput {
  readonly recipientId: string;
}
