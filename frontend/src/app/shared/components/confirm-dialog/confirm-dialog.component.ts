import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MATERIAL_CORE_IMPORTS } from '../../material/material-imports';
import type { ConfirmDialogData } from '../../models/dialog-data.model';

/**
 * Confirmation dialog, so destructive actions never rely on `window.confirm`
 * (unstyled, blocking, and unusable on some mobile browsers).
 *
 * Open it through `ConfirmDialogService`, which owns the a11y and focus config —
 * this component is only the content.
 */
@Component({
  selector: 'pb-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, ...MATERIAL_CORE_IMPORTS],
  template: `
    <h2 mat-dialog-title class="flex items-center gap-2">
      @if (data.icon || isDanger()) {
        <mat-icon [class.text-error]="isDanger()" aria-hidden="true">
          {{ data.icon ?? 'warning' }}
        </mat-icon>
      }
      <span>{{ data.title }}</span>
    </h2>

    <mat-dialog-content>
      <p class="text-pb-body">{{ data.message }}</p>

      @if (data.detail) {
        <p
          class="text-pb-caption mt-3 rounded-lg border border-outline-variant bg-surface-container px-3 py-2 text-on-surface-variant"
        >
          {{ data.detail }}
        </p>
      }
    </mat-dialog-content>

    <!-- Stacked full-width on the narrowest screens, so the buttons stay
         comfortably tappable instead of squeezing side by side. -->
    <mat-dialog-actions class="!flex-col-reverse !items-stretch gap-2 sm:!flex-row sm:!justify-end">
      <button
        matButton
        type="button"
        [attr.cdkFocusInitial]="isDanger() ? '' : null"
        (click)="dialogRef.close(false)"
      >
        {{ data.cancelLabel ?? 'Cancel' }}
      </button>

      <button
        matButton="filled"
        type="button"
        [class.pb-button-danger]="isDanger()"
        [attr.cdkFocusInitial]="isDanger() ? null : ''"
        (click)="dialogRef.close(true)"
      >
        {{ data.confirmLabel ?? 'Confirm' }}
      </button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDialogComponent {
  readonly dialogRef = inject<MatDialogRef<ConfirmDialogComponent, boolean>>(MatDialogRef);
  readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);

  protected readonly isDanger = computed(() => this.data.variant === 'danger');
}
