import { UnauthorizedError } from '../../../domain/errors/domain-error.js';
import {
  AuditAction,
  type IAuditLogRepository,
} from '../../../domain/repositories/audit-log.repository.js';
import type { IRefreshTokenRepository } from '../../../domain/repositories/refresh-token.repository.js';
import type { IUserRepository } from '../../../domain/repositories/user.repository.js';
import type { RefreshInput, RefreshResult } from '../../dtos/auth.dto.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { ITokenService } from '../../ports/token.service.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';

/** Same opaque message for every failure — see `LoginUseCase` for the reasoning. */
const INVALID_SESSION = 'Your session has expired. Please sign in again.';

/**
 * Exchanges a refresh token for a new access token, rotating the refresh token in
 * the process.
 *
 * Rotation is what makes a long-lived credential safe to hold: each token is
 * single-use, so a stolen one is only useful until the legitimate client next
 * refreshes. The reuse check below is what turns that into active detection.
 */
export class RefreshTokenUseCase implements IUseCase<RefreshInput, RefreshResult> {
  constructor(
    private readonly users: IUserRepository,
    private readonly refreshTokens: IRefreshTokenRepository,
    private readonly tokens: ITokenService,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: RefreshInput): Promise<RefreshResult> {
    // Look up by digest — the plaintext token is never stored, so this is the
    // only way to find the record.
    const tokenHash = this.tokens.hashRefreshToken(input.refreshToken);
    const existing = await this.refreshTokens.findByTokenHash(tokenHash);

    if (existing === null) {
      this.logger.warn('Refresh attempted with an unknown token', { ip: input.ipAddress });
      throw new UnauthorizedError(INVALID_SESSION);
    }

    /*
     * REUSE DETECTION.
     *
     * A token that was already revoked is being presented again. Two things
     * cause this: an attacker replaying a stolen token, or the legitimate client
     * replaying one after its successor was issued. Neither is distinguishable
     * from here, and the safe reading is theft.
     *
     * So every live token for the user is revoked, forcing a fresh sign-in. That
     * is deliberately heavy-handed: it ends the attacker's access, and the cost
     * to a legitimate user is one login.
     */
    if (existing.revokedAt !== null) {
      await this.refreshTokens.revokeAllForUser(existing.userId);

      await this.auditLog.record({
        actorId: existing.userId,
        action: AuditAction.TOKEN_REUSE_DETECTED,
        entityType: 'RefreshToken',
        entityId: existing.id,
        ip: input.ipAddress,
        metadata: { userAgent: input.userAgent, revokedAt: existing.revokedAt.toISOString() },
      });

      this.logger.error('Refresh token reuse detected — all sessions revoked', undefined, {
        userId: existing.userId,
        ip: input.ipAddress,
      });

      throw new UnauthorizedError(INVALID_SESSION);
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      await this.refreshTokens.revoke(existing.id);
      throw new UnauthorizedError(INVALID_SESSION);
    }

    /*
     * Re-read the user on every refresh. This is the point where a suspension,
     * deletion or role change takes effect — the access token is stateless, so
     * refresh is the only place the database gets consulted.
     */
    const user = await this.users.findById(existing.userId);

    if (user === null || !user.canSignIn) {
      await this.refreshTokens.revokeAllForUser(existing.userId);
      this.logger.warn('Refresh rejected for an inactive user', { userId: existing.userId });
      throw new UnauthorizedError(INVALID_SESSION);
    }

    const accessToken = this.tokens.issueAccessToken({
      sub: user.id,
      // Claims are rebuilt from the current record, so a role change propagates
      // on the next refresh rather than persisting until the user signs out.
      email: user.email,
      role: user.role,
    });

    const nextToken = this.tokens.issueRefreshToken();

    const successor = await this.refreshTokens.create({
      tokenHash: nextToken.tokenHash,
      userId: user.id,
      expiresAt: nextToken.expiresAt,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
    });

    // Link old → new so the chain is traceable and reuse of the old token is
    // detectable above.
    await this.refreshTokens.rotate(existing.id, successor.id);

    await this.auditLog.record({
      actorId: user.id,
      action: AuditAction.TOKEN_REFRESHED,
      entityType: 'RefreshToken',
      entityId: successor.id,
      ip: input.ipAddress,
    });

    return {
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
      refreshToken: nextToken.token,
      refreshTokenExpiresAt: nextToken.expiresAt,
    };
  }
}
