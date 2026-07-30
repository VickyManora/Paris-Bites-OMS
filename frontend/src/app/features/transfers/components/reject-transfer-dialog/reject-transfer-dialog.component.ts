import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { DialogShellComponent } from '../../../../shared/components/dialog-shell/dialog-shell.component';
import { SubmitButtonComponent } from '../../../../shared/components/submit-button/submit-button.component';
import { MATERIAL_FORM_IMPORTS } from '../../../../shared/material/material-imports';
import { firstErrorMessage } from '../../../../shared/utils/form.utils';

export interface RejectTransferDialogData {
  readonly reference: string;
}

/**
 * Prompts for a rejection reason.
 *
 * A dedicated dialog rather than the generic confirm, because the reason is **required** —
 * by the validator, the use case, and a database CHECK. A refusal the requester cannot act on
 * just produces a second identical request.
 *
 * Resolves to the reason, or `undefined` if cancelled.
 */
@Component({
  selector: 'pb-reject-transfer-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    DialogShellComponent,
    SubmitButtonComponent,
    ...MATERIAL_FORM_IMPORTS,
  ],
  template: `
    <pb-dialog-shell
      [title]="'Reject ' + data.reference + '?'"
      subtitle="No stock will move. The requester will see your reason."
      icon="block"
      tone="danger"
    >
      <form [formGroup]="form" class="pb-form" novalidate>
        <mat-form-field class="w-full" subscriptSizing="dynamic">
          <mat-label>Reason</mat-label>
          <textarea
            matInput
            formControlName="reason"
            rows="3"
            maxlength="500"
            required
            cdkFocusInitial
          ></textarea>
          @if (error(); as message) {
            <mat-error>{{ message }}</mat-error>
          }
          <mat-hint>Say what was wrong, so the requester can fix it and ask again</mat-hint>
        </mat-form-field>
      </form>

      <button slot="actions" matButton type="button" (click)="dialogRef.close()">
        Keep pending
      </button>
      <pb-submit-button
        slot="actions"
        label="Reject transfer"
        busyLabel="Rejecting…"
        icon="block"
        [minWidth]="160"
        (pressed)="submit()"
      />
    </pb-dialog-shell>
  `,
})
export class RejectTransferDialogComponent {
  readonly dialogRef =
    inject<MatDialogRef<RejectTransferDialogComponent, string | undefined>>(MatDialogRef);
  protected readonly data = inject<RejectTransferDialogData>(MAT_DIALOG_DATA);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly form = this.formBuilder.nonNullable.group({
    // Matches the API's minimum, so a too-short reason is caught before the round trip.
    reason: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(500)]],
  });

  protected error(): string | null {
    return firstErrorMessage(this.form.controls.reason, 'Reason');
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.dialogRef.close(this.form.controls.reason.value.trim());
  }
}
