import { FormBuilder, Validators } from '@angular/forms';
import { AppError } from '../../core/errors/app-error';
import { applyServerErrors, markAllAsTouched, pruneEmpty } from './form.utils';

const builder = new FormBuilder();

describe('applyServerErrors', () => {
  function form() {
    return builder.nonNullable.group({
      email: ['', [Validators.required]],
      reason: [''],
      nested: builder.nonNullable.group({ gstin: [''] }),
    });
  }

  /** This is what closes the loop on rules only the server can check. */
  it('puts a server message on the matching control', () => {
    const group = form();

    applyServerErrors(
      group,
      new AppError('VALIDATION_ERROR', 'Invalid.', 422, {
        'body.email': ['That address is already registered.'],
      }),
    );

    expect(group.controls.email.getError('server')).toBe('That address is already registered.');
    // Touched, or a pristine control hides its error and the user sees nothing happen.
    expect(group.controls.email.touched).toBe(true);
  });

  it('accepts a bare field name as well as a namespaced path', () => {
    const group = form();

    applyServerErrors(
      group,
      new AppError('VALIDATION_ERROR', 'Invalid.', 422, { reason: ['Say why.'] }),
    );

    expect(group.controls.reason.getError('server')).toBe('Say why.');
  });

  /**
   * The important half: a message with no matching control must be *returned*, not dropped.
   * Silently losing "invoice already recorded" is how a form appears to do nothing on submit.
   */
  it('returns messages that match no control', () => {
    const unmatched = applyServerErrors(
      form(),
      new AppError('CONFLICT', 'Nope.', 409, {
        'body.somethingElse': ['That invoice already exists.'],
      }),
    );

    expect(unmatched).toEqual(['That invoice already exists.']);
  });

  it('preserves existing validation errors alongside the server one', () => {
    const group = form();
    group.controls.email.setValue('');
    group.controls.email.updateValueAndValidity();

    applyServerErrors(
      group,
      new AppError('VALIDATION_ERROR', 'Invalid.', 422, { email: ['Already taken.'] }),
    );

    expect(group.controls.email.getError('required')).toBe(true);
    expect(group.controls.email.getError('server')).toBe('Already taken.');
  });

  it('does nothing when the error carries no details', () => {
    const group = form();

    expect(applyServerErrors(group, new AppError('CONFLICT', 'Nope.', 409))).toEqual([]);
    expect(group.controls.email.getError('server')).toBeUndefined();
  });
});

describe('markAllAsTouched', () => {
  it('reaches nested groups, so their errors appear too', () => {
    const group = builder.nonNullable.group({
      email: [''],
      nested: builder.nonNullable.group({ gstin: [''] }),
    });

    markAllAsTouched(group);

    expect(group.controls.email.touched).toBe(true);
    expect(group.controls.nested.controls.gstin.touched).toBe(true);
  });
});

describe('pruneEmpty', () => {
  /** A cleared optional field must be omitted, not sent as "" — the API rejects blanks. */
  it('drops empty strings, nulls and undefined', () => {
    expect(pruneEmpty({ a: 'x', b: '', c: null, d: undefined, e: 0 })).toEqual({ a: 'x', e: 0 });
  });

  it('keeps a legitimate zero and false', () => {
    // Both are falsy and both are real answers.
    expect(pruneEmpty({ count: 0, active: false })).toEqual({ count: 0, active: false });
  });
});
