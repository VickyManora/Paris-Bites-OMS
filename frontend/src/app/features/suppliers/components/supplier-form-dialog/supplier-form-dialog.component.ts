import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import type { AppError } from '../../../../core/errors/app-error';
import { DialogShellComponent } from '../../../../shared/components/dialog-shell/dialog-shell.component';
import { FormSectionComponent } from '../../../../shared/components/form-section/form-section.component';
import { InlineAlertComponent } from '../../../../shared/components/inline-alert/inline-alert.component';
import { SubmitButtonComponent } from '../../../../shared/components/submit-button/submit-button.component';
import { MATERIAL_FORM_IMPORTS } from '../../../../shared/material/material-imports';
import { applyServerErrors, firstErrorMessage } from '../../../../shared/utils/form.utils';
import {
  GST_STATE_OPTIONS,
  GSTIN_PATTERN,
  gstinMatchesState,
  type CreateSupplierRequest,
  type Supplier,
  type UpdateSupplierRequest,
} from '../../models/supplier.model';
import { SupplierService } from '../../services/supplier.service';

/** `supplier` present means edit; absent means create. */
export interface SupplierFormDialogData {
  readonly supplier?: Supplier;
}

/**
 * Create/edit a supplier.
 *
 * **GSTIN is optional, state is not.** A vendor below the registration threshold
 * legitimately has no GSTIN, and a purchase from them is still a purchase — it simply
 * carries no input tax credit. The state is required regardless, because place of supply
 * decides the tax split whether or not the supplier is registered.
 */
