import type { RequestHandler } from 'express';
import type { z, ZodType } from 'zod';
import { ValidationError } from '../../../core/domain/errors/domain-error.js';

/** Which parts of the request to validate. Omitted parts are left untouched. */
export interface ValidationSchemas {
  readonly body?: ZodType;
  readonly query?: ZodType;
  readonly params?: ZodType;
}

/**
 * Turns a zod error into the `details` map the API contract specifies:
 * `{ "address.city": ["Required"] }`.
 */
function toDetails(error: z.ZodError, section: string): Record<string, string[]> {
  const details: Record<string, string[]> = {};

  for (const issue of error.issues) {
    // Prefix with the section so `body.email` and `query.email` stay distinct.
    const path = issue.path.length > 0 ? issue.path.join('.') : section;
    const key = `${section}.${path}`;
    (details[key] ??= []).push(issue.message);
  }

  return details;
}

/**
 * Validates and *replaces* the request parts with their parsed output, so
 * handlers receive coerced, trusted values (numbers as numbers, defaults
 * applied) rather than raw strings.
 *
 * Validation lives in the presentation layer on purpose: it guards the boundary,
 * while the domain enforces the invariants that survive past it.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    const details: Record<string, string[]> = {};

    if (schemas.params !== undefined) {
      const result = schemas.params.safeParse(req.params);
      if (result.success) {
        req.params = result.data as typeof req.params;
      } else {
        Object.assign(details, toDetails(result.error, 'params'));
      }
    }

    if (schemas.query !== undefined) {
      const result = schemas.query.safeParse(req.query);
      if (result.success) {
        // Express 5 exposes `query` as a getter, so it must be redefined
        // rather than assigned.
        Object.defineProperty(req, 'query', {
          value: result.data,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } else {
        Object.assign(details, toDetails(result.error, 'query'));
      }
    }

    if (schemas.body !== undefined) {
      const result = schemas.body.safeParse(req.body);
      if (result.success) {
        req.body = result.data;
      } else {
        Object.assign(details, toDetails(result.error, 'body'));
      }
    }

    if (Object.keys(details).length > 0) {
      next(new ValidationError('The submitted data is invalid.', details));
      return;
    }

    next();
  };
}
