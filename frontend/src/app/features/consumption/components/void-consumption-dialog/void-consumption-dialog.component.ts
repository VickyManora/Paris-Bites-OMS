import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { DialogShellComponent } from '../../../../shared/components/dialog-shell/dialog-shell.component';
import { SubmitButtonComponent } from '../../../../shared/components/submit-button/submit-button.component';
import { MATERIAL_FORM_IMPORTS } from '../../../../shared/material/material-imports';
import { firstErrorMessage } from '../../../../shared/utils/form.utils';

export interface VoidConsumptionDialogData {
  readonly entryDate: string;
  readonly lineCount: number;
}

/**
 * Prompts for a void reason.
 *
 * A dedicated dialog rather than the generic confirm, because the reason is **required** —
 * by the validator, the use case, and a database CHECK. Voiding returns a whole day's
 * stock, and an unexplained increase in the item history is exactly what an inventory
 * audit exists to catch.
 *
 * Resolves to the reason, or `undefined` if cancelled.
 */
@Component({
  selector: 'pb-void-consumption-dialog',
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
      [title]="'Void the sheet for ' + data.entryDate + '?'"
      icon="undo"
      tone="danger"
    >
      <p class="m-0 mb-pb-3 text-pb-body text-on-surface">
        All {{ data.lineCount }} {{ data.lineCount === 1 ? 'item' : 'items' }} have their stock
        returned. The entry stays visible, marked voided, so the increase is explicable.
      </p>

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
          <mat-hint>Kept on the record beside the reversal</mat-hint>
        </mat-form-field>
      </form>

      <button slot="actions" matButton type="button" (click)="dialogRef.close()">
        Keep the sheet
      </button>
      <pb-submit-button
        slot="actions"
        label="Void sheet"
        busyLabel="Voiding…"
        icon="undo"
        [minWidth]="150"
        (pressed)="submit()"
      />
    </pb-dialog-shell>
  `,
})
export class VoidConsumptionDialogComponent {
  readonly dialogRef =
    inject<MatDialogRef<VoidConsumptionDialogComponent, string | undefined>>(MatDialogRef);
  protected readonly data = inject<VoidConsumptionDialogData>(MAT_DIALOG_DATA);
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
