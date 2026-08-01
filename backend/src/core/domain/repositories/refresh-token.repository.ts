import type { SessionScope } from '../enums/session-scope.enum.js';

export interface RefreshTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  /**
   * What this session may do. Read on rotation so a successor inherits it — a session that could
   * widen its own scope by refreshing would have no scope at all.
   */
  readonly scope: SessionScope;
  readonly deviceName: string | null;
}

export interface CreateRefreshTokenData {
  /** Digest of the token, never the token itself. */
  readonly tokenHash: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly userAgent?: string | undefined;
  readonly ipAddress?: string | undefined;
  /** Defaults to `FULL` — an ordinary sign-in narrows nothing. */
  readonly scope?: SessionScope | undefined;
  readonly deviceName?: string | undefined;
}

/**
 * Port for refresh-token persistence. Only the digest is stored, so a database
 * leak alone cannot be replayed against the API.
 */
export interface IRefreshTokenRepository {
  findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  create(data: CreateRefreshTokenData): Promise<RefreshTokenRecord>;
  revoke(id: string): Promise<void>;
  /** Marks `id` as rotated into `successorId`, so reuse is detectable. */
  rotate(id: string, successorId: string): Promise<void>;
  /** Revokes every live token for a user — sign-out-everywhere, or on breach. */
  revokeAllForUser(userId: string): Promise<void>;
  /** Housekeeping: drops rows that are expired or revoked. */
  deleteExpired(now: Date): Promise<number>;
}
