import { beforeEach, describe, expect, it } from 'vitest';
import { RefreshTokenUseCase } from '../../src/core/application/use-cases/auth/refresh-token.use-case.js';
import { Role } from '../../src/core/domain/enums/role.enum.js';
import { SessionScope } from '../../src/core/domain/enums/session-scope.enum.js';
import { UserStatus } from '../../src/core/domain/enums/user-status.enum.js';
import { UnauthorizedError } from '../../src/core/domain/errors/domain-error.js';
import { AuditAction } from '../../src/core/domain/repositories/audit-log.repository.js';
import {
  FakeAuditLogRepository,
  FakeRefreshTokenRepository,
  FakeTokenService,
  FakeUserRepository,
  fakeLogger,
  makeUser,
} from './fakes.js';

describe('RefreshTokenUseCase', () => {
  let users: FakeUserRepository;
  let refreshTokens: FakeRefreshTokenRepository;
  let tokens: FakeTokenService;
  let audit: FakeAuditLogRepository;
  let useCase: RefreshTokenUseCase;

  /** Seeds a live refresh token and returns its plaintext value. */
  async function seedToken(expiresAt = new Date(Date.now() + 60_000)): Promise<string> {
    const issued = tokens.issueRefreshToken();
    await refreshTokens.create({
      tokenHash: issued.tokenHash,
      userId: 'user-1',
      expiresAt,
    });
    return issued.token;
  }

  beforeEach(() => {
    users = new FakeUserRepository([makeUser()]);
    refreshTokens = new FakeRefreshTokenRepository();
    tokens = new FakeTokenService();
    audit = new FakeAuditLogRepository();
    useCase = new RefreshTokenUseCase(users, refreshTokens, tokens, audit, fakeLogger);
  });

  const refresh = (refreshToken: string) =>
    useCase.execute({ refreshToken, ipAddress: '203.0.113.10', userAgent: 'vitest' });

  it('issues a new access token and rotates the refresh token', async () => {
    const original = await seedToken();
    const result = await refresh(original);

    expect(result.accessToken).toContain('access.user-1');
    // Single-use: the returned token must differ from the one presented.
    expect(result.refreshToken).not.toBe(original);
  });

  it('revokes the presented token and links it to its successor', async () => {
    const original = await seedToken();
    await refresh(original);

    const old = await refreshTokens.findByTokenHash(tokens.hashRefreshToken(original));
    expect(old?.revokedAt).not.toBeNull();
    expect(refreshTokens.rotations).toHaveLength(1);
  });

  it('leaves exactly one live token after a refresh', async () => {
    const original = await seedToken();
    await refresh(original);

    expect(refreshTokens.liveTokensFor('user-1')).toHaveLength(1);
  });

  it('rejects a token that does not exist', async () => {
    await expect(refresh('never-issued')).rejects.toThrow(UnauthorizedError);
  });

  it('rejects an expired token and revokes it', async () => {
    const expired = await seedToken(new Date(Date.now() - 1000));

    await expect(refresh(expired)).rejects.toThrow(UnauthorizedError);

    const record = await refreshTokens.findByTokenHash(tokens.hashRefreshToken(expired));
    expect(record?.revokedAt).not.toBeNull();
  });

  describe('reuse detection', () => {
    it('rejects a token that was already rotated', async () => {
      const original = await seedToken();
      await refresh(original);

      // Replaying the old token is either theft or a buggy client; both are
      // treated as theft.
      await expect(refresh(original)).rejects.toThrow(UnauthorizedError);
    });

    it('revokes every session for the user on reuse', async () => {
      const original = await seedToken();
      const result = await refresh(original);

      await refresh(original).catch(() => undefined);

      // The successor must die too — otherwise an attacker who stole the old
      // token leaves the legitimate session running.
      expect(refreshTokens.liveTokensFor('user-1')).toHaveLength(0);
      await expect(refresh(result.refreshToken)).rejects.toThrow(UnauthorizedError);
    });

    it('audits the reuse so it can be investigated', async () => {
      const original = await seedToken();
      await refresh(original);
      await refresh(original).catch(() => undefined);

      expect(audit.has(AuditAction.TOKEN_REUSE_DETECTED)).toBe(true);
    });

    it('gives reuse the same opaque message as any other failure', async () => {
      const original = await seedToken();
      await refresh(original);

      const reuse = await refresh(original).catch((e: unknown) => e);
      const unknown = await refresh('never-issued').catch((e: unknown) => e);

      expect((reuse as UnauthorizedError).message).toBe((unknown as UnauthorizedError).message);
    });
  });

  describe('re-reading the user', () => {
    it('rebuilds claims from the current record, so a role change propagates', async () => {
      const original = await seedToken();
      // Promotion happens after the token was issued.
      await users.update('user-1', { role: Role.ADMIN });

      const result = await refresh(original);

      // Refresh is the only place a stateless access token can pick this up.
      expect(result.accessToken).toContain('ADMIN');
    });

    it('refuses a suspended user and revokes their sessions', async () => {
      const original = await seedToken();
      await users.update('user-1', { status: UserStatus.SUSPENDED });

      await expect(refresh(original)).rejects.toThrow(UnauthorizedError);
      expect(refreshTokens.liveTokensFor('user-1')).toHaveLength(0);
    });

    it('refuses a soft-deleted user', async () => {
      const original = await seedToken();
      await users.softDelete('user-1');

      await expect(refresh(original)).rejects.toThrow(UnauthorizedError);
    });
  });

  it('audits a successful refresh', async () => {
    const original = await seedToken();
    await refresh(original);

    expect(audit.has(AuditAction.TOKEN_REFRESHED)).toBe(true);
  });

  /**
   * The till device is signed in for six months on a phone that sits on a counter, and everything
   * that makes that safe rests on the scope surviving rotation. A session that widens itself by
   * refreshing — which it does every fifteen minutes — would be a full administrator session by
   * lunchtime, and nothing anywhere else in the system would report it.
   */
  describe('till sessions', () => {
    async function seedTillToken(): Promise<string> {
      const issued = tokens.issueRefreshToken();
      await refreshTokens.create({
        tokenHash: issued.tokenHash,
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        scope: SessionScope.POS,
        deviceName: 'Counter phone',
      });
      return issued.token;
    }

    it('mints the new access token with the scope of the token it replaced', async () => {
      const original = await seedTillToken();
      tokens.issuedAccessPayloads.length = 0;

      await refresh(original);

      expect(tokens.issuedAccessPayloads.at(-1)?.scope).toBe(SessionScope.POS);
    });

    it('carries the scope onto the successor row, so the next rotation narrows too', async () => {
      const original = await seedTillToken();
      const result = await refresh(original);

      const successor = await refreshTokens.findByTokenHash(
        tokens.hashRefreshToken(result.refreshToken),
      );

      expect(successor?.scope).toBe(SessionScope.POS);
    });

    it('renews the long lifetime rather than dropping to the default', async () => {
      const original = await seedTillToken();
      tokens.refreshTtls.length = 0;

      const result = await refresh(original);

      // Six months, not the ordinary week — the counter must not be signed out mid-shift.
      expect(tokens.refreshTtls.at(-1)).toBeGreaterThan(150 * 24 * 60 * 60 * 1000);
      expect(result.refreshTokenExpiresAt.getTime() - Date.now()).toBeGreaterThan(
        150 * 24 * 60 * 60 * 1000,
      );
    });

    it('leaves an ordinary session on the default lifetime and no scope claim', async () => {
      const original = await seedToken();
      tokens.refreshTtls.length = 0;
      tokens.issuedAccessPayloads.length = 0;

      await refresh(original);

      expect(tokens.refreshTtls.at(-1)).toBeUndefined();
      expect(tokens.issuedAccessPayloads.at(-1)?.scope).toBe(SessionScope.FULL);
    });
  });
});
