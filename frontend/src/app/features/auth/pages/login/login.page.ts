import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../../core/auth/services/auth.service';
import { AppRoutes } from '../../../../core/constants/app.constants';
import type { AppError } from '../../../../core/errors/app-error';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { InlineAlertComponent } from '../../../../shared/components/inline-alert/inline-alert.component';
import { MATERIAL_FORM_IMPORTS } from '../../../../shared/material/material-imports';
import { applyServerErrors, firstErrorMessage } from '../../../../shared/utils/form.utils';
import { environment } from '../../../../../environments/environment';

/**
 * Whether a bare account name may be typed instead of an address.
 *
 * Development builds only, matching the API's `DEV_LOGIN_DOMAIN`: the server is what expands
 * `admin` to `admin@parisbites.local`, and it refuses to do so in production. Relaxing the form
 * without that expansion would only replace an inline "must be a valid email" with a round trip
 * that comes back "incorrect email or password" — a worse version of the same rejection.
 */
const ALLOWS_BARE_USERNAME = !environment.production;

/** Bare names are restricted to what can appear in the local part of the address it becomes. */
const BARE_USERNAME = /^[a-z0-9._-]+$/i;

/**
 * Accepts an e-mail address, plus a bare account name in development.
 *
 * Emptiness is deliberately not reported here — `Validators.required` already owns that, and
 * returning both makes `firstErrorMessage` pick between two messages describing one problem.
 */
function loginIdentifier(control: AbstractControl): ValidationErrors | null {
  const value = typeof control.value === 'string' ? control.value.trim() : '';

  if (value.length === 0) {
    return null;
  }

  if (ALLOWS_BARE_USERNAME && !value.includes('@') && BARE_USERNAME.test(value)) {
    return null;
  }

  return Validators.email(control);
}

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
        <h2 class="pb-auth-heading m-0 text-[1.625rem] leading-tight">Sign in</h2>
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
        <mat-label>{{ allowsBareUsername ? 'Email or username' : 'Email' }}</mat-label>
        <!-- 'attr.inputmode' because inputmode is an attribute, not a DOM property — a plain
             '[inputmode]' binding fails the template compiler with NG8002. Backticks are
             avoided in here on purpose: this comment sits inside a template literal. -->
        <input
          matInput
          [type]="allowsBareUsername ? 'text' : 'email'"
          formControlName="email"
          autocomplete="username"
          [attr.inputmode]="allowsBareUsername ? 'text' : 'email'"
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
        The one control on this form that is not about who you are.

        Ticking it makes this device the till: signed in for six months, scoped by the API to taking
        orders and nothing else. It exists because of what the counter's morning looks like — the
        API sleeps after fifteen idle minutes and takes about a minute to wake, and a login form is
        the worst possible thing to put between a cashier and a customer holding money.

        The caption spells out the trade rather than hiding it. Somebody ticking this on their own
        laptop should understand they are choosing a device that can only ring up orders, and
        somebody ticking it on the shop phone should understand that is exactly the point: if that
        phone is lost, what is lost with it is the ability to sell a waffle.
      -->
      <div class="mt-pb-1">
        <mat-checkbox formControlName="tillDevice" class="!items-start">
          <span class="block text-pb-body">Sign this device in as the till</span>
          <span class="block text-pb-caption text-on-surface-variant">
            Stays signed in for six months and can only take orders — no takings, no stock, no
            cancellations.
          </span>
        </mat-checkbox>
      </div>

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
    email: ['', [Validators.required, loginIdentifier]],
    password: ['', [Validators.required]],
    /**
     * Whether this device becomes the till.
     *
     * A till session lasts six months and is scoped to taking orders — see `SessionScope` on the
     * API. It is the answer to the counter's real problem: the shop's API sleeps after fifteen idle
     * minutes and takes about a minute to wake, so a login form is the worst thing that can stand
     * between a cashier and a customer. Signing in once, permanently, removes it.
     */
    tillDevice: [false],
  });

  protected readonly submitting = signal(false);
  /** Drives the field's label and type. See `ALLOWS_BARE_USERNAME`. */
  protected readonly allowsBareUsername = ALLOWS_BARE_USERNAME;

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

    const { email, password, tillDevice } = this.form.getRawValue();

    this.auth
      .login({
        email,
        password,
        ...(tillDevice ? { tillDevice: true, deviceName: 'Counter till' } : {}),
      })
      .subscribe({
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
    /*
     * A till lands on the counter, whatever it was headed for.
     *
     * The session is scoped to taking orders, so the dashboard it would otherwise open — the app's
     * default — is a page of cards that would all 403. Sending it to the order screen is not a
     * convenience; it is the only screen this session can actually use.
     */
    if (this.form.getRawValue().tillDevice) {
      return AppRoutes.posNewOrder;
    }

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
