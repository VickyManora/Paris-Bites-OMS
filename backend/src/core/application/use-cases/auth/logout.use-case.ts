import {
  AuditAction,
  type IAuditLogRepository,
} from '../../../domain/repositories/audit-log.repository.js';
import type { IRefreshTokenRepository } from '../../../domain/repositories/refresh-token.repository.js';
import type { LogoutInput } from '../../dtos/auth.dto.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { ITokenService } from '../../ports/token.service.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';

/**
 * Ends a session by revoking its refresh token.
 *
 * Never throws. Logout has to be idempotent and unconditionally successful: a
 * user who clicked "sign out" must end up signed out, and telling them it failed
 * would leave them believing they are still logged in. An unknown or
 * already-revoked token is simply nothing left to do.
 *
 * The access token cannot be revoked — it is stateless — so it stays valid until
 * it expires. That window is why the access token lifetime is minutes.
 */
export class LogoutUseCase implements IUseCase<LogoutInput, void> {
  constructor(
    private readonly refreshTokens: IRefreshTokenRepository,
    private readonly tokens: ITokenService,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: LogoutInput): Promise<void> {
    if (input.refreshToken === undefined || input.refreshToken.length === 0) {
      return;
    }

    try {
      const tokenHash = this.tokens.hashRefreshToken(input.refreshToken);
      const existing = await this.refreshTokens.findByTokenHash(tokenHash);

      if (existing === null || existing.revokedAt !== null) {
        return;
      }

      await this.refreshTokens.revoke(existing.id);

      await this.auditLog.record({
        actorId: existing.userId,
        action: AuditAction.LOGOUT,
        entityType: 'RefreshToken',
        entityId: existing.id,
        ip: input.ipAddress,
      });

      this.logger.info('User signed out', { userId: existing.userId });
    } catch (error) {
      // Swallowed on purpose: see the class comment. Logged so a genuinely broken
      // revocation path is still visible.
      this.logger.error('Failed to revoke refresh token during logout', error, {
        userId: input.userId,
      });
    }
  }
}

/**
 * Revokes every session for a user — "sign out everywhere".
 *
 * Separate from `LogoutUseCase` because it is a different operation with
 * different authorization: ending your own session needs no permission, while
 * ending all of them is what you reach for after a suspected compromise.
 */
export class LogoutAllSessionsUseCase implements IUseCase<{ userId: string }, void> {
  constructor(
    private readonly refreshTokens: IRefreshTokenRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute({ userId }: { userId: string }): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId);

    await this.auditLog.record({
      actorId: userId,
      action: AuditAction.LOGOUT,
      entityType: 'User',
      entityId: userId,
      metadata: { scope: 'all-sessions' },
    });

    this.logger.info('All sessions revoked', { userId });
  }
}
