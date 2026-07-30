import type { Request, RequestHandler } from 'express';
import type {
  MarkAllNotificationsReadUseCase,
  MarkNotificationReadUseCase,
} from '../../../core/application/use-cases/notifications/mark-notifications-read.use-case.js';
import type {
  GetNotificationFeedUseCase,
  GetUnreadNotificationCountUseCase,
  ListNotificationsUseCase,
} from '../../../core/application/use-cases/notifications/read-notifications.use-case.js';
import { NotFoundError, UnauthorizedError } from '../../../core/domain/errors/domain-error.js';
import { asyncHandler } from '../../../shared/async-handler.js';
import { sendPage, sendSuccess } from '../serializers/response.serializer.js';
import type {
  ListNotificationsQuery,
  NotificationFeedQuery,
} from '../validators/notification.validators.js';

/**
 * HTTP adapter for notifications.
 *
 * Every handler derives the recipient from `req.user` — set by `authenticate` from a
 * verified signature — and never from a parameter or body. That single rule is what makes
 * these endpoints safe without a permission check: the caller can only ever address their
 * own inbox, so there is nothing for a capability to gate.
 */
export class NotificationController {
  constructor(
    private readonly listUseCase: ListNotificationsUseCase,
    private readonly feedUseCase: GetNotificationFeedUseCase,
    private readonly unreadCountUseCase: GetUnreadNotificationCountUseCase,
    private readonly markReadUseCase: MarkNotificationReadUseCase,
    private readonly markAllReadUseCase: MarkAllNotificationsReadUseCase,
  ) {}

  /** GET /notifications — the full, paginated inbox. */
  readonly list: RequestHandler = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListNotificationsQuery;

    const page = await this.listUseCase.execute({
      recipientId: this.recipientIdOf(req),
      unreadOnly: query.unreadOnly,
      page: query.page,
      pageSize: query.pageSize,
    });

    sendPage(res, page);
  });

  /** GET /notifications/feed — what the bell panel renders: newest few + unread count. */
  readonly feed: RequestHandler = asyncHandler(async (req, res) => {
    const query = req.query as unknown as NotificationFeedQuery;

    sendSuccess(
      res,
      await this.feedUseCase.execute({
        recipientId: this.recipientIdOf(req),
        limit: query.limit,
      }),
    );
  });

  /** GET /notifications/unread-count — the badge alone, for polling. */
  readonly unreadCount: RequestHandler = asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await this.unreadCountUseCase.execute({ recipientId: this.recipientIdOf(req) }),
    );
  });

  /** POST /notifications/:id/read — returns the resulting badge count. */
  readonly markRead: RequestHandler = asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await this.markReadUseCase.execute({
        recipientId: this.recipientIdOf(req),
        id: this.idOf(req),
      }),
    );
  });

  /** POST /notifications/read-all */
  readonly markAllRead: RequestHandler = asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await this.markAllReadUseCase.execute({ recipientId: this.recipientIdOf(req) }),
    );
  });

  /**
   * The authenticated caller, who is the only recipient these endpoints will ever address.
   *
   * Named `recipientIdOf` rather than the `actorIdOf` the other controllers use, because
   * here the caller is the audience rather than the person acting on something.
   */
  private recipientIdOf(req: Request): string {
    if (req.user === undefined) {
      throw new UnauthorizedError();
    }
    return req.user.id;
  }

  private idOf(req: Request): string {
    const id: unknown = req.params['id'];

    if (typeof id !== 'string') {
      throw new NotFoundError('Notification');
    }

    return id;
  }
}
