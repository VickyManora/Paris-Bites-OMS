import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../../core/auth/services/auth.service';
import { AppRoutes } from '../../../../core/constants/app.constants';
import type { AppError } from '../../../../core/errors/app-error';
import { NotificationService } from '../../../../core/services/notification.service';
import { InlineAlertComponent } from '../../../../shared/components/inline-alert/inline-alert.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MATERIAL_FORM_IMPORTS } from '../../../../shared/material/material-imports';
import { applyServerErrors, firstErrorMessage } from '../../../../shared/utils/form.utils';
import { matchFields, passwordStrength } from '../../../../shared/validators/form-validators';
import { SubmitButtonComponent } from '../../../../shared/components/submit-button/submit-button.component';

/** One password-policy rule, shown live as the user types. */
interface PasswordRule {
  readonly label: string;
  readonly test: (value: string) => boolean;
}

const PASSWORD_RULES: readonly PasswordRule[] = [
  { label: 'At least 10 characters', test: (value) => value.length >= 10 },
  { label: 'A lowercase letter', test: (value) => /[a-z]/.test(value) },
  { label: 'An uppercase letter', test: (value) => /[A-Z]/.test(value) },
  { label: 'A number', test: (value) => /\d/.test(value) },
];

/**
 * Change-password page.
 *
 * The requirements are shown as a live checklist rather than only as an error
 * after submitting. A user should be able to satisfy a password policy while
 * typing, not by trial and error.
 */
