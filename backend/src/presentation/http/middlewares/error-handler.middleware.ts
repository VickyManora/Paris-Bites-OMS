import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';
import type { ILogger } from '../../../core/application/ports/logger.port.js';
import { DomainError } from '../../../core/domain/errors/domain-error.js';
import { HttpStatus } from '../../../shared/http-status.js';
import { isProduction } from '../../../config/env.js';
import { sendError } from '../serializers/response.serializer.js';

/** Prisma signals unique-constraint and not-found failures with these codes. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';
const PRISMA_RECORD_NOT_FOUND = 'P2025';
const PRISMA_FOREIGN_KEY_VIOLATION = 'P2003';

interface PrismaKnownError {
  readonly code: string;
  readonly meta?: { readonly target?: readonly string[] | string };
}

/** Structural check — avoids importing Prisma's error classes into this layer. */
function asPrismaKnownError(error: unknown): PrismaKnownError | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const candidate = error as { code?: unknown; name?: unknown; meta?: unknown };

  if (typeof candidate.code === 'string' && /^P\d{4}$/.test(candidate.code)) {
    return candidate as PrismaKnownError;
  }

  return null;
}

/**
 * The single exit point for every failure in the process.
 *
 * Responsibilities, in order: classify the error, log it at a severity matching
 * its kind, and emit the standard error envelope. Unrecognised errors always
 * become a generic 500 in production — stack traces and driver messages are
 * exactly what an attacker wants, and they are never useful to a client.
 *
 * Must be registered last, after all routes.
 */
export function errorHandler(logger: ILogger): ErrorRequestHandler {
  return (error, req, res, _next) => {
    // Headers already flushed — the response is committed, so hand back to
    // Express to destroy the socket rather than corrupt the body.
    if (res.headersSent) {
      logger.error('Error thrown after response was sent', error, { path: req.originalUrl });
      return;
    }

    const context = {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      userId: req.user?.id,
    };

    if (error instanceof DomainError) {
      // Expected outcomes are client errors, not incidents: log at warn and
      // reserve error-level noise for genuine faults.
      if (error.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        logger.error(error.message, error, context);
      } else {
        logger.warn(error.message, { ...context, code: error.code });
      }

      const message = error.isOperational
        ? error.message
        : 'Something went wrong. Please try again.';

      sendError(res, error.status, error.code, message, error.details);
      return;
    }

    // A zod error reaching here means a schema ran outside `validate`.
    if (error instanceof z.ZodError) {
      const details: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const key = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        (details[key] ??= []).push(issue.message);
      }

      logger.warn('Unhandled schema validation failure', context);
      sendError(
        res,
        HttpStatus.UNPROCESSABLE_ENTITY,
        'VALIDATION_ERROR',
        'The submitted data is invalid.',
        details,
      );
      return;
    }

    const prismaError = asPrismaKnownError(error);

    if (prismaError !== null) {
      switch (prismaError.code) {
        case PRISMA_UNIQUE_VIOLATION: {
          const target = prismaError.meta?.target;
          const fields: readonly string[] = Array.isArray(target)
            ? target
            : typeof target === 'string'
              ? [target]
              : [];

          logger.warn('Unique constraint violation', { ...context, fields });
          sendError(
            res,
            HttpStatus.CONFLICT,
            'DUPLICATE_RESOURCE',
            'A record with these details already exists.',
            fields.length > 0
              ? Object.fromEntries(fields.map((field) => [field, ['Already in use.']]))
              : undefined,
          );
          return;
        }

        case PRISMA_RECORD_NOT_FOUND: {
          logger.warn('Record not found', context);
          sendError(res, HttpStatus.NOT_FOUND, 'NOT_FOUND', 'The requested record was not found.');
          return;
        }

        case PRISMA_FOREIGN_KEY_VIOLATION: {
          logger.warn('Foreign key constraint violation', context);
          sendError(
            res,
            HttpStatus.BAD_REQUEST,
            'INVALID_REFERENCE',
            'A referenced record does not exist.',
          );
          return;
        }

        default: {
          // Unmapped driver codes are bugs on our side, not client errors.
          logger.error('Unhandled database error', error, {
            ...context,
            prismaCode: prismaError.code,
          });
          sendError(
            res,
            HttpStatus.INTERNAL_SERVER_ERROR,
            'DATABASE_ERROR',
            'A database error occurred. Please try again.',
          );
          return;
        }
      }
    }

    // Malformed JSON from body-parser.
    if (error instanceof SyntaxError && 'body' in error) {
      logger.warn('Malformed JSON body', context);
      sendError(
        res,
        HttpStatus.BAD_REQUEST,
        'MALFORMED_JSON',
        'The request body is not valid JSON.',
      );
      return;
    }

    logger.error('Unhandled error', error, context);

    sendError(
      res,
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_SERVER_ERROR',
      isProduction || !(error instanceof Error)
        ? 'Something went wrong. Please try again.'
        : error.message,
    );
  };
}
