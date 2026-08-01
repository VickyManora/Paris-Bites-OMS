import type { User } from '../../../domain/entities/user.entity.js';
import { UnauthorizedError } from '../../../domain/errors/domain-error.js';
import {
  AuditAction,
  type IAuditLogRepository,
} from '../../../domain/repositories/audit-log.repository.js';
import type { IRefreshTokenRepository } from '../../../domain/repositories/refresh-token.repository.js';
import type { IUserRepository } from '../../../domain/repositories/user.repository.js';
import type { AuthResult, LoginInput } from '../../dtos/auth.dto.js';
import { AuthMapper } from '../../mappers/auth.mapper.js';
import type { IHashService } from '../../ports/hash.service.port.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { ITokenService } from '../../ports/token.service.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';
import { SessionScope } from '../../../domain/enums/session-scope.enum.js';

/**
 * Deliberately identical message for every failure mode: unknown email, wrong
 * password, suspended account, soft-deleted account.
 *
 * Distinguishing them would turn the login form into an account-enumeration
 * oracle — an attacker could confirm which staff emails exist before ever
 * guessing a password.
 */
const INVALID_CREDENTIALS = 'The email or password you entered is incorrect.';

/**
 * How long a till device stays signed in: 180 days.
 *
 * Long enough that nobody at the counter ever meets the login form again, and short enough that a
 * device forgotten in a drawer stops being a live session within the year. It is a *scoped*
 * session — see `issueSession` — which is what makes six months a reasonable number rather than a
 * reckless one.
 */
const TILL_SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export class LoginUseCase implements IUseCase<LoginInput, AuthResult> {
  /**
   * Digest compared against when no user was found, so the work done is the same
   * either way — see `execute`.
   *
   * Derived at runtime from a random value rather than hardcoded: a literal that
   * was not a well-formed digest for the configured cost factor would make
   * `compare` return immediately, silently removing the timing defence it exists
   * to provide. Computed once, on first miss, and cached.
   */
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly users: IUserRepository,
    private readonly refreshTokens: IRefreshTokenRepository,
    private readonly hasher: IHashService,
    private readonly tokens: ITokenService,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: LoginInput): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();
    const user = await this.users.findByEmail(email);

    /*
     * Always run a password comparison, even when no user exists.
     *
     * Returning early would make "unknown email" measurably faster than "wrong
     * password" — bcrypt at cost 12 takes ~250ms, which is trivially detectable
     * over the network. Hashing against a dummy digest keeps the timing flat, so
     * the endpoint cannot be used to enumerate accounts.
     */
    const passwordMatches = await this.hasher.compare(
      input.password,
      user?.passwordHash ?? (await this.getDummyHash()),
    );

    if (user === null || !passwordMatches) {
      await this.recordFailure(email, user, input);
      throw new UnauthorizedError(INVALID_CREDENTIALS);
    }

    /*
     * Status is checked only after the password is verified. Checking it first
     * would let an attacker learn that an address belongs to a suspended account
     * without knowing the password.
     */
    if (!user.canSignIn) {
      await this.recordFailure(email, user, input, 'account_not_active');
      throw new UnauthorizedError(INVALID_CREDENTIALS);
    }

    return this.issueSession(user, input);
  }

  private async issueSession(user: User, input: LoginInput): Promise<AuthResult> {
    /*
     * A till sign-in is a different kind of session, and both differences are deliberate.
     *
     * The counter phone is signed in once and never again — the shop's API sleeps after fifteen
     * idle minutes and takes about a minute to wake, so a login form is the worst possible thing to
     * put between a cashier and a customer. A session measured in months removes it permanently.
     *
     * That is only defensible because of the second difference: the session is scoped to
     * `POS_OPERATE` no matter who signs in. Sunil is an administrator; his till session is not. A
     * phone left on the counter, or lost on the way home, can ring up an order and cannot read the
     * day's takings, cancel a paid order, or touch inventory, suppliers or reports.
     *
     * The scope is stored on the token row as well as signed into the access token, so rotation
     * carries it forward — see `RefreshToken.scope`.
     */
    const scope = input.tillDevice === true ? SessionScope.POS : SessionScope.FULL;

    const accessToken = this.tokens.issueAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      scope,
    });

    const refreshToken = this.tokens.issueRefreshToken(
      scope === SessionScope.POS ? TILL_SESSION_TTL_MS : undefined,
    );

    await this.refreshTokens.create({
      // Only the digest is persisted, so a database leak cannot be replayed.
      tokenHash: refreshToken.tokenHash,
      userId: user.id,
      expiresAt: refreshToken.expiresAt,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      scope,
      deviceName: input.deviceName,
    });

    await this.users.recordLogin(user.id, new Date());

    await this.auditLog.record({
      actorId: user.id,
      action: AuditAction.LOGIN_SUCCEEDED,
      entityType: 'User',
      entityId: user.id,
      ip: input.ipAddress,
      metadata: { userAgent: input.userAgent },
    });

    this.logger.info('User signed in', { userId: user.id, role: user.role, scope });

    return {
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
      refreshToken: refreshToken.token,
      refreshTokenExpiresAt: refreshToken.expiresAt,
      // Scoped, for the same reason `/auth/me` is: the client draws its navigation from this list,
      // and a till device must not be handed the administrator's.
      user: AuthMapper.toAuthenticatedUserDto(user, scope),
    };
  }

  private getDummyHash(): Promise<string> {
    // Hashing a random value means the digest can never accidentally match a
    // real password, and uses the same cost factor as every stored hash.
    this.dummyHash ??= this.hasher.hash(`unused-${Math.random()}-${Date.now()}`);
    return this.dummyHash;
  }

  private async recordFailure(
    email: string,
    user: User | null,
    input: LoginInput,
    reason = 'invalid_credentials',
  ): Promise<void> {
    await this.auditLog.record({
      actorId: user?.id ?? null,
      action: AuditAction.LOGIN_FAILED,
      entityType: 'User',
      entityId: user?.id,
      ip: input.ipAddress,
      // The attempted email is recorded (it is needed to investigate an attack)
      // but never the password.
      metadata: { email, reason, userAgent: input.userAgent },
    });

    this.logger.warn('Failed sign-in attempt', { email, reason, ip: input.ipAddress });
  }
}
