import type { INotificationRepository } from '../../../domain/repositories/notification.repository.js';
import { createPage, toPageRequest, type Page } from '../../../../shared/pagination.js';
import type {
  GetNotificationFeedInput,
  ListNotificationsInput,
  NotificationDto,
  NotificationFeedDto,
  UnreadCountDto,
} from '../../dtos/notification.dto.js';
import { NotificationMapper } from '../../mappers/notification.mapper.js';
import type { IUseCase } from '../../ports/use-case.port.js';

/** Ceiling on the bell panel, whatever the client asks for. */
const MAX_FEED_LIMIT = 20;

/**
 * The caller's own notifications, newest first, paginated.
 *
 * Scoped to `input.recipientId`, which the controller takes from the verified access
 * token. There is no "list notifications for user X" — see the repository port.
 */
export class ListNotificationsUseCase implements IUseCase<
  ListNotificationsInput,
  Page<NotificationDto>
> {
  constructor(private readonly notifications: INotificationRepository) {}

  async execute(input: ListNotificationsInput): Promise<Page<NotificationDto>> {
    const pageRequest = toPageRequest(input.page, input.pageSize);

    const page = await this.notifications.findMany(
      { recipientId: input.recipientId, unreadOnly: input.unreadOnly ?? false },
      pageRequest,
    );

    return createPage(NotificationMapper.toDtoList(page.items), page.total, pageRequest);
  }
}

/**
 * What the bell renders: the newest few, plus the unread count.
 *
 * Both in one response on purpose. Fetched separately, a mark-read landing between the
 * two calls leaves a badge reading "3" above a panel where everything is already read —
 * and that mismatch is exactly what users notice.
 *
 * The count covers **all** unread notifications, not just the ones returned, so a badge
 * of 40 above a panel of 20 is correct rather than a bug.
 */
export class GetNotificationFeedUseCase implements IUseCase<
  GetNotificationFeedInput,
  NotificationFeedDto
> {
  constructor(private readonly notifications: INotificationRepository) {}

  async execute(input: GetNotificationFeedInput): Promise<NotificationFeedDto> {
    const limit = Math.min(Math.max(Math.floor(input.limit), 1), MAX_FEED_LIMIT);

    const [page, unreadCount] = await Promise.all([
      this.notifications.findMany({ recipientId: input.recipientId }, { page: 1, pageSize: limit }),
      this.notifications.countUnread(input.recipientId),
    ]);

    return { items: NotificationMapper.toDtoList(page.items), unreadCount };
  }
}

/**
 * Just the badge number.
 *
 * Separate from the feed because it is polled on an interval by every open tab, and
 * returning twenty rows each time to render one integer is waste that scales with staff
 * count.
 */
export class GetUnreadNotificationCountUseCase implements IUseCase<
  { recipientId: string },
  UnreadCountDto
> {
  constructor(private readonly notifications: INotificationRepository) {}

  async execute({ recipientId }: { recipientId: string }): Promise<UnreadCountDto> {
    return { unreadCount: await this.notifications.countUnread(recipientId) };
  }
}
