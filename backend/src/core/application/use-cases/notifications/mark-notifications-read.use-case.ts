import { NotFoundError } from '../../../domain/errors/domain-error.js';
import type { INotificationRepository } from '../../../domain/repositories/notification.repository.js';
import type {
  MarkAllNotificationsReadInput,
  MarkNotificationReadInput,
  UnreadCountDto,
} from '../../dtos/notification.dto.js';
import type { IUseCase } from '../../ports/use-case.port.js';

/**
 * Marks one notification read and returns the resulting badge count.
 *
 * Returning the count means the client never has to guess. Decrementing locally looks
 * right until a second tab, or the poll, has already counted the same read — and then
 * the badge drifts below zero or sticks above it.
 *
 * A notification belonging to someone else produces the same `NotFoundError` as one that
 * does not exist. Distinguishing them would confirm that a given id is real, which is a
 * small leak but a free one to avoid.
 */
export class MarkNotificationReadUseCase implements IUseCase<
  MarkNotificationReadInput,
  UnreadCountDto
> {
  constructor(private readonly notifications: INotificationRepository) {}

  async execute(input: MarkNotificationReadInput): Promise<UnreadCountDto> {
    const updated = await this.notifications.markRead(input.id, input.recipientId, new Date());

    if (!updated) {
      throw new NotFoundError('Notification', input.id);
    }

    return { unreadCount: await this.notifications.countUnread(input.recipientId) };
  }
}

/**
 * Clears the whole badge in one statement.
 *
 * Always succeeds, including when nothing was unread: "mark all read" describes a desired
 * end state, and an empty inbox already satisfies it. Erroring there would make the
 * button fail exactly when it had nothing to do.
 */
export class MarkAllNotificationsReadUseCase implements IUseCase<
  MarkAllNotificationsReadInput,
  UnreadCountDto
> {
  constructor(private readonly notifications: INotificationRepository) {}

  async execute(input: MarkAllNotificationsReadInput): Promise<UnreadCountDto> {
    await this.notifications.markAllRead(input.recipientId, new Date());

    // Re-counted rather than assumed to be zero: a notification can arrive between the
    // update and this read, and reporting zero would hide it until the next poll.
    return { unreadCount: await this.notifications.countUnread(input.recipientId) };
  }
}
