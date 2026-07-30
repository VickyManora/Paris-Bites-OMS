import type { Role } from '../../domain/enums/role.enum.js';

/** Claims carried by an access token. Kept minimal — it is not a user cache. */
export interface AccessTokenPayload {
  /** Subject: the user id. */
  readonly sub: string;
  readonly email: string;
  readonly role: Role;
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
  /** Generates a high-entropy opaque refresh token plus its storable digest. */
  issueRefreshToken(): { token: string; tokenHash: string; expiresAt: Date };
  hashRefreshToken(token: string): string;
}
