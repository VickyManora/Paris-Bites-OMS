import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import type { AppError } from '../../../../core/errors/app-error';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import { DialogShellComponent } from '../../../../shared/components/dialog-shell/dialog-shell.component';
import { SubmitButtonComponent } from '../../../../shared/components/submit-button/submit-button.component';
import { InlineAlertComponent } from '../../../../shared/components/inline-alert/inline-alert.component';
import { MATERIAL_FORM_IMPORTS } from '../../../../shared/material/material-imports';
import { applyServerErrors, markAllAsTouched } from '../../../../shared/utils/form.utils';
import {
  SALES_BUCKETS,
  toDateInput,
  type DailySalesAmount,
  type DailySalesEntry,
} from '../../models/daily-sales.model';
import { DailySalesService } from '../../services/daily-sales.service';

/** `entry` present means correct an existing day; absent means record a new one. */
export interface DailySalesFormDialogData {
  readonly entry?: DailySalesEntry;
}

/**
 * Record or correct one day's takings.
 *
 * Four figures and a date. That is the whole model — see the schema comment on
 * `DailySalesEntry` for why this is a daily total rather than a record of each sale.
 *
 * Three things this form does that a plain set of inputs would not:
 *
 * **It checks the date as you pick it.** Choosing a day that has already been entered
 * switches the dialog into correcting that day, pre-filled, rather than letting the user
 * fill in four figures and meet a conflict on submit. Re-keying a day's takings because
 * the form did not mention it already existed is the most annoying possible failure here.
 *
 * **It totals live.** The figure the user is reconciling against is the total, so it is
 * on screen while they type rather than after they submit.
 *
 * **A correction requires a reason.** Revenue is what the business is judged on, and a
 * figure that changed with no explanation attached is worse than one never corrected.
 */
