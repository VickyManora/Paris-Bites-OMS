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
import { PosService } from '../../../pos/services/pos.service';
import { PaymentMethod } from '../../../pos/models/pos.model';

/** Money, to the paisa. Repeated arithmetic on floats is how a 299 becomes a 298.99999. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A rupee figure for prose, not for a table — no alignment concerns, so no fixed decimals. */
function inr(value: number): string {
  return `\u20b9${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

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
    <pb-dialog-shell [title]="dialogTitle()" subtitle="One entry per trading day" icon="sales">
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

        <!--
          Where the walk-in figures came from, stated rather than left to be inferred.

          A field that silently fills itself is worse than an empty one: the user cannot tell whether
          they are confirming the till or reading their own earlier entry, and the whole value of the
          declared figure rests on them knowing which. 'info' rather than 'success' — nothing has been
          achieved yet, it is the starting point for a count.
        -->
        @if (prefilledFromTill() && counterTakings(); as till) {
          <pb-inline-alert
            tone="info"
            title="Walk-in filled from the till"
            [message]="tillMessage()"
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

        <!--
          Completing a day says so instead of asking why. Adding Zomato once the platform settles
          contradicts nothing that was recorded, and a mandatory "why is it changing?" on the normal
          evening routine trains people to type a character to get past it.
        -->
        @if (isEditing() && !isCorrecting() && filledLabels().length > 0) {
          <pb-inline-alert
            tone="success"
            title="Completing the day"
            [message]="completionMessage()"
          />
        }

        @if (isCorrecting()) {
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
        [label]="submitLabel()"
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
  private readonly pos = inject(PosService);
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

  /**
   * What the till says the counter took on the chosen day, once it has been read.
   *
   * Null means "no figure to offer" and covers every reason for that: the request failed, the
   * caller cannot see POS data, the day had no counter orders, or the summary came back scoped to
   * one operator. It is deliberately one signal rather than a loading/error/value trio — nothing in
   * this dialog behaves differently between those cases, because a prefill that cannot be offered
   * is simply an empty field.
   */
  protected readonly counterTakings = signal<{
    readonly cash: number;
    readonly online: number;
    readonly orders: number;
  } | null>(null);

  /** True once the till figures have actually been written into the fields. */
  protected readonly prefilledFromTill = signal(false);

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

  /**
   * The submit label names what is about to happen.
   *
   * Three states, not two: recording a fresh day, completing one that is already recorded, and
   * correcting a figure. "Save correction" on a day where nothing is being corrected was the
   * misleading case.
   */
  protected readonly submitLabel = computed(() => {
    if (!this.isEditing()) {
      return 'Record day';
    }

    return this.isCorrecting() ? 'Save correction' : 'Save';
  });

  protected readonly tillMessage = computed(() => {
    const till = this.counterTakings();

    if (till === null) {
      return '';
    }

    const orders = `${till.orders} counter ${till.orders === 1 ? 'order' : 'orders'}`;

    return `${orders} rang up ${inr(till.cash)} cash and ${inr(till.online)} online. Count the drawer and correct the cash figure if it differs.`;
  });

  protected readonly completionMessage = computed(() => {
    const labels = this.filledLabels();

    return `Adding ${labels.join(' and ')} to a day that was already recorded. No reason needed — nothing recorded is changing.`;
  });

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

  /** The raw amounts as a signal, so the correcting/completing computeds track typing. */
  private readonly amountValues = signal<Record<string, number>>(
    this.form.controls.amounts.getRawValue(),
  );

  protected readonly formattedTotal = computed(
    () =>
      `₹${this.total().toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
  );

  constructor() {
    if (this.data.entry !== undefined) {
      this.applyReasonRule();
      // The date of an existing day is not up for editing: changing it would silently
      // move a day's takings, and "this is the wrong date" is a delete-and-re-enter.
      this.form.controls.entryDate.disable();
    }

    this.form.controls.amounts.valueChanges.subscribe(() => {
      this.total.set(this.sumAmounts());
      this.amountValues.set(this.form.controls.amounts.getRawValue());
      this.applyReasonRule();
    });

    /*
     * A new day starts from the till rather than from zero. Correcting an existing day does not:
     * overwriting stored figures with the till's would destroy the very thing the stored figure is
     * for, which is somebody's independent count.
     */
    if (this.data.entry === undefined) {
      this.loadCounterTakings(this.form.controls.entryDate.value);
    }
  }

  /**
   * Reads the day's counter takings and offers them as a starting point.
   *
   * ## Why this is a prefill and not the answer
   *
   * Declared sales and POS orders are two records of the same walk-in trade, and the app compares
   * them rather than adding them — the dashboard ships the variance. Writing the till's figure
   * straight in would make that comparison identical by construction and it would stop detecting
   * anything: an order rung up wrong, an order never rung up at all, a short drawer. So the fields
   * stay editable and the hint says where the number came from, which keeps the cash count a real
   * count while removing the retyping.
   *
   * ## The scope guard is load-bearing
   *
   * `/pos/summary` answers within the caller's permission: a manager sees only their own orders and
   * the payload says so with `scope: 'own'`. Prefilling from that would seed a whole day's declared
   * takings with one operator's shift and look authoritative doing it — a silent under-report, which
   * is worse than an empty field. Only `all` is offered.
   *
   * A failure is swallowed on purpose. This is a convenience on top of a form that worked before it
   * existed; an error banner about the till would be noise on a screen whose job is entering a
   * figure the user is holding in their hand.
   */
  private loadCounterTakings(date: string): void {
    this.counterTakings.set(null);
    this.prefilledFromTill.set(false);

    if (date.length === 0) {
      return;
    }

    this.pos.summary(date).subscribe({
      next: (day) => {
        /* The split is absent unless the caller holds `POS_TAKINGS_READ` — which whoever can reach
           this dialog does, since recording sales is admin-only. Checked rather than assumed,
           because the two permissions are separate and this prefill is not worth coupling them. */
        const split = day.byPaymentMethod;

        if (day.scope !== 'all' || split === undefined || (day.revenue ?? 0) <= 0) {
          return;
        }

        const cash = round2(split[PaymentMethod.CASH]);
        /* Card is folded into online because the declared buckets have no card of their own — the
           cart takes UPI against a printed QR, and a card total would have nowhere to land. */
        const online = round2(split[PaymentMethod.UPI] + split[PaymentMethod.CARD]);

        this.counterTakings.set({ cash, online, orders: day.paidCount });

        /* Only into empty fields. By the time this resolves the user may already have typed, and
           overwriting what somebody entered is never the friendlier behaviour. */
        const walkInCash = this.form.controls.amounts.get('WALK_IN:CASH');
        const walkInOnline = this.form.controls.amounts.get('WALK_IN:ONLINE');
        let applied = false;

        if (walkInCash !== null && Number(walkInCash.value) === 0 && cash > 0) {
          walkInCash.setValue(cash);
          applied = true;
        }
        if (walkInOnline !== null && Number(walkInOnline.value) === 0 && online > 0) {
          walkInOnline.setValue(online);
          applied = true;
        }

        this.prefilledFromTill.set(applied);
      },
      error: () => this.counterTakings.set(null),
    });
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
          /* A different unrecorded day has a different till total, so the offer is re-read
             rather than carried over from the date the dialog opened on. */
          this.form.controls.amounts.reset(
            Object.fromEntries(SALES_BUCKETS.map((b) => [b.key, 0])),
          );
          this.loadCounterTakings(date);
          return;
        }

        /* Switching to correcting drops the till offer: from here the stored figures are the
           subject, and a prefill hint pointing at fields the user did not fill would misdescribe
           where those numbers came from. */
        this.counterTakings.set(null);
        this.prefilledFromTill.set(false);

        this.form.controls.amounts.patchValue(
          Object.fromEntries(SALES_BUCKETS.map((b) => [b.key, existing.amounts[b.key] ?? 0])),
        );
        this.form.controls.notes.setValue(existing.notes ?? '');
        this.applyReasonRule();
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
            /* Omitted when completing, so the server writes its own "Added Zomato" note rather
               than storing an empty string as somebody's stated reason. */
            reason: this.isCorrecting() ? this.form.controls.reason.value.trim() : undefined,
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

  /**
   * Which buckets already held a figure, for the completing-versus-correcting rule.
   *
   * Recomputed from `editing()` rather than captured once, because the dialog can switch into
   * correcting a different day after a date change.
   */
  private readonly recordedBuckets = computed(() => {
    const entry = this.editing();

    if (entry === null) {
      return new Set<string>();
    }

    return new Set(
      SALES_BUCKETS.filter((bucket) => (entry.amounts[bucket.key] ?? 0) > 0).map((b) => b.key),
    );
  });

  /**
   * True when this edit changes a figure that was already recorded.
   *
   * Mirrors `classifyChange` on the server, and the server remains the authority — this copy exists
   * so the reason field appears and disappears as the user types rather than after a rejected
   * submit. Filling an empty bucket is completing the day; altering or clearing a bucket that held
   * money is correcting it.
   */
  protected readonly isCorrecting = computed(() => {
    const entry = this.editing();

    if (entry === null) {
      return false;
    }

    const values = this.amountValues();
    const recorded = this.recordedBuckets();

    return SALES_BUCKETS.some((bucket) => {
      if (!recorded.has(bucket.key)) {
        return false;
      }

      return round2(Number(values[bucket.key] ?? 0)) !== round2(entry.amounts[bucket.key] ?? 0);
    });
  });

  /** The buckets being filled for the first time, so the dialog can say what it is doing. */
  protected readonly filledLabels = computed(() => {
    const entry = this.editing();

    if (entry === null) {
      return [];
    }

    const values = this.amountValues();
    const recorded = this.recordedBuckets();

    return SALES_BUCKETS.filter(
      (bucket) => !recorded.has(bucket.key) && Number(values[bucket.key] ?? 0) > 0,
    ).map((bucket) => bucket.shortLabel);
  });

  /**
   * Attaches the reason validator only when one is genuinely required.
   *
   * Driven from `valueChanges` as well as the date lookup: a user who opens a recorded day, types
   * a Zomato figure, then also edits the cash total has moved from completing to correcting, and the
   * field has to appear at that moment rather than on submit.
   */
  private applyReasonRule(): void {
    const control = this.form.controls.reason;

    if (this.isCorrecting()) {
      control.setValidators([Validators.required, Validators.minLength(3)]);
    } else {
      control.clearValidators();
    }

    control.updateValueAndValidity({ emitEvent: false });
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
