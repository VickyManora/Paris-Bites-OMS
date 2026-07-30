import type { Notification as PrismaNotification } from '../../../generated/prisma/client.js';
import { Notification } from '../../../core/domain/entities/notification.entity.js';
import { NotificationType } from '../../../core/domain/enums/notification.enum.js';

/**
 * Prisma row to domain entity.
 *
 * The switch is exhaustive with no `default`, so adding a value to the Prisma enum
 * without adding it to the domain's stops the build — which is the whole reason the
 * domain keeps its own copy rather than re-exporting Prisma's.
 */
function toDomainType(type: PrismaNotification['type']): NotificationType {
  switch (type) {
    case 'TRANSFER_REQUESTED':
      return NotificationType.TRANSFER_REQUESTED;
    case 'TRANSFER_APPROVED':
      return NotificationType.TRANSFER_APPROVED;
    case 'TRANSFER_REJECTED':
      return NotificationType.TRANSFER_REJECTED;
    case 'TRANSFER_COMPLETED':
      return NotificationType.TRANSFER_COMPLETED;
    case 'LOW_STOCK':
      return NotificationType.LOW_STOCK;
    case 'PURCHASE_COMPLETED':
      return NotificationType.PURCHASE_COMPLETED;
    case 'EXPIRY_ALERT':
      return NotificationType.EXPIRY_ALERT;
  }
}

/** The actor join, when the query asked for it. */
type NotificationRow = PrismaNotification & {
  readonly actor?: { readonly firstName: string; readonly lastName: string } | null;
};

export const NotificationPrismaMapper = {
  toDomain(row: NotificationRow): Notification {
    const actor = row.actor;

    return Notification.fromPersistence({
      id: row.id,
      recipientId: row.recipientId,
      type: toDomainType(row.type),
      title: row.title,
      body: row.body,
      entityType: row.entityType,
      entityId: row.entityId,
      actorId: row.actorId,
      // Null when the actor was deleted (the FK is `SET NULL`) or was not joined.
      actorName: actor == null ? null : `${actor.firstName} ${actor.lastName}`,
      readAt: row.readAt,
      createdAt: row.createdAt,
    });
  },

  toDomainList(rows: readonly NotificationRow[]): Notification[] {
    return rows.map((row) => NotificationPrismaMapper.toDomain(row));
  },
} as const;
