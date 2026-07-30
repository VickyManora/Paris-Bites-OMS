import { createHash, randomBytes } from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import type {
  AccessTokenPayload,
  IssuedToken,
  ITokenService,
} from '../../core/application/ports/token.service.port.js';
import { isRole } from '../../core/domain/enums/role.enum.js';
import { UnauthorizedError } from '../../core/domain/errors/domain-error.js';

export interface JwtTokenServiceOptions {
  readonly accessSecret: string;
  readonly refreshSecret: string;
  readonly accessExpiresIn: string;
  readonly refreshExpiresIn: string;
  readonly issuer: string;
  readonly audience: string;
}

/**
 * JWT adapter for `ITokenService`.
 *
 * Access tokens are signed JWTs so authorisation needs no database round trip.
 * Refresh tokens are *opaque random strings*, not JWTs — they must be
 * revocable, and revoking a stateless token is a contradiction. Only their
 * SHA-256 digest is persisted.
 */
export class JwtTokenService implements ITokenService {
  constructor(private readonly options: JwtTokenServiceOptions) {}

  issueAccessToken(payload: AccessTokenPayload): IssuedToken {
    const signOptions: SignOptions = {
      // `expiresIn` is a template-literal union in @types/jsonwebtoken, but the
      // value comes from validated configuration as a plain string. The cast
      // narrows away `undefined`; `parseDurationMs` is the runtime guard that
      // the format is actually one jsonwebtoken accepts.
      expiresIn: this.options.accessExpiresIn as NonNullable<SignOptions['expiresIn']>,
      issuer: this.options.issuer,
      audience: this.options.audience,
      subject: payload.sub,
    };

    const token = jwt.sign(
      { email: payload.email, role: payload.role },
      this.options.accessSecret,
      signOptions,
    );

    return { token, expiresAt: this.decodeExpiry(token) };
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    let decoded: string | JwtPayload;

    try {
      decoded = jwt.verify(token, this.options.accessSecret, {
        issuer: this.options.issuer,
        audience: this.options.audience,
      });
    } catch {
      // Deliberately opaque: never reveal whether a token was expired,
      // malformed or signed with the wrong key.
      throw new UnauthorizedError('Your session is invalid or has expired.');
    }

    if (typeof decoded === 'string') {
      throw new UnauthorizedError('Your session is invalid or has expired.');
    }

    const { sub, email, role } = decoded;

    if (typeof sub !== 'string' || typeof email !== 'string' || !isRole(role)) {
      throw new UnauthorizedError('Your session is invalid or has expired.');
    }

    return { sub, email, role };
  }

  issueRefreshToken(): { token: string; tokenHash: string; expiresAt: Date } {
    // 512 bits of entropy — brute force is not a concern, so the token can stay
    // opaque and cheap to compare.
    const token = randomBytes(64).toString('base64url');

    return {
      token,
      tokenHash: this.hashRefreshToken(token),
      expiresAt: new Date(Date.now() + this.parseDurationMs(this.options.refreshExpiresIn)),
    };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Reads `exp` back off a freshly signed token so callers get an exact date. */
  private decodeExpiry(token: string): Date {
    const decoded = jwt.decode(token);

    if (decoded === null || typeof decoded === 'string' || typeof decoded.exp !== 'number') {
      throw new Error('Signed access token is missing an `exp` claim.');
    }

    return new Date(decoded.exp * 1000);
  }

  /** Parses the `15m` / `7d` / `3600` forms accepted by jsonwebtoken. */
  private parseDurationMs(duration: string): number {
    const match = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(duration.trim());

    if (match === null) {
      throw new Error(`Unsupported duration format: "${duration}".`);
    }

    const amount = Number(match[1]);
    const unit = match[2] ?? 's';

    const multipliers: Record<string, number> = {
      ms: 1,
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };

    const multiplier = multipliers[unit];

    if (multiplier === undefined) {
      throw new Error(`Unsupported duration unit: "${unit}".`);
    }

    return amount * multiplier;
  }
}
