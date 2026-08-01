import type { Permission } from '../../domain/enums/permission.enum.js';
import type { UserDto } from './user.dto.js';

/**
 * Details about the caller's device, threaded through from the HTTP layer so a
 * refresh token can be tied to where it was issued.
 */
export interface RequestContext {
  readonly ipAddress?: string | undefined;
  readonly userAgent?: string | undefined;
}

export interface LoginInput extends RequestContext {
  readonly email: string;
  readonly password: string;
  /**
   * Sign this device in as the till: a six-month session scoped to taking orders.
   *
   * Requested by the client — the counter phone ticks a box on the login form — and the *scope* it
   * produces is decided by the server, which is the part that matters. A client asking for a till
   * session is asking for less, never more.
   */
  readonly tillDevice?: boolean | undefined;
  /** What to call this device on the sessions list, e.g. "Counter phone". */
  readonly deviceName?: string | undefined;
}

/**
 * What the client is given after authenticating.
 *
 * `refreshToken` is returned to the *controller*, which puts it in an httpOnly
 * cookie — it is never serialised into the response body. Keeping it on this DTO
 * rather than having the use case set the cookie is what keeps the application
 * layer free of HTTP concerns.
 */
export interface AuthResult {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
  readonly user: AuthenticatedUserDto;
}

/** The signed-in user, plus the permissions their role grants. */
export interface AuthenticatedUserDto extends UserDto {
  /**
   * Sent so the UI can hide what the user cannot do without guessing from the
   * role. It is a convenience, never a control: the server re-checks every
   * request.
   */
  readonly permissions: readonly Permission[];
}

export interface RefreshInput extends RequestContext {
  /** The opaque token from the httpOnly cookie. */
  readonly refreshToken: string;
}

export interface RefreshResult {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  /** Rotated on every refresh, so the old value stops working. */
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

export interface LogoutInput extends RequestContext {
  readonly refreshToken: string | undefined;
  readonly userId: string | undefined;
}

export interface ChangePasswordInput extends RequestContext {
  readonly userId: string;
  readonly currentPassword: string;
  readonly newPassword: string;
}
