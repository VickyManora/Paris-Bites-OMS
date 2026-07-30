import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { AppError, toAppError } from './app-error';

/** Real `HttpHeaders`, not a stub — the code under test reads them. */
function httpError(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body, headers: new HttpHeaders(headers) });
}

/**
 * Every failure the user sees passes through here.
 *
 * The rule this pins down is that a response which is **not** in the API's envelope never
 * reaches the screen verbatim — a proxy's HTML error page or an unhandled stack trace is
 * exactly the thing that leaks internals into a toast.
 */
describe('toAppError', () => {
  it('passes an AppError through unchanged', () => {
    const original = new AppError('CONFLICT', 'Already recorded.', 409);
    expect(toAppError(original)).toBe(original);
  });

  it('unwraps the API error envelope', () => {
    const error = toAppError(
      httpError(422, {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The submitted data is invalid.',
          details: { 'body.reason': ['Say why the figure changed.'] },
        },
      }),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('The submitted data is invalid.');
    expect(error.status).toBe(422);
    expect(error.isValidationError).toBe(true);
  });

  it('reports a blocked or dropped request as a network problem', () => {
    // Status 0 is CORS or connectivity; there is no body to read.
    const error = toAppError(httpError(0, null));

    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.message).toContain('Unable to reach the server');
  });

  it('never surfaces a non-envelope body to the user', () => {
    const error = toAppError(httpError(502, '<html><body>Bad Gateway</body></html>'));

    expect(error.message).not.toContain('html');
    expect(error.message).not.toContain('Bad Gateway');
    expect(error.isServerError).toBe(true);
  });

  it('never surfaces a raw stack trace', () => {
    const error = toAppError(
      httpError(500, { stack: 'TypeError: x is not a function\n  at Foo.bar' }),
    );

    expect(error.message).not.toContain('TypeError');
    expect(error.isServerError).toBe(true);
  });

  it('keeps the request id so a failure can be traced to a log line', () => {
    const error = toAppError(
      httpError(
        500,
        { error: { code: 'INTERNAL', message: 'Something failed.' } },
        {
          'x-request-id': 'abc-123',
        },
      ),
    );

    expect(error.requestId).toBe('abc-123');
  });

  it('translates a non-HTTP throw into a generic failure', () => {
    const error = toAppError(new Error('boom'));

    expect(error.message).not.toContain('boom');
    expect(error.message).toContain('Something went wrong');
  });
});

describe('AppError.messagesFor', () => {
  const error = new AppError('VALIDATION_ERROR', 'Invalid.', 422, {
    'body.email': ['That address is already registered.'],
    reason: ['A reason is required.'],
  });

  /** The API namespaces paths as `body.email`; controls are named `email`. */
  it('finds a field under its namespaced path', () => {
    expect(error.messagesFor('email')).toEqual(['That address is already registered.']);
  });

  it('finds a field under its bare name', () => {
    expect(error.messagesFor('reason')).toEqual(['A reason is required.']);
  });

  it('returns nothing for a field with no error', () => {
    expect(error.messagesFor('notAField')).toEqual([]);
  });

  it('returns nothing when the error carries no details', () => {
    expect(new AppError('CONFLICT', 'Nope.', 409).messagesFor('anything')).toEqual([]);
  });
});
