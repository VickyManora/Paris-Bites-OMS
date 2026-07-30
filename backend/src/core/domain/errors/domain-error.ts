import { HttpStatus, type HttpStatusCode } from '../../../shared/http-status.js';

/**
 * Base class for every error the application raises deliberately.
 *
 * The domain owns the error *taxonomy*; the HTTP layer owns the *presentation*.
 * `status` is carried here purely so a single error middleware can translate
 * any domain error without a growing switch statement — the domain never
 * imports Express, and nothing here knows about request or response objects.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly status: HttpStatusCode;

  /** Field-level failures, keyed by dotted field path. */
  readonly details?: Readonly<Record<string, readonly string[]>>;

  /**
   * True when the message is safe to show an end user. Unexpected errors set
   * this to false so the middleware substitutes a generic message.
   */
  readonly isOperational: boolean = true;

  protected constructor(message: string, details?: Record<string, readonly string[]>) {
    super(message);
    this.name = new.target.name;
    if (details !== undefined) {
      this.details = details;
    }
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;

  constructor(
    message = 'The submitted data is invalid.',
    details?: Record<string, readonly string[]>,
  ) {
    super(message, details);
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  readonly status = HttpStatus.NOT_FOUND;

  constructor(resource: string, identifier?: string) {
    super(
      identifier === undefined
        ? `${resource} was not found.`
        : `${resource} with identifier "${identifier}" was not found.`,
    );
  }
}

/** A uniqueness or state conflict — duplicate email, already-approved order. */
export class ConflictError extends DomainError {
  readonly code = 'CONFLICT';
  readonly status = HttpStatus.CONFLICT;

  constructor(message: string, details?: Record<string, readonly string[]>) {
    super(message, details);
  }
}

/** Authentication failed or was absent. Never disclose which of the two. */
export class UnauthorizedError extends DomainError {
  readonly code = 'UNAUTHORIZED';
  readonly status = HttpStatus.UNAUTHORIZED;

  constructor(message = 'Authentication is required.') {
    super(message);
  }
}

/** Authenticated, but the role does not permit this action. */
export class ForbiddenError extends DomainError {
  readonly code = 'FORBIDDEN';
  readonly status = HttpStatus.FORBIDDEN;

  constructor(message = 'You do not have permission to perform this action.') {
    super(message);
  }
}

/** A request that is well-formed but violates a business rule. */
export class BusinessRuleError extends DomainError {
  readonly code = 'BUSINESS_RULE_VIOLATION';
  readonly status = HttpStatus.BAD_REQUEST;

  constructor(message: string, details?: Record<string, readonly string[]>) {
    super(message, details);
  }
}

/** Wraps failures from a dependency we do not control. Not user-facing. */
export class InfrastructureError extends DomainError {
  readonly code = 'INFRASTRUCTURE_ERROR';
  readonly status = HttpStatus.INTERNAL_SERVER_ERROR;
  override readonly isOperational = false;

  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}