@Component({
  selector: 'pb-change-password-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SubmitButtonComponent,
    ReactiveFormsModule,
    InlineAlertComponent,
    PageHeaderComponent,
    MatProgressSpinnerModule,
    ...MATERIAL_FORM_IMPORTS,
  ],
  template: `
    <div class="flex flex-col gap-6">
      <pb-page-header
        title="Change password"
        subtitle="You will be signed out of all devices after changing your password."
      />

      <div class="pb-surface max-w-xl p-pb-4 sm:p-pb-5">
        <form
          [formGroup]="form"
          (ngSubmit)="submit()"
          class="pb-form flex flex-col gap-pb-3"
          novalidate
        >
          @if (formError(); as message) {
            <pb-inline-alert [message]="message" />
          }

          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Current password</mat-label>
            <input
              matInput
              type="password"
              formControlName="currentPassword"
              autocomplete="current-password"
              required
            />
            @if (currentPasswordError(); as message) {
              <mat-error>{{ message }}</mat-error>
            }
          </mat-form-field>

          <mat-form-field subscriptSizing="dynamic">
            <mat-label>New password</mat-label>
            <input
              matInput
              [type]="newPasswordVisible() ? 'text' : 'password'"
              formControlName="newPassword"
              autocomplete="new-password"
              required
            />
            <button
              matIconButton
              matSuffix
              type="button"
              [attr.aria-label]="newPasswordVisible() ? 'Hide password' : 'Show password'"
              (click)="toggleNewPasswordVisibility()"
            >
              <mat-icon>{{ newPasswordVisible() ? 'visibility_off' : 'visibility' }}</mat-icon>
            </button>
            @if (newPasswordError(); as message) {
              <mat-error>{{ message }}</mat-error>
            }
          </mat-form-field>

          <!-- Live checklist. aria-live is polite so a screen reader announces
                 progress without interrupting typing. -->
          <!--
              Live checklist. 'aria-live' is polite so a screen reader announces progress without
              interrupting typing.

              Framed as inline help rather than as a loose list: it is the requirements for the field
              above it, and a bordered block says so. The tick uses the design system's success tone —
              Tailwind's 'text-green-600' was the one hardcoded colour left in these forms, and it does
              not follow the theme.
            -->
          <div class="rounded-pb-lg border border-outline-variant bg-surface-container p-pb-3">
            <p class="m-0 mb-pb-2 text-pb-caption text-on-surface-variant">A new password needs:</p>
            <ul class="m-0 flex list-none flex-col gap-1.5 p-0" aria-live="polite">
              @for (rule of ruleStates(); track rule.label) {
                <li class="flex items-center gap-pb-2 text-pb-caption">
                  <mat-icon
                    class="!h-4 !w-4 !text-[16px]"
                    [class.text-pb-success-fg]="rule.satisfied"
                    [class.text-on-surface-variant]="!rule.satisfied"
                    aria-hidden="true"
                  >
                    {{ rule.satisfied ? 'check_circle' : 'radio_button_unchecked' }}
                  </mat-icon>
                  <span [class.text-on-surface-variant]="!rule.satisfied">{{ rule.label }}</span>
                  <span class="sr-only">{{ rule.satisfied ? '— met' : '— not met yet' }}</span>
                </li>
              }
            </ul>
          </div>

          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Confirm new password</mat-label>
            <input
              matInput
              type="password"
              formControlName="confirmPassword"
              autocomplete="new-password"
              required
            />
            @if (confirmPasswordError(); as message) {
              <mat-error>{{ message }}</mat-error>
            }
          </mat-form-field>

          <!--
              A footer, divided from the fields.

              Not sticky: the whole form is about 520px tall and never scrolls on any supported
              viewport, so pinning the buttons would reserve height against a scroll that cannot
              happen. Sticky footers earn their place on the purchase form, which does scroll.
            -->
          <div
            class="mt-pb-2 flex flex-col-reverse gap-pb-2 border-t border-outline-variant pt-pb-3 sm:flex-row sm:justify-end"
          >
            <button matButton type="button" [disabled]="submitting()" (click)="cancel()">
              Cancel
            </button>
            <!--
              The shared submit button, which the other nine forms already use.

              This one was hand-rolled, and it carried a real defect the compiler had been reporting:
              with two root nodes in each branch, Angular cannot project the mat-icon into
              MatButton's icon slot, so the icon rendered as ordinary content without the slot's
              spacing. pb-submit-button solves that with one static matButton attribute per
              variant, and owns the busy label and minimum width too.
            -->
            <pb-submit-button
              label="Change password"
              icon="lock_reset"
              [busy]="submitting()"
              [minWidth]="170"
            />
          </div>
        </form>
      </div>
    </div>
  `,
})
export class ChangePasswordPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly form = this.formBuilder.nonNullable.group(
    {
      currentPassword: ['', [Validators.required]],
      newPassword: ['', [Validators.required, passwordStrength()]],
      confirmPassword: ['', [Validators.required]],
    },
    // Cross-field check lives on the group, because only the group sees both.
    { validators: [matchFields('newPassword', 'confirmPassword')] },
  );

  protected readonly submitting = signal(false);
  protected readonly newPasswordVisible = signal(false);
  protected readonly formError = signal<string | null>(null);

  /**
   * The control's value as a signal.
   *
   * `toSignal` is the bridge from Reactive Forms' observable API into signals, and
   * it unsubscribes when the component is destroyed — no manual teardown to
   * forget.
   */
  private readonly newPasswordValue = toSignal(this.form.controls.newPassword.valueChanges, {
    initialValue: '',
  });

  protected readonly ruleStates = computed(() => {
    const value = this.newPasswordValue();
    return PASSWORD_RULES.map((rule) => ({ label: rule.label, satisfied: rule.test(value) }));
  });

  protected currentPasswordError(): string | null {
    return firstErrorMessage(this.form.controls.currentPassword, 'Current password');
  }

  protected newPasswordError(): string | null {
    return firstErrorMessage(this.form.controls.newPassword, 'New password');
  }

  protected confirmPasswordError(): string | null {
    return firstErrorMessage(this.form.controls.confirmPassword, 'Confirmation');
  }

  protected toggleNewPasswordVisibility(): void {
    this.newPasswordVisible.update((visible) => !visible);
  }

  protected cancel(): void {
    void this.router.navigate([AppRoutes.dashboard]);
  }

  protected submit(): void {
    this.formError.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    if (this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.form.disable();

    const { currentPassword, newPassword } = this.form.getRawValue();

    this.auth.changePassword({ currentPassword, newPassword }).subscribe({
      next: () => {
        /*
         * The server revoked every session, so there is nothing to return to —
         * `AuthService.changePassword` has already cleared local state. Send the
         * user to sign in with the new password and say why.
         */
        this.notifications.success('Password changed. Please sign in again.');
        void this.router.navigate([AppRoutes.login]);
      },
      error: (error: AppError) => {
        this.submitting.set(false);
        this.form.enable();

        const unmatched = applyServerErrors(this.form, error);
        this.formError.set(unmatched[0] ?? error.message);
      },
    });
  }
}
