import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import type { AppError } from '../../../../core/errors/app-error';
import { DialogShellComponent } from '../../../../shared/components/dialog-shell/dialog-shell.component';
import { InlineAlertComponent } from '../../../../shared/components/inline-alert/inline-alert.component';
import { SubmitButtonComponent } from '../../../../shared/components/submit-button/submit-button.component';
import { MATERIAL_FORM_IMPORTS } from '../../../../shared/material/material-imports';
import { applyServerErrors, firstErrorMessage } from '../../../../shared/utils/form.utils';
import { isDiscreteUnit, type InventoryItem } from '../../models/inventory.model';
import { InventoryService } from '../../services/inventory.service';

export interface AdjustQuantityDialogData {
  readonly item: InventoryItem;
}

type AdjustMode = 'add' | 'remove' | 'set';

/**
 * Stock adjustment dialog.
 *
 * Three modes, because "add 5" and "there are 5" are different statements and conflating
 * them is how stock levels silently go wrong:
 *
 * - **add** / **remove** send a signed `delta`, applied relative to whatever the current
 *   quantity is when the server processes it. Safe when two people adjust at once.
 * - **set** sends an absolute `quantity` — a stocktake correction.
 *
 * The projected result is shown live so the user sees the outcome before committing,
 * which is the cheapest way to catch a wrong mode or a mistyped figure.
 */
