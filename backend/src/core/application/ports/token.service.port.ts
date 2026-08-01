import type { Role } from '../../domain/enums/role.enum.js';
import type { SessionScope } from '../../domain/enums/session-scope.enum.js';

/** Claims carried by an access token. Kept minimal — it is not a user cache. */
export interface AccessTokenPayload {
  /** Subject: the user id. */
  readonly sub: string;
  readonly email: string;
  readonly role: Role;
  /**
   * What this *session* may do, which may be less than the role allows — see `SessionScope`.
   *
   * Carried in the token rather than looked up, so authorising a request stays a signature check
   * with no database round trip. Absent on tokens issued before the concept existed, and read as
   * `FULL` when absent: an old token keeps working exactly as it did.
   */
  readonly scope?: SessionScope;
}

export interface IssuedToken {
  readonly token: string;
  readonly expiresAt: Date;
}

/** Token minting and verification, abstracted away from the JWT library. */
export interface ITokenService {
  issueAccessToken(payload: AccessTokenPayload): IssuedToken;
  /** Rejects expired, malformed or wrongly-signed tokens by throwing. */
  verifyAccessToken(token: string): AccessTokenPayload;
  /**
   * Generates a high-entropy opaque refresh token plus its storable digest.
   *
   * `ttlMs` overrides the configured lifetime, for the one session type that needs a different
   * one: a till device signed in for months rather than days. Omitted everywhere else.
   */
  issueRefreshToken(ttlMs?: number): { token: string; tokenHash: string; expiresAt: Date };
  hashRefreshToken(token: string): string;
}
