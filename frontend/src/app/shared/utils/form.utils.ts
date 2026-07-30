import type { AbstractControl, FormGroup, ValidationErrors } from '@angular/forms';
import type { AppError } from '../../core/errors/app-error';

/**
 * Turns Angular's `ValidationErrors` into the message a user actually reads.
 *
 * One function rather than a template full of `@if (control.hasError(...))`
 * blocks, so wording stays consistent across every form in the app.
 *
 * **This reads validation state; it never changes it.** Every message here is a rendering of an error
 * some validator already produced.
 *
 * `hints` lets a call site override one key where the generic wording is not good enough — a
 * `pattern` failure is the usual case, because "GSTIN is invalid" tells someone nothing about what a
 * GSTIN looks like. Overriding beats adding another branch here for every regex in the app.
 */
export function firstErrorMessage(
  control: AbstractControl,
  label = 'This field',
  hints?: Readonly<Record<string, string>>,
): string | null {
  if (control.errors === null || (!control.touched && !control.dirty)) {
    return null;
  }

  const errors: ValidationErrors = control.errors;

  /*
   * A caller's wording wins, and is checked first.
   *
   * Before the generic branches rather than after: `pattern` used to fall through every branch to
   * "GSTIN is invalid." — technically true and useless. Checking overrides first means a call site can
   * improve any message without this function needing to know why.
   */
  if (hints !== undefined) {
    for (const key of Object.keys(errors)) {
      const override = hints[key];
      if (override !== undefined) {
        return override;
      }
    }
  }

  if (errors['required'] !== undefined) return `${label} is required.`;
  if (errors['notBlank'] !== undefined) return `${label} cannot be blank.`;
  if (errors['email'] !== undefined) return 'Enter a valid email address.';

  const minlength = errors['minlength'] as { requiredLength: number } | undefined;
  if (minlength !== undefined) {
    return `${label} must be at least ${minlength.requiredLength} characters.`;
  }

  const maxlength = errors['maxlength'] as { requiredLength: number } | undefined;
  if (maxlength !== undefined) {
    return `${label} must be at most ${maxlength.requiredLength} characters.`;
  }

  const min = errors['min'] as { min: number } | undefined;
  if (min !== undefined) return `${label} must be at least ${min.min}.`;

  const max = errors['max'] as { max: number } | undefined;
  if (max !== undefined) return `${label} must be at most ${max.max}.`;

  const strength = errors['passwordStrength'] as { missing: readonly string[] } | undefined;
  if (strength !== undefined) {
    return `Password needs ${strength.missing.join(', ')}.`;
  }

  if (errors['fieldsMismatch'] !== undefined) return 'The values do not match.';
  if (errors['notANumber'] !== undefined) return `${label} must be a number.`;
  if (errors['notAnInteger'] !== undefined) return `${label} must be a whole number.`;
  if (errors['nonNegative'] !== undefined) return `${label} cannot be negative.`;
  if (errors['positive'] !== undefined) return `${label} must be greater than zero.`;

  /*
   * `pattern`, generically.
   *
   * Named branches above cover the app's own validators; a raw `Validators.pattern` is the one case
   * this cannot word well, because only the call site knows what the regex means. Saying so beats
   * "is invalid", and `hints` above is how a form supplies the real sentence.
   */
  if (errors['pattern'] !== undefined) return `${label} is not in the expected format.`;

  // Material's datepicker sets this when the typed text cannot be parsed as a date at all.
  if (errors['matDatepickerParse'] !== undefined) return `${label} is not a date we can read.`;

  // Set by `applyServerErrors` — already a complete sentence from the API.
  const server = errors['server'] as string | undefined;
  if (server !== undefined) return server;

  return `${label} is invalid.`;
}

/**
 * Marks every control touched so validation messages appear.
 *
 * Needed on submit: a user who clicks the button without touching a field would
 * otherwise see nothing happen, because pristine controls hide their errors.
 */
export function markAllAsTouched(group: FormGroup): void {
  group.markAllAsTouched();

  for (const control of Object.values(group.controls)) {
    if (isFormGroup(control)) {
      markAllAsTouched(control);
    }
  }
}

/**
 * Projects server-side validation failures onto the matching controls.
 *
 * This is what closes the loop on rules only the server can check — "this SKU is
 * already taken" belongs under the SKU field, not in a toast. Unmatched keys are
 * returned so the caller can surface them at form level rather than lose them.
 */
export function applyServerErrors(group: FormGroup, error: AppError): readonly string[] {
  if (error.details === undefined) {
    return [];
  }

  const unmatched: string[] = [];

  for (const [path, messages] of Object.entries(error.details)) {
    // The API namespaces paths as `body.email`; controls are named `email`.
    const controlName = path.replace(/^(body|query|params)\./, '');
    const control = group.get(controlName);
    const message = messages[0];

    if (control !== null && message !== undefined) {
      control.setErrors({ ...control.errors, server: message });
      control.markAsTouched();
    } else if (message !== undefined) {
      unmatched.push(message);
    }
  }

  return unmatched;
}

/** Strips empty strings so a cleared optional field is omitted, not sent as "". */
export function pruneEmpty<T extends Record<string, unknown>>(value: T): Partial<T> {
  const result: Partial<T> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined || entry === '') {
      continue;
    }
    result[key as keyof T] = entry as T[keyof T];
  }

  return result;
}

function isFormGroup(control: AbstractControl): control is FormGroup {
  return 'controls' in control;
}
