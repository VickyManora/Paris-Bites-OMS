import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/**
 * Reusable validators.
 *
 * Each returns `null` for empty values and lets `Validators.required` decide
 * whether emptiness is an error. Mixing the two concerns is what produces the
 * familiar bug where a field shows "invalid format" before the user has typed.
 */

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * Mirrors the backend password policy in
 * `backend/src/presentation/http/validators/common.validators.ts`. Client-side
 * checking is for fast feedback only — the server remains the authority.
 */
export function passwordStrength(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value as unknown;

    if (isEmpty(value) || typeof value !== 'string') {
      return null;
    }

    const failures: string[] = [];

    if (value.length < 10) failures.push('at least 10 characters');
    if (!/[a-z]/.test(value)) failures.push('a lowercase letter');
    if (!/[A-Z]/.test(value)) failures.push('an uppercase letter');
    if (!/\d/.test(value)) failures.push('a number');

    return failures.length === 0 ? null : { passwordStrength: { missing: failures } };
  };
}

/**
 * Cross-field check that two controls match. Applied to the parent group, not a
 * control, because only the group can see both values.
 *
 * The error is also set on the confirmation control so it can be displayed
 * beneath the offending field.
 */
export function matchFields(sourceField: string, confirmField: string): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const source = group.get(sourceField);
    const confirmation = group.get(confirmField);

    if (source === null || confirmation === null) {
      return null;
    }

    if (isEmpty(confirmation.value)) {
      return null;
    }

    if (source.value === confirmation.value) {
      // Clear only our own error; leave any others the control has.
      if (confirmation.hasError('fieldsMismatch')) {
        const remaining = { ...confirmation.errors };
        delete remaining['fieldsMismatch'];
        confirmation.setErrors(Object.keys(remaining).length > 0 ? remaining : null);
      }
      return null;
    }

    confirmation.setErrors({ ...confirmation.errors, fieldsMismatch: true });
    return { fieldsMismatch: true };
  };
}

/** Rejects a value that is only whitespace, which `required` accepts. */
export function notBlank(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value as unknown;

    if (isEmpty(value) || typeof value !== 'string') {
      return null;
    }

    return value.trim().length > 0 ? null : { notBlank: true };
  };
}

/** Non-negative number, for quantities and stock levels. */
export function nonNegativeNumber(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value as unknown;

    if (isEmpty(value)) {
      return null;
    }

    const numeric = Number(value);

    if (Number.isNaN(numeric)) {
      return { notANumber: true };
    }

    return numeric >= 0 ? null : { nonNegative: { actual: numeric } };
  };
}

/** Positive integer, for counts that cannot be fractional. */
export function positiveInteger(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value as unknown;

    if (isEmpty(value)) {
      return null;
    }

    const numeric = Number(value);

    if (!Number.isInteger(numeric)) {
      return { notAnInteger: true };
    }

    return numeric > 0 ? null : { positive: { actual: numeric } };
  };
}
