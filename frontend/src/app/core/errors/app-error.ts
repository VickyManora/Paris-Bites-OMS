import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';
import type { ApiErrorBody } from '../models/api-response.model';

/**
 * Normalised error the whole app works with.
 *
 * Components should never receive an `HttpErrorResponse`: it forces every
 * consumer to re-derive whether a failure was a network drop, a validation
 * problem or a server fault. `errorInterceptor` converts once, here.
 */
export class AppError extends Error {
  constructor(
    /** Stable code from the API, or a synthetic one for transport failures. */
    readonly code: string,
    message: string,
    /** HTTP status, or 0 when the request never reached the server. */
    readonly status: number,
    readonly details?: Readonly<Record<string, readonly string[]>>,
    readonly requestId?: string,
    /**
     * The original throwable, when the user-facing `message` had to be replaced.
     *
     * Keeps the developer-facing text reachable by the logger and any error reporter
     * without it ever being rendered — the two audiences want different sentences.
     */
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  /** True when the request never got a response — offline, DNS, CORS, timeout. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }

  /**
   * True when the deadline expired before a reply arrived.
   *
   * Worth distinguishing from a plain network error because the two say different things about
   * what happened at the other end: a request that never left changed nothing, while one that
   * timed out may well have been carried out and only the answer was lost. Anything that
   * retries a write has to know the difference.
   */
  get isTimeout(): boolean {
    return this.code === 'TIMEOUT';
  }

  /**
   * True when sending the same request again is a reasonable next move.
   *
   * Transport failures and a server saying "later"; never a validation error or a 403, where a
   * second identical attempt fails identically and a Retry button would be a lie.
   */
  get isRetryable(): boolean {
    return this.isNetworkError || this.isTimeout || this.status === 429 || this.isServerError;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isValidationError(): boolean {
    return this.status === 422 || this.code === 'VALIDATION_ERROR';
  }

  /** Server-side faults, which are worth reporting rather than showing inline. */
  get isServerError(): boolean {
    return this.status >= 500;
  }

  /**
   * Flattens `details` into the messages for one form control.
   * The API namespaces paths as `body.email`, so both forms are accepted.
   */
  messagesFor(field: string): readonly string[] {
    if (this.details === undefined) {
      return [];
    }
    return this.details[field] ?? this.details[`body.${field}`] ?? [];
  }
}

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

/** Narrows an unknown response body to the API's error envelope. */
function extractApiError(body: unknown): ApiErrorBody | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const candidate = (body as { error?: unknown }).error;

  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }

  const { code, message } = candidate as { code?: unknown; message?: unknown };

  if (typeof code !== 'string' || typeof message !== 'string') {
    return null;
  }

  return candidate as ApiErrorBody;
}

/** Translates any thrown HTTP failure into an `AppError`. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  /*
   * The deadline from `timeoutInterceptor` expired.
   *
   * Checked before `HttpErrorResponse` because rxjs throws its own error type here — there is no
   * response to read, and without this branch it would fall through to the generic client-error
   * case and reach the user as "Something went wrong".
   *
   * The wording avoids claiming the request failed, because a timeout does not know that. For a
   * write it may well have succeeded with only the reply lost, which is precisely why order
   * placement carries an idempotency key.
   */
  if (error instanceof TimeoutError) {
    return new AppError(
      'TIMEOUT',
      'The server is taking too long to respond. Check your connection and try again.',
      0,
      undefined,
      undefined,
      error,
    );
  }

  if (error instanceof HttpErrorResponse) {
    const requestId = error.headers.get('x-request-id') ?? undefined;

    // Status 0 means the browser blocked or dropped the request; there is no
    // body to read, and the cause is usually connectivity or CORS.
    if (error.status === 0) {
      return new AppError(
        'NETWORK_ERROR',
        'Unable to reach the server. Check your connection and try again.',
        0,
        undefined,
        requestId,
      );
    }

    const apiError = extractApiError(error.error);

    if (apiError !== null) {
      return new AppError(
        apiError.code,
        apiError.message,
        error.status,
        apiError.details,
        requestId,
      );
    }

    // A response that is not in our envelope came from a proxy, gateway or an
    // unhandled crash — never surface its raw text to the user.
    return new AppError('UNEXPECTED_RESPONSE', GENERIC_MESSAGE, error.status, undefined, requestId);
  }

  /*
   * A thrown `Error` that is not an HTTP failure is a bug in this app — a null dereference,
   * a bad cast, a library invariant. Its `message` is written for a developer reading a
   * stack trace, so it said things like "Cannot read properties of undefined (reading
   * 'trim')" straight into a toast. That tells the user nothing they can act on and leaks
   * the shape of the code.
   *
   * The real message is preserved on `cause` so the logger and any error reporter still get
   * it; only what reaches the screen is replaced.
   */
  if (error instanceof Error) {
    return new AppError('CLIENT_ERROR', GENERIC_MESSAGE, 0, undefined, undefined, error);
  }

  return new AppError('UNKNOWN_ERROR', GENERIC_MESSAGE, 0, undefined, undefined, error);
}
