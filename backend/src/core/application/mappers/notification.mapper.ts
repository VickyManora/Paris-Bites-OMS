import type { Notification } from '../../domain/entities/notification.entity.js';
import type { NotificationDto } from '../dtos/notification.dto.js';

/**
 * Domain entity to outbound DTO.
 *
 * `severity` and `icon` are resolved here from the type rather than left to the client.
 * Two surfaces render notifications — the bell and the dashboard card — and deriving the
 * presentation twice is how they end up disagreeing.
 *
 * `recipientId` is deliberately **not** exposed: the caller is the recipient by
 * construction, so returning it adds nothing and invites a client to filter on it as if
 * other people's rows could ever appear.
 */
export const NotificationMapper = {
  toDto(notification: Notification): NotificationDto {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,

      severity: notification.severity,
      icon: notification.icon,

      entityType: notification.entityType,
      entityId: notification.entityId,

      actorName: notification.actorName,

      isRead: notification.isRead,
      readAt: notification.readAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
    };
  },

  toDtoList(notifications: readonly Notification[]): NotificationDto[] {
    return notifications.map((notification) => NotificationMapper.toDto(notification));
  },
} as const;
