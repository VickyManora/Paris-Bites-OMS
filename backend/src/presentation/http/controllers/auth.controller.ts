import type { Request, RequestHandler } from 'express';
import type { ChangePasswordUseCase } from '../../../core/application/use-cases/auth/change-password.use-case.js';
import type { GetCurrentUserUseCase } from '../../../core/application/use-cases/auth/get-current-user.use-case.js';
import type { LoginUseCase } from '../../../core/application/use-cases/auth/login.use-case.js';
import type { LogoutUseCase } from '../../../core/application/use-cases/auth/logout.use-case.js';
import type { RefreshTokenUseCase } from '../../../core/application/use-cases/auth/refresh-token.use-case.js';
import type { RequestContext } from '../../../core/application/dtos/auth.dto.js';
import { UnauthorizedError } from '../../../core/domain/errors/domain-error.js';
import { asyncHandler } from '../../../shared/async-handler.js';
import {
  clearRefreshTokenCookie,
  readRefreshTokenCookie,
  setRefreshTokenCookie,
} from '../cookies/refresh-token.cookie.js';
import { sendNoContent, sendSuccess } from '../serializers/response.serializer.js';
import type { ChangePasswordBody, LoginBody } from '../validators/auth.validators.js';

/**
 * HTTP adapter for authentication.
 *
 * Thin by design: read validated input, call one use case, translate the result
 * into a response. The one piece of real logic here is cookie handling, which is
 * an HTTP concern and therefore belongs in this layer rather than in a use case.
 *
 * Handlers are arrow-function properties so they can be passed to Express
 * without losing `this`.
 */
export class AuthController {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshTokenUseCase: RefreshTokenUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly getCurrentUserUseCase: GetCurrentUserUseCase,
    private readonly changePasswordUseCase: ChangePasswordUseCase,
  ) {}

  /** POST /auth/login */
  readonly login: RequestHandler = asyncHandler(async (req, res) => {
    const { email, password } = req.body as LoginBody;

    const result = await this.loginUseCase.execute({
      email,
      password,
      ...this.contextOf(req),
    });

    // The refresh token goes into an httpOnly cookie and never into the body, so
    // no script — including an injected one — can read it.
    setRefreshTokenCookie(res, result.refreshToken, result.refreshTokenExpiresAt);

    sendSuccess(res, {
      accessToken: result.accessToken,
      expiresAt: result.accessTokenExpiresAt,
      user: result.user,
    });
  });

  /**
   * POST /auth/refresh
   *
   * Authenticated by the cookie alone — no bearer token, because the whole point
   * is to be callable once the access token has expired.
   */
  readonly refresh: RequestHandler = asyncHandler(async (req, res) => {
    const refreshToken = readRefreshTokenCookie(req);

    if (refreshToken === undefined) {
      // No cookie at all: a first-time visitor, or one whose cookie expired.
      // Expected, not exceptional — the client treats it as "not signed in".
      throw new UnauthorizedError('No active session.');
    }

    try {
      const result = await this.refreshTokenUseCase.execute({
        refreshToken,
        ...this.contextOf(req),
      });

      setRefreshTokenCookie(res, result.refreshToken, result.refreshTokenExpiresAt);

      sendSuccess(res, {
        accessToken: result.accessToken,
        expiresAt: result.accessTokenExpiresAt,
      });
    } catch (error) {
      // Drop the cookie on any failure. Leaving a token the server has rejected
      // in the browser means every subsequent page load retries it and fails
      // again.
      clearRefreshTokenCookie(res);
      throw error;
    }
  });

  /**
   * POST /auth/logout
   *
   * Always succeeds — see `LogoutUseCase`. The cookie is cleared regardless, so
   * the browser ends up signed out even if revocation failed server-side.
   */
  readonly logout: RequestHandler = asyncHandler(async (req, res) => {
    await this.logoutUseCase.execute({
      refreshToken: readRefreshTokenCookie(req),
      userId: req.user?.id,
      ...this.contextOf(req),
    });

    clearRefreshTokenCookie(res);
    sendNoContent(res);
  });

  /** GET /auth/me */
  readonly me: RequestHandler = asyncHandler(async (req, res) => {
    // `authenticate` guarantees this, but the check keeps the type honest
    // without a non-null assertion.
    if (req.user === undefined) {
      throw new UnauthorizedError();
    }

    const user = await this.getCurrentUserUseCase.execute({ userId: req.user.id });
    sendSuccess(res, user);
  });

  /**
   * POST /auth/change-password
   *
   * Revokes every session, including this one, so the cookie is cleared and the
   * client must sign in again with the new password.
   */
  readonly changePassword: RequestHandler = asyncHandler(async (req, res) => {
    if (req.user === undefined) {
      throw new UnauthorizedError();
    }

    const { currentPassword, newPassword } = req.body as ChangePasswordBody;

    await this.changePasswordUseCase.execute({
      userId: req.user.id,
      currentPassword,
      newPassword,
      ...this.contextOf(req),
    });

    clearRefreshTokenCookie(res);
    sendNoContent(res);
  });

  /**
   * Caller details for audit records.
   *
   * `req.ip` is only trustworthy because `app.ts` sets `trust proxy` in
   * production; without it this would be Railway's edge address for every request.
   */
  private contextOf(req: Request): RequestContext {
    return {
      ipAddress: req.ip,
      // Truncated: this is attacker-controlled input on its way to the database.
      userAgent: req.get('user-agent')?.slice(0, 255),
    };
  }
}
