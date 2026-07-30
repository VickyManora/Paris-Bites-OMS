import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { env, isTest } from '../../../config/env.js';
import { HttpStatus } from '../../../shared/http-status.js';
import type { ApiErrorResponse } from '../../../shared/types/api-response.js';

function buildBody(message: string): ApiErrorResponse {
  return {
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message },
    meta: { timestamp: new Date().toISOString() },
  };
}

/**
 * Baseline limiter for the whole API.
 *
 * Note the in-memory store: it counts per process, so horizontally scaling the
 * Railway service multiplies the effective limit. Swap in a Redis store before
 * running more than one instance.
 */
export function globalRateLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Tests would otherwise trip the limiter and fail unpredictably.
    skip: () => isTest,
    message: buildBody('Too many requests. Please slow down and try again shortly.'),
    statusCode: HttpStatus.TOO_MANY_REQUESTS,
  });
}

/**
 * Much tighter limiter for credential endpoints (login, refresh, password
 * reset), where the threat is online guessing rather than general load.
 */
export function authRateLimiter(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Count only failures, so a legitimate user is never locked out by a
    // successful login.
    skipSuccessfulRequests: true,
    skip: () => isTest,
    message: buildBody('Too many attempts. Please wait before trying again.'),
    statusCode: HttpStatus.TOO_MANY_REQUESTS,
  });
}
