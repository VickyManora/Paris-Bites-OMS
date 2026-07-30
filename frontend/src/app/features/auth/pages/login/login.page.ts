import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../../core/auth/services/auth.service';
import { AppRoutes } from '../../../../core/constants/app.constants';
import type { AppError } from '../../../../core/errors/app-error';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { InlineAlertComponent } from '../../../../shared/components/inline-alert/inline-alert.component';
import { MATERIAL_FORM_IMPORTS } from '../../../../shared/material/material-imports';
import { applyServerErrors, firstErrorMessage } from '../../../../shared/utils/form.utils';

/**
 * Sign-in page.
 *
 * Form state is Reactive Forms (validation, dirty/touched tracking); page state is
 * signals. Mixing them this way is deliberate: `FormControl` already models a
 * control's own state well, while "is a request in flight" and "what did the
 * server say" are component state and belong in signals, where the template reads
 * them synchronously under `OnPush`.
 */
@Component({
  selector: 'pb-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    InlineAlertComponent,
    MatProgressSpinnerModule,
    ...MATERIAL_FORM_IMPORTS,
  ],
  template: `
    <form
      [formGroup]="form"
      (ngSubmit)="submit()"
      class="pb-form flex flex-col gap-pb-3"
      novalidate
    >
      <div class="mb-pb-2">
        <h2 class="m-0 text-pb-heading text-on-surface">Sign in</h2>
        <p class="m-0 mt-pb-1 text-pb-body text-on-surface-variant">
          Use your Paris Bites account to continue.
        </p>
      </div>

      <!-- Sign-in failures are shown here rather than as a snackbar: the message
           belongs with the form the user is about to correct. -->
      @if (formError(); as message) {
        <pb-inline-alert [message]="message" />
      }

      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Email</mat-label>
        <input
          matInput
          type="email"
          formControlName="email"
          autocomplete="username"
          inputmode="email"
          autocapitalize="none"
          spellcheck="false"
          required
          [attr.aria-invalid]="emailError() !== null"
        />
        <mat-icon matSuffix aria-hidden="true">mail</mat-icon>
        @if (emailError(); as message) {
          <mat-error>{{ message }}</mat-error>
        }
      </mat-form-field>

      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Password</mat-label>
        <input
          matInput
          [type]="passwordVisible() ? 'text' : 'password'"
          formControlName="password"
          autocomplete="current-password"
          required
          [attr.aria-invalid]="passwordError() !== null"
        />
        <button
          matIconButton
          matSuffix
          type="button"
          [attr.aria-label]="passwordVisible() ? 'Hide password' : 'Show password'"
          [attr.aria-pressed]="passwordVisible()"
          (click)="togglePasswordVisibility()"
        >
          <mat-icon>{{ passwordVisible() ? 'visibility_off' : 'visibility' }}</mat-icon>
        </button>
        @if (passwordError(); as message) {
          <mat-error>{{ message }}</mat-error>
        }
      </mat-form-field>

      <!--
        A real 'type="submit"', unlike the dialogs: this form is submitted with Enter from the password
        field as often as by pressing the button, so the native submit path is the primary one and
        'pb-submit-button' — which is deliberately 'type="button"' — would break it.
      -->
      <button
        matButton="filled"
        type="submit"
        class="pb-btn pb-btn-lg mt-pb-2"
        [class.pb-submit-busy]="submitting()"
        [disabled]="submitting()"
        [attr.aria-busy]="submitting()"
      >
        @if (submitting()) {
          <mat-spinner class="!mr-pb-2 !inline-block" [diameter]="18" aria-hidden="true" />
          <span>Signing in…</span>
        } @else {
          <span>Sign in</span>
        }
      </button>
    </form>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);

  /**
   * Login deliberately validates only presence, not password strength. Applying
   * the strength rules here would reject a valid existing password that predates
   * a policy change, and tell an attacker what the policy is.
   */
  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  protected readonly submitting = signal(false);
  protected readonly passwordVisible = signal(false);
  /** Form-level message, e.g. "email or password is incorrect". */
  protected readonly formError = signal<string | null>(null);

  /**
   * Read as functions in the template rather than precomputed signals: control
   * validity is not signal-based, so a `computed` would not re-evaluate when the
   * control's touched state changes.
   */
  protected emailError(): string | null {
    return firstErrorMessage(this.form.controls.email, 'Email');
  }

  protected passwordError(): string | null {
    return firstErrorMessage(this.form.controls.password, 'Password');
  }

  protected togglePasswordVisibility(): void {
    this.passwordVisible.update((visible) => !visible);
  }

  protected submit(): void {
    this.formError.set(null);

    if (this.form.invalid) {
      // Without this, a user who clicks submit without touching a field sees
      // nothing happen — pristine controls hide their errors.
      this.form.markAllAsTouched();
      return;
    }

    // Guards against a double submit creating two sessions.
    if (this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.form.disable();

    const { email, password } = this.form.getRawValue();

    this.auth.login({ email, password }).subscribe({
      next: () => {
        void this.router.navigateByUrl(this.resolveReturnUrl());
      },
      error: (error: AppError) => {
        this.submitting.set(false);
        this.form.enable();

        // Field-level messages from the server land under the right input;
        // anything unmatched becomes the form-level message.
        const unmatched = applyServerErrors(this.form, error);
        this.formError.set(unmatched[0] ?? error.message);

        // Clear only the password. Making the user retype their email after a
        // typo in the password is a pointless annoyance.
        this.form.controls.password.reset();
      },
    });
  }

  /**
   * Returns the user to where they were headed before the guard intercepted them.
   *
   * The value is validated as a same-origin relative path: `returnUrl` comes from
   * the query string, so accepting it blindly would make this an open redirect —
   * `?returnUrl=https://evil.example` would send a freshly-authenticated user off
   * site.
   */
  private resolveReturnUrl(): string {
    // `queryParams` is loosely typed, and this value is user-controlled, so
    // narrow it rather than trusting it.
    const requested: unknown = this.router.parseUrl(this.router.url).queryParams['returnUrl'];

    if (typeof requested !== 'string' || requested.length === 0) {
      return AppRoutes.dashboard;
    }

    // Must be a bare path: rejects "//host", "https://…" and "\\host".
    const isSafeRelativePath = requested.startsWith('/') && !/^\/[/\\]/.test(requested);

    return isSafeRelativePath ? requested : AppRoutes.dashboard;
  }
}
