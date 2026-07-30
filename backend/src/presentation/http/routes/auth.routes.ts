import { Router } from 'express';
import type { AppContainer } from '../../../infrastructure/container/container.js';
import { AuthController } from '../controllers/auth.controller.js';
import { authenticate } from '../middlewares/authenticate.middleware.js';
import { authRateLimiter } from '../middlewares/rate-limit.middleware.js';
import { requireFetchIntent } from '../middlewares/require-fetch-intent.middleware.js';
import { validate } from '../middlewares/validate.middleware.js';
import { changePasswordSchema, loginSchema } from '../validators/auth.validators.js';

/**
 * Authentication routes.
 *
 * Per-route middleware order is deliberate throughout:
 *   rate limit → CSRF check → authenticate → authorize → validate → handler
 *
 * Cheap rejections come first, so an unauthenticated flood never reaches bcrypt
 * or the database.
 */
export function authRoutes(container: AppContainer): Router {
  const router = Router();

  const controller = new AuthController(
    container.loginUseCase,
    container.refreshTokenUseCase,
    container.logoutUseCase,
    container.getCurrentUserUseCase,
    container.changePasswordUseCase,
  );

  /**
   * Public. Rate limited hard — this is the endpoint an attacker guesses
   * passwords against, and `authRateLimiter` counts only failures so a
   * legitimate user is never locked out by signing in successfully.
   */
  router.post('/login', authRateLimiter(), validate({ body: loginSchema }), controller.login);

  /**
   * Authenticated by the refresh cookie, not a bearer token — it must work
   * precisely when the access token has expired.
   *
   * `requireFetchIntent` is the CSRF defence: the cookie is `SameSite=None` in
   * production, so without it any site could trigger a refresh. Rate limited
   * because a valid cookie should need this roughly once per access-token
   * lifetime, not continuously.
   */
  router.post('/refresh', authRateLimiter(), requireFetchIntent(), controller.refresh);

  /**
   * Deliberately does NOT require a valid access token. A user whose token has
   * already expired must still be able to sign out and have their refresh token
   * revoked; demanding a live token would make that impossible.
   */
  router.post('/logout', requireFetchIntent(), controller.logout);

  const requireAuth = authenticate(container.tokenService);

  router.get('/me', requireAuth, controller.me);

  router.post(
    '/change-password',
    authRateLimiter(),
    requireAuth,
    validate({ body: changePasswordSchema }),
    controller.changePassword,
  );

  return router;
}