@Component({
  selector: 'pb-supplier-form-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    DialogShellComponent,
    FormSectionComponent,
    InlineAlertComponent,
    SubmitButtonComponent,
    ...MATERIAL_FORM_IMPORTS,
  ],
  template: `
    <pb-dialog-shell
      [title]="isEdit() ? 'Edit supplier' : 'Add supplier'"
      subtitle="Where you buy from, and how their tax is treated"
      icon="suppliers"
    >
      @if (formError(); as message) {
        <pb-inline-alert slot="error" [message]="message" />
      }

      <!--
        'pb-form' opts this subtree into the form styles in styles.scss — tighter subscript, semantic
        error colour, themed date indicators. Applied per form rather than globally so the filter
        controls in the list toolbars, which use the same Material component for a different job, keep
        their own sizing.
      -->
      <form [formGroup]="form" class="pb-form flex flex-col gap-pb-5" novalidate>
        <pb-form-section title="Identity" icon="badge">
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Supplier name</mat-label>
            <input matInput formControlName="name" maxlength="160" required autocomplete="off" />
            @if (error('name', 'Name'); as message) {
              <mat-error>{{ message }}</mat-error>
            }
          </mat-form-field>

          <div class="grid grid-cols-1 gap-pb-3 sm:grid-cols-2">
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>GSTIN</mat-label>
              <input
                matInput
                formControlName="gstin"
                maxlength="15"
                autocomplete="off"
                placeholder="27AAPFU0939F1ZV"
              />
              <!-- The hint stays visible alongside the error rather than being replaced by it: "leave
                   empty for an unregistered supplier" is the thing most likely to resolve the error. -->
              @if (error('gstin', 'GSTIN', gstinHints); as message) {
                <mat-error>{{ message }}</mat-error>
              }
              <mat-hint>15 characters, or empty if unregistered</mat-hint>
            </mat-form-field>

            <mat-form-field subscriptSizing="dynamic">
              <mat-label>State</mat-label>
              <mat-select formControlName="stateCode" required panelClass="pb-select-panel">
                @for (option of stateOptions; track option.value) {
                  <mat-option [value]="option.value">{{ option.label }}</mat-option>
                }
              </mat-select>
              @if (error('stateCode', 'State'); as message) {
                <mat-error>{{ message }}</mat-error>
              }
              <mat-hint>Decides CGST + SGST versus IGST</mat-hint>
            </mat-form-field>
          </div>

          <!-- The first two digits of a GSTIN are the state code, so a mismatch means one
               of the two is wrong — and getting it wrong flips every future invoice from
               CGST/SGST to IGST. Warned rather than blocked: the server is the authority,
               and a legitimate edge case should not be un-saveable. -->
          @if (stateMismatch(); as mismatch) {
            <pb-inline-alert
              tone="warning"
              title="Check the state"
              [message]="
                'This GSTIN starts with ' +
                mismatch.gstinState +
                ', but the selected state is ' +
                mismatch.selectedState +
                '. You can still save — the server decides.'
              "
            />
          }
        </pb-form-section>

        <pb-form-section
          title="Contact"
          icon="contacts"
          description="All optional. Useful when a delivery or an invoice needs chasing."
        >
          <div class="grid grid-cols-1 gap-pb-3 sm:grid-cols-2">
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Contact name</mat-label>
              <input matInput formControlName="contactName" maxlength="120" autocomplete="off" />
            </mat-form-field>

            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Phone</mat-label>
              <input matInput formControlName="phone" maxlength="24" autocomplete="off" />
            </mat-form-field>

            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Email</mat-label>
              <input matInput type="email" formControlName="email" autocomplete="off" />
              @if (error('email', 'Email'); as message) {
                <mat-error>{{ message }}</mat-error>
              }
            </mat-form-field>

            <mat-form-field subscriptSizing="dynamic">
              <mat-label>City</mat-label>
              <input matInput formControlName="city" maxlength="80" autocomplete="off" />
            </mat-form-field>
          </div>

          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Address</mat-label>
            <input matInput formControlName="addressLine" maxlength="240" autocomplete="off" />
          </mat-form-field>
        </pb-form-section>

        <pb-form-section title="Notes and status" icon="sticky_note_2">
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Notes</mat-label>
            <textarea matInput formControlName="notes" rows="2" maxlength="1000"></textarea>
            <mat-hint>Payment terms, delivery days, anything worth remembering</mat-hint>
          </mat-form-field>

          @if (isEdit()) {
            <div class="rounded-pb-lg border border-outline-variant p-pb-3">
              <mat-checkbox formControlName="isActive">
                <span class="text-pb-body">Active</span>
              </mat-checkbox>
              <p class="m-0 mt-pb-1 pl-pb-6 text-pb-caption text-on-surface-variant">
                Inactive suppliers stay on past invoices but cannot be named on a new one.
              </p>
            </div>
          }
        </pb-form-section>
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
        [label]="isEdit() ? 'Save changes' : 'Add supplier'"
        [busy]="saving()"
        icon="check"
        (pressed)="save()"
      />
    </pb-dialog-shell>
  `,
})
export class SupplierFormDialogComponent {
  readonly dialogRef =
    inject<MatDialogRef<SupplierFormDialogComponent, Supplier | undefined>>(MatDialogRef);
  private readonly data = inject<SupplierFormDialogData>(MAT_DIALOG_DATA, { optional: true });
  private readonly service = inject(SupplierService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly stateOptions = GST_STATE_OPTIONS;

  private readonly existing = this.data?.supplier ?? null;

  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    name: [this.existing?.name ?? '', [Validators.required, Validators.maxLength(160)]],
    // Uppercased on submit, not on every keystroke: rewriting the input as the user types
    // moves the caret and makes the field feel broken.
    gstin: [this.existing?.gstin ?? '', [Validators.pattern(GSTIN_PATTERN)]],
    stateCode: [this.existing?.stateCode ?? '', [Validators.required]],
    contactName: [this.existing?.contactName ?? ''],
    email: [this.existing?.email ?? '', [Validators.email]],
    phone: [this.existing?.phone ?? ''],
    addressLine: [this.existing?.addressLine ?? ''],
    city: [this.existing?.city ?? ''],
    notes: [this.existing?.notes ?? ''],
    isActive: [this.existing?.isActive ?? true],
  });

  private readonly gstinValue = toSignal(this.form.controls.gstin.valueChanges, {
    initialValue: this.form.controls.gstin.value,
  });
  private readonly stateValue = toSignal(this.form.controls.stateCode.valueChanges, {
    initialValue: this.form.controls.stateCode.value,
  });

  protected readonly isEdit = computed(() => this.existing !== null);

  protected readonly stateMismatch = computed(() => {
    const gstin = this.gstinValue().trim().toUpperCase();
    const stateCode = this.stateValue();

    if (!GSTIN_PATTERN.test(gstin) || stateCode.length === 0) {
      return null;
    }
    if (gstinMatchesState(gstin, stateCode)) {
      return null;
    }

    return {
      gstinState: this.stateLabel(gstin.slice(0, 2)),
      selectedState: this.stateLabel(stateCode),
    };
  });

  /**
   * What a failed GSTIN pattern actually means.
   *
   * The generic message for `pattern` is "GSTIN is not in the expected format", which is true and
   * unhelpful. This says what the format *is*, which is the only thing that lets someone fix it.
   */
  protected readonly gstinHints = {
    pattern: 'A GSTIN is 15 characters: 2 digits, 5 letters, 4 digits, 1 letter, then 3 more.',
  } as const;

  protected error(
    control: keyof typeof this.form.controls,
    label: string,
    hints?: Readonly<Record<string, string>>,
  ): string | null {
    return firstErrorMessage(this.form.controls[control], label, hints);
  }

  protected save(): void {
    this.formError.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.saving()) {
      return;
    }

    this.saving.set(true);
    this.form.disable();

    const request$ =
      this.existing === null
        ? this.service.create(this.toCreateRequest())
        : this.service.update(this.existing.id, this.toUpdateRequest());

    request$.subscribe({
      next: (supplier) => this.dialogRef.close(supplier),
      error: (error: AppError) => {
        this.saving.set(false);
        this.form.enable();

        const unmatched = applyServerErrors(this.form, error);
        this.formError.set(unmatched[0] ?? error.message);
      },
    });
  }

  private toCreateRequest(): CreateSupplierRequest {
    const value = this.form.getRawValue();
    const trimmed = this.trimmedOptionals();

    return {
      name: value.name.trim(),
      stateCode: value.stateCode,
      ...trimmed,
    };
  }

  /**
   * Sends only what changed, and distinguishes cleared from unchanged.
   *
   * `gstin` is the one field where the difference is load-bearing: omitting it leaves the
   * number alone, while `null` removes it — which is how a deregistered supplier is
   * corrected. Every other optional is a plain string the API leaves alone when absent.
   */
  private toUpdateRequest(): UpdateSupplierRequest {
    const existing = this.existing;

    if (existing === null) {
      return {};
    }

    const value = this.form.getRawValue();
    const name = value.name.trim();
    const gstin = value.gstin.trim().toUpperCase();

    return {
      ...(name !== existing.name && { name }),
      ...(gstin !== (existing.gstin ?? '') && { gstin: gstin.length > 0 ? gstin : null }),
      ...(value.stateCode !== existing.stateCode && { stateCode: value.stateCode }),
      ...(value.isActive !== existing.isActive && { isActive: value.isActive }),
      ...this.changedOptionals(existing),
    };
  }

  /** Non-empty optional strings, for create. */
  private trimmedOptionals(): Record<string, string> {
    const value = this.form.getRawValue();
    const result: Record<string, string> = {};

    for (const key of ['contactName', 'email', 'phone', 'addressLine', 'city', 'notes'] as const) {
      const entry = value[key].trim();
      if (entry.length > 0) {
        result[key] = entry;
      }
    }

    const gstin = value.gstin.trim().toUpperCase();
    if (gstin.length > 0) {
      result['gstin'] = gstin;
    }

    return result;
  }

  private changedOptionals(existing: Supplier): Record<string, string> {
    const value = this.form.getRawValue();
    const result: Record<string, string> = {};

    for (const key of ['contactName', 'email', 'phone', 'addressLine', 'city', 'notes'] as const) {
      const entry = value[key].trim();
      if (entry !== (existing[key] ?? '')) {
        result[key] = entry;
      }
    }

    return result;
  }

  private stateLabel(code: string): string {
    return this.stateOptions.find((option) => option.value === code)?.label ?? `state ${code}`;
  }
}
