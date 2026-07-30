import { Router } from 'express';
import type { AppContainer } from '../../../infrastructure/container/container.js';
import { NotificationController } from '../controllers/notification.controller.js';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { idParamSchema } from '../validators/common.validators.js';
import {
  listNotificationsQuerySchema,
  notificationFeedQuerySchema,
} from '../validators/notification.validators.js';

/**
 * Notification routes.
 *
 * These are the **only** routes in the API with no `requirePermission`, which is
 * deliberate rather than an oversight.
 *
 * Every other resource is shared, so "may this role do this?" is the right question. An
 * inbox is not shared: the right question is "is this yours?", and no permission can
 * express it. An admin holds every permission by construction, so gating on one would
 * grant admins access to a Store Manager's notifications — the opposite of what a
 * capability check is for.
 *
 * Ownership is enforced instead, and enforced in the layer that cannot be bypassed: the
 * recipient comes from the verified token in the controller, and every repository method
 * takes it as part of its `where` clause. A missing check therefore returns nothing
 * rather than someone else's mail.
 *
 * Middleware order matches the rest of the API: authenticate → validate → handler.
 */
export function notificationRoutes(container: AppContainer): Router {
  const router = Router();

  const controller = new NotificationController(
    container.listNotificationsUseCase,
    container.getNotificationFeedUseCase,
    container.getUnreadNotificationCountUseCase,
    container.markNotificationReadUseCase,
    container.markAllNotificationsReadUseCase,
  );

  // Applied to every route below, so a new route cannot accidentally be public.
  router.use(authenticate(container.tokenService));

  // Both declared before `/:id/read`, or "feed" and "unread-count" would be parsed as
  // ids and fail UUID validation — the same ordering trap as `/transfers/summary`.
  router.get('/feed', validate({ query: notificationFeedQuerySchema }), controller.feed);
  router.get('/unread-count', controller.unreadCount);

  router.get('/', validate({ query: listNotificationsQuerySchema }), controller.list);

  /**
   * `read-all` before `:id/read` for the same reason — and it is a POST rather than a
   * PATCH because it is an action on the collection, not a representation to merge.
   */
  router.post('/read-all', controller.markAllRead);

  router.post('/:id/read', validate({ params: idParamSchema }), controller.markRead);

  return router;
}
