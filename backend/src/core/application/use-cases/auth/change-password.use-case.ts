import { BusinessRuleError, UnauthorizedError } from '../../../domain/errors/domain-error.js';
import {
  AuditAction,
  type IAuditLogRepository,
} from '../../../domain/repositories/audit-log.repository.js';
import type { IRefreshTokenRepository } from '../../../domain/repositories/refresh-token.repository.js';
import type { IUserRepository } from '../../../domain/repositories/user.repository.js';
import type { ChangePasswordInput } from '../../dtos/auth.dto.js';
import type { IHashService } from '../../ports/hash.service.port.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';

/**
 * Changes the caller's own password.
 *
 * Requires the current password even though the caller is already authenticated.
 * Without that check, a stolen access token — or an unattended browser — is
 * enough to lock the real owner out of their account permanently.
 */
export class ChangePasswordUseCase implements IUseCase<ChangePasswordInput, void> {
  constructor(
    private readonly users: IUserRepository,
    private readonly refreshTokens: IRefreshTokenRepository,
    private readonly hasher: IHashService,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: ChangePasswordInput): Promise<void> {
    const user = await this.users.findById(input.userId);

    if (user === null || !user.canSignIn) {
      throw new UnauthorizedError('Your session is no longer valid. Please sign in again.');
    }

    const currentMatches = await this.hasher.compare(input.currentPassword, user.passwordHash);

    if (!currentMatches) {
      this.logger.warn('Password change rejected: current password incorrect', {
        userId: user.id,
      });
      // 422 with a field-scoped message, so the form can show it under the right
      // input. Enumeration is not a concern here — the caller is authenticated
      // and already knows the account exists.
      throw new BusinessRuleError('Your current password is incorrect.', {
        currentPassword: ['Incorrect password.'],
      });
    }

    // Rejects the no-op that would otherwise silently invalidate every session.
    if (input.currentPassword === input.newPassword) {
      throw new BusinessRuleError('Your new password must be different from the current one.', {
        newPassword: ['Choose a password you have not used here before.'],
      });
    }

    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.users.update(user.id, { passwordHash });

    /*
     * Revoke every refresh token, including the caller's own.
     *
     * A password change is the standard response to "I think someone has access
     * to my account", so it must end any session the attacker holds. The user
     * signs in again with the new password; the client handles this by treating
     * the next 401 as a normal expiry.
     */
    await this.refreshTokens.revokeAllForUser(user.id);

    await this.auditLog.record({
      actorId: user.id,
      action: AuditAction.PASSWORD_CHANGED,
      entityType: 'User',
      entityId: user.id,
      ip: input.ipAddress,
      metadata: { userAgent: input.userAgent },
    });

    this.logger.info('Password changed; all sessions revoked', { userId: user.id });
  }
}