@Component({
  selector: 'pb-daily-sales-form-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    SpinnerComponent,
    DialogShellComponent,
    InlineAlertComponent,
    SubmitButtonComponent,
    ...MATERIAL_FORM_IMPORTS,
  ],
  template: `
    <pb-dialog-shell
      [title]="dialogTitle()"
      subtitle="One entry per trading day"
      icon="sales"
    >
      @if (formError(); as message) {
        <pb-inline-alert slot="error" [message]="message" />
      }

      <form [formGroup]="form" class="pb-form flex flex-col gap-pb-3">
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Date</mat-label>
          <input
            matInput
            type="date"
            formControlName="entryDate"
            [max]="today"
            (change)="onDateChanged()"
          />
          @if (form.controls.entryDate.hasError('required')) {
            <mat-error>Pick the trading day.</mat-error>
          }
          <mat-hint>The day the money was taken, not the day you are entering it.</mat-hint>
        </mat-form-field>

        @if (checkingDate()) {
          <div class="flex items-center gap-pb-2">
            <pb-spinner diameter="18" label="Checking the day" />
            <span class="text-pb-caption text-on-surface-variant">Checking that day…</span>
          </div>
        }

        <!--
          Switched to correcting, rather than refusing on submit. Said plainly, because
          the dialog's meaning has just changed under the user.
        -->
        @if (switchedToEdit()) {
          <pb-inline-alert
            tone="info"
            title="That day was already recorded"
            message="The figures below are what is stored. Change them to correct the day."
          />
        }

        <div class="grid grid-cols-1 gap-pb-3 sm:grid-cols-2" formGroupName="amounts">
          @for (bucket of buckets; track bucket.key) {
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>{{ bucket.label }}</mat-label>
              <span matTextPrefix class="pr-1">₹</span>
              <input
                matInput
                type="number"
                min="0"
                step="0.01"
                inputmode="decimal"
                [formControlName]="bucket.key"
              />
              <mat-icon matSuffix>{{ bucket.icon }}</mat-icon>
              <mat-hint>{{ bucket.hint }}</mat-hint>
            </mat-form-field>
          }
        </div>

        <!-- The number being reconciled, kept visible while typing. -->
        <div
          class="flex items-baseline justify-between gap-pb-3 rounded-pb-lg border border-outline-variant bg-surface-container px-pb-4 py-pb-3"
          aria-live="polite"
        >
          <span class="text-pb-subtitle text-on-surface">Day total</span>
          <span class="text-[1.75rem] font-semibold leading-none text-on-surface">
            {{ formattedTotal() }}
          </span>
        </div>

        @if (total() <= 0) {
          <p class="m-0 text-pb-caption text-on-surface-variant">
            Enter at least one figure. A day with no trade does not need an entry.
          </p>
        }

        @if (isEditing()) {
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Why is it changing?</mat-label>
            <input matInput formControlName="reason" maxlength="300" />
            @if (
              form.controls.reason.hasError('required') ||
              form.controls.reason.hasError('minlength')
            ) {
              <mat-error>Say why the figure changed — it goes on the record.</mat-error>
            }
            @if (form.controls.reason.hasError('server')) {
              <mat-error>{{ form.controls.reason.getError('server') }}</mat-error>
            }
            <mat-hint>e.g. "Card machine total misread" or "Zomato payout reconciled"</mat-hint>
          </mat-form-field>
        }

        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Notes (optional)</mat-label>
          <textarea matInput formControlName="notes" rows="2" maxlength="500"></textarea>
        </mat-form-field>
      </form>

      <button slot="actions" matButton type="button" [disabled]="saving()" (click)="close()">
        Cancel
      </button>
      <pb-submit-button
        slot="actions"
        [label]="isEditing() ? 'Save correction' : 'Record day'"
        icon="check"
        [busy]="saving()"
        [disabled]="checkingDate() || total() <= 0"
        [minWidth]="170"
        (pressed)="submit()"
      />
    </pb-dialog-shell>
  `,
})
export class DailySalesFormDialogComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly service = inject(DailySalesService);
  private readonly dialogRef = inject(MatDialogRef<DailySalesFormDialogComponent, DailySalesEntry>);
  private readonly data = inject<DailySalesFormDialogData>(MAT_DIALOG_DATA);

  protected readonly buckets = SALES_BUCKETS;
  protected readonly today = toDateInput(new Date());

  /** The entry being corrected. Set on open for an edit, or discovered by date lookup. */
  private readonly editing = signal<DailySalesEntry | null>(this.data.entry ?? null);

  protected readonly saving = signal(false);
  protected readonly checkingDate = signal(false);
  protected readonly switchedToEdit = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly isEditing = computed(() => this.editing() !== null);

  /**
   * The dialog's title, built here rather than inline in the template.
   *
   * One of the two labels contains an apostrophe, so an inline conditional would need a double-quoted
   * string inside a double-quoted attribute — which is not expressible. A computed sidesteps the
   * quoting entirely.
   */
  protected readonly dialogTitle = computed(() =>
    this.isEditing() ? 'Correct the day' : "Record the day's sales",
  );

  protected readonly form = this.formBuilder.nonNullable.group({
    entryDate: [this.data.entry?.entryDate ?? this.today, [Validators.required]],
    amounts: this.formBuilder.nonNullable.group(
      Object.fromEntries(
        SALES_BUCKETS.map((bucket) => [
          bucket.key,
          [this.data.entry?.amounts[bucket.key] ?? 0, [Validators.min(0)]],
        ]),
      ),
    ),
    reason: [''],
    notes: [this.data.entry?.notes ?? ''],
  });

  /** Recomputed from the raw form value, so it follows every keystroke. */
  protected readonly total = signal(this.sumAmounts());

  protected readonly formattedTotal = computed(
    () =>
      `₹${this.total().toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
  );

  constructor() {
    if (this.data.entry !== undefined) {
      this.requireReason();
      // The date of an existing day is not up for editing: changing it would silently
      // move a day's takings, and "this is the wrong date" is a delete-and-re-enter.
      this.form.controls.entryDate.disable();
    }

    this.form.controls.amounts.valueChanges.subscribe(() => this.total.set(this.sumAmounts()));
  }

  /**
   * Looks up the chosen day.
   *
   * Runs on change rather than on submit, so the dialog can pre-fill and switch to
   * correcting instead of rejecting four figures the user has already typed.
   */
  protected onDateChanged(): void {
    if (this.data.entry !== undefined) {
      return;
    }

    const date = this.form.controls.entryDate.value;

    if (date.length === 0) {
      return;
    }

    this.checkingDate.set(true);
    this.formError.set(null);

    this.service.getByDate(date).subscribe({
      next: (existing) => {
        this.checkingDate.set(false);
        this.editing.set(existing);
        this.switchedToEdit.set(existing !== null);

        if (existing === null) {
          this.form.controls.reason.clearValidators();
          this.form.controls.reason.updateValueAndValidity();
          return;
        }

        this.form.controls.amounts.patchValue(
          Object.fromEntries(SALES_BUCKETS.map((b) => [b.key, existing.amounts[b.key] ?? 0])),
        );
        this.form.controls.notes.setValue(existing.notes ?? '');
        this.requireReason();
      },
      // A failed lookup must not block entry: the server's unique index still refuses a
      // genuine duplicate, so the worst case is the conflict the pre-check was avoiding.
      error: () => this.checkingDate.set(false),
    });
  }

  protected submit(): void {
    markAllAsTouched(this.form);
    this.formError.set(null);

    if (this.form.invalid || this.total() <= 0) {
      return;
    }

    const amounts = this.amountsPayload();
    const notes = this.form.controls.notes.value.trim();
    const editing = this.editing();

    this.saving.set(true);

    const request$ =
      editing === null
        ? this.service.record({
            entryDate: this.form.controls.entryDate.value,
            notes: notes.length === 0 ? undefined : notes,
            amounts,
          })
        : this.service.update(editing.id, {
            notes: notes.length === 0 ? undefined : notes,
            amounts,
            reason: this.form.controls.reason.value.trim(),
          });

    request$.subscribe({
      next: (entry) => {
        this.saving.set(false);
        this.dialogRef.close(entry);
      },
      error: (error: AppError) => {
        this.saving.set(false);
        const unmatched = applyServerErrors(this.form, error);
        this.formError.set(unmatched[0] ?? error.message);
      },
    });
  }

  protected close(): void {
    this.dialogRef.close();
  }

  private requireReason(): void {
    this.form.controls.reason.setValidators([Validators.required, Validators.minLength(3)]);
    this.form.controls.reason.updateValueAndValidity();
  }

  /** Only the buckets that took money — a zero is not a line worth storing. */
  private amountsPayload(): DailySalesAmount[] {
    const values = this.form.controls.amounts.getRawValue();

    return SALES_BUCKETS.filter((bucket) => Number(values[bucket.key] ?? 0) > 0).map((bucket) => ({
      channel: bucket.channel,
      paymentMode: bucket.paymentMode,
      amount: Math.round(Number(values[bucket.key] ?? 0) * 100) / 100,
    }));
  }

  private sumAmounts(): number {
    const values = this.form.controls.amounts.getRawValue();
    const total = SALES_BUCKETS.reduce((sum, bucket) => sum + Number(values[bucket.key] ?? 0), 0);

    return Math.round(total * 100) / 100;
  }
}
