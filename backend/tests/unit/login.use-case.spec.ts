import { beforeEach, describe, expect, it } from 'vitest';
import { LoginUseCase } from '../../src/core/application/use-cases/auth/login.use-case.js';
import { Role } from '../../src/core/domain/enums/role.enum.js';
import { UserStatus } from '../../src/core/domain/enums/user-status.enum.js';
import { UnauthorizedError } from '../../src/core/domain/errors/domain-error.js';
import { AuditAction } from '../../src/core/domain/repositories/audit-log.repository.js';
import {
  FakeAuditLogRepository,
  FakeHashService,
  FakeRefreshTokenRepository,
  FakeTokenService,
  FakeUserRepository,
  fakeLogger,
  makeUser,
} from './fakes.js';

const PASSWORD = 'CorrectPassword1';

describe('LoginUseCase', () => {
  let users: FakeUserRepository;
  let refreshTokens: FakeRefreshTokenRepository;
  let hasher: FakeHashService;
  let tokens: FakeTokenService;
  let audit: FakeAuditLogRepository;
  let useCase: LoginUseCase;

  beforeEach(() => {
    users = new FakeUserRepository([makeUser()]);
    refreshTokens = new FakeRefreshTokenRepository();
    hasher = new FakeHashService();
    tokens = new FakeTokenService();
    audit = new FakeAuditLogRepository();
    useCase = new LoginUseCase(users, refreshTokens, hasher, tokens, audit, fakeLogger);
  });

  const login = (overrides: Partial<{ email: string; password: string }> = {}) =>
    useCase.execute({
      email: 'manager@parisbites.local',
      password: PASSWORD,
      ipAddress: '203.0.113.10',
      userAgent: 'vitest',
      ...overrides,
    });

  it('issues an access token, a refresh token and the user on success', async () => {
    const result = await login();

    expect(result.accessToken).toContain('access.user-1.STORE_MANAGER');
    expect(result.refreshToken).toBe('refresh-2');
    expect(result.user.email).toBe('manager@parisbites.local');
    expect(result.user.role).toBe(Role.STORE_MANAGER);
  });

  it('returns the permissions for the role, not the whole set', async () => {
    const result = await login();

    expect(result.user.permissions).toContain('product:read');
    expect(result.user.permissions).not.toContain('user:create');
  });

  it('never exposes the password hash in the result', async () => {
    const result = await login();

    // The DTO has no such field, so this asserts the mapper boundary holds at
    // runtime too — including against an accidental spread of the entity.
    expect(JSON.stringify(result.user)).not.toContain('hash:');
    expect(Object.keys(result.user)).not.toContain('passwordHash');
  });

  it('persists only the digest of the refresh token', async () => {
    const result = await login();
    const stored = [...refreshTokens.records.values()];

    expect(stored).toHaveLength(1);
    expect(stored[0]?.tokenHash).toBe('sha:refresh-2');
    // A database leak must not yield a replayable token.
    expect(stored[0]?.tokenHash).not.toBe(result.refreshToken);
  });

  it('records the login timestamp and an audit entry', async () => {
    await login();

    expect(users.loginTimestamps.get('user-1')).toBeInstanceOf(Date);
    expect(audit.has(AuditAction.LOGIN_SUCCEEDED)).toBe(true);
  });

  it('rejects a wrong password with the generic message', async () => {
    await expect(login({ password: 'WrongPassword9' })).rejects.toThrow(UnauthorizedError);
    await expect(login({ password: 'WrongPassword9' })).rejects.toThrow(
      /email or password you entered is incorrect/i,
    );
  });

  it('gives an unknown email exactly the same message as a wrong password', async () => {
    // Any difference here — wording, code, or status — turns the login form into
    // an account-enumeration oracle.
    const unknown = await login({ email: 'nobody@parisbites.local' }).catch((e: unknown) => e);
    const wrongPassword = await login({ password: 'WrongPassword9' }).catch((e: unknown) => e);

    expect(unknown).toBeInstanceOf(UnauthorizedError);
    expect(wrongPassword).toBeInstanceOf(UnauthorizedError);
    expect((unknown as UnauthorizedError).message).toBe(
      (wrongPassword as UnauthorizedError).message,
    );
    expect((unknown as UnauthorizedError).code).toBe((wrongPassword as UnauthorizedError).code);
  });

  it('still performs a password comparison when no user exists', async () => {
    // The timing-attack defence: returning early for an unknown email would make
    // it measurably faster than a wrong password.
    hasher.compareCallCount = 0;
    await login({ email: 'nobody@parisbites.local' }).catch(() => undefined);

    expect(hasher.compareCallCount).toBe(1);
  });

  it('issues no token when authentication fails', async () => {
    await login({ password: 'WrongPassword9' }).catch(() => undefined);

    expect(refreshTokens.records.size).toBe(0);
    expect(users.loginTimestamps.size).toBe(0);
  });

  it('audits a failed attempt with the attempted email but no password', async () => {
    await login({ password: 'WrongPassword9' }).catch(() => undefined);

    const entry = audit.entries.find((e) => e.action === AuditAction.LOGIN_FAILED);
    expect(entry).toBeDefined();
    expect(entry?.metadata?.['email']).toBe('manager@parisbites.local');
    expect(JSON.stringify(entry)).not.toContain('WrongPassword9');
  });

  describe('inactive accounts', () => {
    it('refuses a suspended user even with the correct password', async () => {
      users = new FakeUserRepository([makeUser({ status: UserStatus.SUSPENDED })]);
      useCase = new LoginUseCase(users, refreshTokens, hasher, tokens, audit, fakeLogger);

      await expect(login()).rejects.toThrow(UnauthorizedError);
      expect(refreshTokens.records.size).toBe(0);
    });

    it('refuses a soft-deleted user', async () => {
      users = new FakeUserRepository([makeUser({ deletedAt: new Date() })]);
      useCase = new LoginUseCase(users, refreshTokens, hasher, tokens, audit, fakeLogger);

      await expect(login()).rejects.toThrow(UnauthorizedError);
    });

    it('checks status only after verifying the password', async () => {
      // Order matters: checking status first would reveal that an address belongs
      // to a suspended account without knowing its password.
      users = new FakeUserRepository([makeUser({ status: UserStatus.SUSPENDED })]);
      useCase = new LoginUseCase(users, refreshTokens, hasher, tokens, audit, fakeLogger);
      hasher.compareCallCount = 0;

      await login().catch(() => undefined);

      expect(hasher.compareCallCount).toBe(1);
    });
  });

  it('treats the email case-insensitively and ignores surrounding space', async () => {
    const result = await login({ email: '  MANAGER@PARISBITES.LOCAL  ' });
    expect(result.user.id).toBe('user-1');
  });
});
