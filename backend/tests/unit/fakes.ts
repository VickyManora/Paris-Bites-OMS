import { SessionScope } from '../../src/core/domain/enums/session-scope.enum.js';
import { User, type UserProps } from '../../src/core/domain/entities/user.entity.js';
import { Role } from '../../src/core/domain/enums/role.enum.js';
import { UserStatus } from '../../src/core/domain/enums/user-status.enum.js';
import type { IHashService } from '../../src/core/application/ports/hash.service.port.js';
import type { ILogger } from '../../src/core/application/ports/logger.port.js';
import type {
  AccessTokenPayload,
  IssuedToken,
  ITokenService,
} from '../../src/core/application/ports/token.service.port.js';
import type {
  CreateAuditLogData,
  IAuditLogRepository,
} from '../../src/core/domain/repositories/audit-log.repository.js';
import type {
  CreateRefreshTokenData,
  IRefreshTokenRepository,
  RefreshTokenRecord,
} from '../../src/core/domain/repositories/refresh-token.repository.js';
import type {
  CreateUserData,
  IUserRepository,
  UpdateUserData,
  UserFilter,
} from '../../src/core/domain/repositories/user.repository.js';
import { createPage, type Page, type PageRequest } from '../../src/shared/pagination.js';

/**
 * In-memory fakes for every port the auth use cases depend on.
 *
 * These are the return on the dependency rule: the use cases can be tested with
 * no database, no HTTP server and no mocking library, because they were written
 * against interfaces the domain owns.
 *
 * Fakes rather than mocks — they behave like the real thing, so a test asserts on
 * observable outcomes ("the token is revoked") instead of on call sequences.
 */

