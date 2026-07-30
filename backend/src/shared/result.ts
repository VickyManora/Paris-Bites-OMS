/**
 * Explicit success/failure return type for use cases whose failure modes are
 * expected outcomes rather than exceptions (for example "email already taken").
 *
 * Throwing is still correct for genuinely exceptional conditions — a downed
 * database, a bug. Reserve `Result` for branches the caller must handle.
 */
export type Result<T, E = Error> = Success<T> | Failure<E>;

export interface Success<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Failure<E> {
  readonly ok: false;
  readonly error: E;
}

export function success<T>(value: T): Success<T> {
  return { ok: true, value };
}

export function failure<E>(error: E): Failure<E> {
  return { ok: false, error };
}

export function isSuccess<T, E>(result: Result<T, E>): result is Success<T> {
  return result.ok;
}

export function isFailure<T, E>(result: Result<T, E>): result is Failure<E> {
  return !result.ok;
}

/**
 * Unwraps a result, throwing the contained error if it failed.
 *
 * `E` is intentionally unconstrained so a `Result` can carry a non-Error failure
 * value, which is why the lint rule is suppressed rather than the signature
 * narrowed. Callers that want an Error guarantee should use `Result<T, Error>`.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  // eslint-disable-next-line @typescript-eslint/only-throw-error
  throw result.error;
}