@Component({
  selector: 'pb-adjust-quantity-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonToggleModule,
    DialogShellComponent,
    InlineAlertComponent,
    SubmitButtonComponent,
    ...MATERIAL_FORM_IMPORTS,
  ],
  template: `
    <pb-dialog-shell
      title="Adjust quantity"
      [subtitle]="item.name + ' · ' + item.locationLabel"
      icon="tune"
    >
      @if (formError(); as message) {
        <pb-inline-alert slot="error" [message]="message" />
      }

      <form [formGroup]="form" class="pb-form flex flex-col gap-pb-3" novalidate>
        <!--
          Where the item stands now, stated before the control that changes it.

          It was previously above the dialog's own form as two loose paragraphs; as a bordered readout
          it reads as the starting value the projection below is relative to, which is the only reason
          it is on screen.
        -->
        <div
          class="flex items-baseline justify-between gap-pb-3 rounded-pb-lg border border-outline-variant bg-surface-container px-pb-3 py-pb-2"
        >
          <span class="text-pb-caption text-on-surface-variant">In stock now</span>
          <span class="text-pb-subtitle tabular-nums text-on-surface">
            {{ item.displayQuantity }}
          </span>
        </div>

        <!-- Full width and stacked-friendly, so the three options stay tappable. -->
        <mat-button-toggle-group
          formControlName="mode"
          class="!w-full"
          aria-label="Adjustment type"
        >
          <mat-button-toggle value="add" class="!flex-1">
            <mat-icon>add</mat-icon>
            Add
          </mat-button-toggle>
          <mat-button-toggle value="remove" class="!flex-1">
            <mat-icon>remove</mat-icon>
            Remove
          </mat-button-toggle>
          <mat-button-toggle value="set" class="!flex-1">
            <mat-icon>edit</mat-icon>
            Set
          </mat-button-toggle>
        </mat-button-toggle-group>

        <mat-form-field subscriptSizing="dynamic">
          <mat-label>{{ mode() === 'set' ? 'Exact quantity' : 'Amount' }}</mat-label>
          <input
            matInput
            type="number"
            inputmode="decimal"
            formControlName="amount"
            [step]="step()"
            min="0"
            required
          />
          <span matTextSuffix>{{ item.unitAbbreviation }}</span>
          @if (error('amount', 'Amount'); as message) {
            <mat-error>{{ message }}</mat-error>
          }
          <mat-hint>
            Minimum for this item is {{ item.minimumQuantity }} {{ item.unitAbbreviation }}
          </mat-hint>
        </mat-form-field>

        <!--
          Live projection. Catches a wrong mode before it is committed.

          The two failure states use the design system's tones rather than Material's error role, which on
          this rose palette is a red close enough to the brand that 'below minimum' read as emphasis.
        -->
        @if (projection(); as result) {
          @if (result.invalid) {
            <pb-inline-alert
              tone="danger"
              title="More than there is"
              [message]="
                'Cannot remove more than the ' + item.displayQuantity + ' currently in stock.'
              "
            />
          } @else if (result.wouldBeLow) {
            <pb-inline-alert
              tone="warning"
              [message]="
                'This leaves ' +
                result.next +
                ' ' +
                item.unitAbbreviation +
                ', below the minimum of ' +
                item.minimumQuantity +
                '. You can still apply it.'
              "
            />
          } @else {
            <div
              class="flex items-baseline justify-between gap-pb-3 rounded-pb-lg border p-pb-3 pb-tone-success"
              aria-live="polite"
            >
              <span class="text-pb-caption">After this adjustment</span>
              <span class="text-pb-subtitle tabular-nums">
                {{ result.next }} {{ item.unitAbbreviation }}
              </span>
            </div>
          }
        }

        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Reason</mat-label>
          <input matInput formControlName="note" maxlength="500" autocomplete="off" />
          <mat-hint>Optional, and recorded in the item's history</mat-hint>
        </mat-form-field>
      </form>

      <button
        slot="actions"
        matButton
        type="button"
        [disabled]="saving()"
        (click)="dialogRef.close()"
      >
        Cancel
      </button>
      <pb-submit-button
        slot="actions"
        label="Apply"
        busyLabel="Applying…"
        icon="check"
        [busy]="saving()"
        [disabled]="projection()?.invalid === true"
        (pressed)="save()"
      />
    </pb-dialog-shell>
  `,
})
export class AdjustQuantityDialogComponent {
  readonly dialogRef =
    inject<MatDialogRef<AdjustQuantityDialogComponent, InventoryItem | undefined>>(MatDialogRef);
  private readonly data = inject<AdjustQuantityDialogData>(MAT_DIALOG_DATA);
  private readonly service = inject(InventoryService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly item = this.data.item;

  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    mode: ['add' as AdjustMode, [Validators.required]],
    // No `min(0.001)`: zero is caught by the projection so the message can explain why.
    amount: [0, [Validators.required, Validators.min(0)]],
    note: [''],
  });

  protected readonly mode = toSignal(this.form.controls.mode.valueChanges, {
    initialValue: this.form.controls.mode.value,
  });

  private readonly amount = toSignal(this.form.controls.amount.valueChanges, {
    initialValue: this.form.controls.amount.value,
  });

  protected readonly step = computed(() => (isDiscreteUnit(this.item.unit) ? '1' : '0.001'));

  /**
   * The resulting quantity, or null when there is nothing to project yet.
   *
   * Mirrors the server's arithmetic, including rounding to three decimal places, so the
   * projection matches what actually gets stored.
   */
  protected readonly projection = computed<{
    next: number;
    invalid: boolean;
    wouldBeLow: boolean;
  } | null>(() => {
    const amount = Number(this.amount());

    if (!Number.isFinite(amount) || amount === 0) {
      return null;
    }

    const current = this.item.currentQuantity;
    const raw =
      this.mode() === 'add'
        ? current + amount
        : this.mode() === 'remove'
          ? current - amount
          : amount;

    const next = Math.round(raw * 1000) / 1000;

    return {
      next: Math.max(next, 0),
      invalid: next < 0,
      // Same rule as the server: a zero minimum means the threshold is not tracked.
      wouldBeLow: this.item.minimumQuantity > 0 && next <= this.item.minimumQuantity && next >= 0,
    };
  });

  protected error(control: 'amount', label: string): string | null {
    return firstErrorMessage(this.form.controls[control], label);
  }

  protected save(): void {
    this.formError.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const projection = this.projection();

    if (projection === null) {
      this.formError.set('Enter an amount greater than zero.');
      return;
    }

    if (projection.invalid) {
      this.formError.set(`Cannot remove more than the ${this.item.displayQuantity} in stock.`);
      return;
    }

    if (this.saving()) {
      return;
    }

    const { mode, amount, note } = this.form.getRawValue();
    const trimmedNote = note.trim();

    this.saving.set(true);
    this.form.disable();

    this.service
      .adjustQuantity(this.item.id, {
        // Exactly one of the two — the API rejects both together.
        ...(mode === 'set' ? { quantity: amount } : { delta: mode === 'add' ? amount : -amount }),
        ...(trimmedNote.length > 0 && { note: trimmedNote }),
      })
      .subscribe({
        next: (updated) => this.dialogRef.close(updated),
        error: (error: AppError) => {
          this.saving.set(false);
          this.form.enable();

          const unmatched = applyServerErrors(this.form, error);
          this.formError.set(unmatched[0] ?? error.message);
        },
      });
  }
}