export function makeUserProps(overrides: Partial<UserProps> = {}): UserProps {
  return {
    id: 'user-1',
    email: 'manager@parisbites.local',
    passwordHash: 'hash:CorrectPassword1',
    firstName: 'Store',
    lastName: 'Manager',
    role: Role.STORE_MANAGER,
    status: UserStatus.ACTIVE,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

export function makeUser(overrides: Partial<UserProps> = {}): User {
  return User.fromPersistence(makeUserProps(overrides));
}

export class FakeUserRepository implements IUserRepository {
  readonly loginTimestamps = new Map<string, Date>();
  readonly updates: { id: string; data: UpdateUserData }[] = [];
  private readonly users = new Map<string, UserProps>();

  constructor(users: readonly User[] = []) {
    for (const user of users) {
      this.users.set(user.id, user.toProps());
    }
  }

  async findById(id: string): Promise<User | null> {
    const props = this.users.get(id);
    // Mirrors the real repository, which filters soft-deleted rows.
    return props === undefined || props.deletedAt !== null ? null : User.fromPersistence(props);
  }

  async findByEmail(email: string): Promise<User | null> {
    const normalised = email.trim().toLowerCase();
    for (const props of this.users.values()) {
      if (props.email === normalised && props.deletedAt === null) {
        return User.fromPersistence(props);
      }
    }
    return null;
  }

  async findMany(_filter: UserFilter, page: PageRequest): Promise<Page<User>> {
    const all = [...this.users.values()].map((props) => User.fromPersistence(props));
    return createPage(all, all.length, page);
  }

  async findIdsByRole(role: Role): Promise<readonly string[]> {
    // Mirrors the real repository: active, non-deleted holders of the role only.
    return [...this.users.values()]
      .filter(
        (props) =>
          props.role === role && props.status === UserStatus.ACTIVE && props.deletedAt === null,
      )
      .map((props) => props.id);
  }

  async existsByEmail(email: string): Promise<boolean> {
    return (await this.findByEmail(email)) !== null;
  }

  async create(data: CreateUserData): Promise<User> {
    const props = makeUserProps({ ...data });
    this.users.set(props.id, props);
    return User.fromPersistence(props);
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    this.updates.push({ id, data });
    const existing = this.users.get(id);

    if (existing === undefined) {
      throw new Error(`FakeUserRepository: no user ${id}`);
    }

    const next: UserProps = { ...existing, ...data, updatedAt: new Date() };
    this.users.set(id, next);
    return User.fromPersistence(next);
  }

  async recordLogin(id: string, at: Date): Promise<void> {
    this.loginTimestamps.set(id, at);
  }

  async softDelete(id: string): Promise<void> {
    const existing = this.users.get(id);
    if (existing !== undefined) {
      this.users.set(id, { ...existing, deletedAt: new Date() });
    }
  }
}

export class FakeRefreshTokenRepository implements IRefreshTokenRepository {
  readonly records = new Map<string, RefreshTokenRecord & { tokenHash: string }>();
  readonly rotations: { from: string; to: string }[] = [];
  revokeAllCallCount = 0;
  private sequence = 0;

  async findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    for (const record of this.records.values()) {
      if (record.tokenHash === tokenHash) {
        return record;
      }
    }
    return null;
  }

  async create(data: CreateRefreshTokenData): Promise<RefreshTokenRecord> {
    const id = `token-${++this.sequence}`;
    const record = {
      id,
      userId: data.userId,
      expiresAt: data.expiresAt,
      revokedAt: null,
      tokenHash: data.tokenHash,
      // Mirrors the column default: an omitted scope narrows nothing.
      scope: data.scope ?? SessionScope.FULL,
      deviceName: data.deviceName ?? null,
    };
    this.records.set(id, record);
    return record;
  }

  async revoke(id: string): Promise<void> {
    const record = this.records.get(id);
    if (record !== undefined) {
      this.records.set(id, { ...record, revokedAt: new Date() });
    }
  }

  async rotate(id: string, successorId: string): Promise<void> {
    this.rotations.push({ from: id, to: successorId });
    await this.revoke(id);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    this.revokeAllCallCount += 1;
    for (const [id, record] of this.records) {
      if (record.userId === userId && record.revokedAt === null) {
        this.records.set(id, { ...record, revokedAt: new Date() });
      }
    }
  }

  async deleteExpired(now: Date): Promise<number> {
    let removed = 0;
    for (const [id, record] of this.records) {
      if (record.expiresAt < now || record.revokedAt !== null) {
        this.records.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  liveTokensFor(userId: string): RefreshTokenRecord[] {
    return [...this.records.values()].filter(
      (record) => record.userId === userId && record.revokedAt === null,
    );
  }
}

/**
 * Deterministic stand-in for bcrypt: `hash(x)` is `hash:x`.
 *
 * `compareCallCount` is what lets a test assert the timing-attack defence — that a
 * comparison happens even when no user was found.
 */
export class FakeHashService implements IHashService {
  compareCallCount = 0;

  async hash(plainText: string): Promise<string> {
    return `hash:${plainText}`;
  }

  async compare(plainText: string, hash: string): Promise<boolean> {
    this.compareCallCount += 1;
    return `hash:${plainText}` === hash;
  }
}

export class FakeTokenService implements ITokenService {
  issuedRefreshTokens: string[] = [];
  /** Every access-token payload minted, so a test can assert on the claims rather than the string. */
  issuedAccessPayloads: AccessTokenPayload[] = [];
  /** The lifetimes asked for, so a test can prove a till session gets a long one. */
  refreshTtls: (number | undefined)[] = [];
  private sequence = 0;

  issueAccessToken(payload: AccessTokenPayload): IssuedToken {
    this.issuedAccessPayloads.push(payload);
    return {
      token: `access.${payload.sub}.${payload.role}.${++this.sequence}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    const [, sub, role] = token.split('.');
    if (sub === undefined || role === undefined) {
      throw new Error('invalid token');
    }
    return { sub, email: 'x@y.z', role: role as AccessTokenPayload['role'] };
  }

  issueRefreshToken(ttlMs?: number): { token: string; tokenHash: string; expiresAt: Date } {
    const token = `refresh-${++this.sequence}`;
    this.issuedRefreshTokens.push(token);
    this.refreshTtls.push(ttlMs);
    return {
      token,
      tokenHash: this.hashRefreshToken(token),
      expiresAt: new Date(Date.now() + (ttlMs ?? 7 * 24 * 60 * 60 * 1000)),
    };
  }

  hashRefreshToken(token: string): string {
    return `sha:${token}`;
  }
}

export class FakeAuditLogRepository implements IAuditLogRepository {
  readonly entries: CreateAuditLogData[] = [];

  async record(data: CreateAuditLogData): Promise<void> {
    this.entries.push(data);
  }

  actions(): string[] {
    return this.entries.map((entry) => entry.action);
  }

  has(action: string): boolean {
    return this.actions().includes(action);
  }
}

/** Silent logger — assertions target behaviour, not log output. */
export const fakeLogger: ILogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => fakeLogger,
};
