import type { RequestHandler } from 'express';
import type { ITokenService } from '../../../core/application/ports/token.service.port.js';
import { UnauthorizedError } from '../../../core/domain/errors/domain-error.js';

/**
 * Verifies the bearer access token and attaches the caller to `req.user`.
 *
 * Intentionally stateless: no database lookup, so authenticating a request costs
 * one signature check. The trade-off is that a role change or suspension only
 * takes effect when the short-lived access token expires — which is why access
 * token lifetime is measured in minutes.
 */
export function authenticate(tokenService: ITokenService): RequestHandler {
  return (req, _res, next) => {
    const header = req.get('authorization');

    if (header === undefined || !header.toLowerCase().startsWith('bearer ')) {
      next(new UnauthorizedError('A bearer access token is required.'));
      return;
    }

    const token = header.slice('bearer '.length).trim();

    if (token.length === 0) {
      next(new UnauthorizedError('A bearer access token is required.'));
      return;
    }

    try {
      const payload = tokenService.verifyAccessToken(token);
      req.user = { id: payload.sub, email: payload.email, role: payload.role };
      next();
    } catch (error) {
      next(error);
    }
  };
}
