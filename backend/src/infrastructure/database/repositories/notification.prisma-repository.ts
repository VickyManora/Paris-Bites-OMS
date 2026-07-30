import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { ILogger } from '../../../core/application/ports/logger.port.js';
import type { Notification } from '../../../core/domain/entities/notification.entity.js';
import type { NotificationType } from '../../../core/domain/enums/notification.enum.js';
import type {
  CreateNotificationData,
  INotificationRepository,
  NotificationFilter,
} from '../../../core/domain/repositories/notification.repository.js';
import { createPage, toSkipTake, type Page, type PageRequest } from '../../../shared/pagination.js';
import { NotificationPrismaMapper } from '../mappers/notification.prisma-mapper.js';

/** Joined on reads so the UI can say who caused the event without a second query. */
const ACTOR_SELECT = { select: { firstName: true, lastName: true } } as const;

export class NotificationPrismaRepository implements INotificationRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly logger: ILogger,
  ) {}

  async createMany(data: readonly CreateNotificationData[]): Promise<number> {
    if (data.length === 0) {
      return 0;
    }

    try {
      const result = await this.client.notification.createMany({
        data: data.map((item) => ({
          recipientId: item.recipientId,
          type: item.type,
          title: item.title,
          body: item.body,
          entityType: item.entityType ?? null,
          entityId: item.entityId ?? null,
          actorId: item.actorId,
        })),
      });

      return result.count;
    } catch (error) {
      /*
       * Delivery must never break the operation it describes — the same rule
       * `AuditLogPrismaRepository` follows, and for a sharper reason here: the caller
       * has usually just committed a stock movement, so throwing now would report a
       * failure for work that actually succeeded.
       *
       * Logged at error level, because a silently broken bell looks identical to a
       * quiet week.
       */
      this.logger.error('Failed to write notifications', error, {
        recipients: data.length,
        type: data[0]?.type,
      });

      return 0;
    }
  }

  async findMany(filter: NotificationFilter, page: PageRequest): Promise<Page<Notification>> {
    const where = this.buildWhere(filter);
    const { skip, take } = toSkipTake(page);

    // One transaction so the count and the slice describe the same snapshot — otherwise
    // a notification arriving between the two makes the last page look short.
    const [rows, total] = await this.client.$transaction([
      this.client.notification.findMany({
        where,
        skip,
        take,
        // Newest first: an inbox is read from the top, and the index on
        // (recipient_id, created_at) serves exactly this.
        orderBy: { createdAt: 'desc' },
        include: { actor: ACTOR_SELECT },
      }),
      this.client.notification.count({ where }),
    ]);

    return createPage(NotificationPrismaMapper.toDomainList(rows), total, page);
  }

  async countUnread(recipientId: string): Promise<number> {
    return this.client.notification.count({ where: { recipientId, readAt: null } });
  }

  async markRead(id: string, recipientId: string, at: Date): Promise<boolean> {
    /*
     * `updateMany` rather than `update`, for two reasons that both matter.
     *
     * Ownership is in the `where` clause, so a request for someone else's notification
     * matches zero rows instead of needing a read-then-check the caller could forget.
     *
     * `readAt: null` makes it idempotent: a second call — a double-click, or two tabs —
     * matches nothing and leaves the original timestamp intact, so "when did they see
     * this" stays truthful.
     */
    const result = await this.client.notification.updateMany({
      where: { id, recipientId, readAt: null },
      data: { readAt: at },
    });

    if (result.count > 0) {
      return true;
    }

    /*
     * Zero rows is ambiguous: already read, or not theirs. Already-read must report
     * success, or a double-click surfaces a spurious "not found" to the user.
     */
    const exists = await this.client.notification.count({ where: { id, recipientId } });
    return exists > 0;
  }

  async markAllRead(recipientId: string, at: Date): Promise<number> {
    const result = await this.client.notification.updateMany({
      where: { recipientId, readAt: null },
      data: { readAt: at },
    });

    return result.count;
  }

  /**
   * Entity ids already alerted about since `since`.
   *
   * `distinct` on the entity rather than fetching rows: one alert fans out to every
   * admin, so the raw rows are N per item and only the id is wanted. Served by the
   * `(type, entity_id, created_at)` index.
   */
  async findAlertedEntityIds(type: NotificationType, since: Date): Promise<ReadonlySet<string>> {
    const rows = await this.client.notification.findMany({
      where: { type, entityId: { not: null }, createdAt: { gte: since } },
      select: { entityId: true },
      distinct: ['entityId'],
    });

    return new Set(rows.flatMap((row) => (row.entityId === null ? [] : [row.entityId])));
  }

  private buildWhere(filter: NotificationFilter): Prisma.NotificationWhereInput {
    return {
      recipientId: filter.recipientId,
      ...(filter.unreadOnly === true && { readAt: null }),
    };
  }
}
