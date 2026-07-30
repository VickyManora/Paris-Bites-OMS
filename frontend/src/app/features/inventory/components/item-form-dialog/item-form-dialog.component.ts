import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { catchError, of } from 'rxjs';
import type { AppError } from '../../../../core/errors/app-error';
import { DialogShellComponent } from '../../../../shared/components/dialog-shell/dialog-shell.component';
import { FormSectionComponent } from '../../../../shared/components/form-section/form-section.component';
import { InlineAlertComponent } from '../../../../shared/components/inline-alert/inline-alert.component';
import { SubmitButtonComponent } from '../../../../shared/components/submit-button/submit-button.component';
import { MATERIAL_FORM_IMPORTS } from '../../../../shared/material/material-imports';
import { applyServerErrors, firstErrorMessage } from '../../../../shared/utils/form.utils';
import {
  INVENTORY_CATEGORY_OPTIONS,
  INVENTORY_LOCATION_OPTIONS,
  INVENTORY_STATUS_OPTIONS,
  INVENTORY_UNIT_ABBREVIATIONS,
  INVENTORY_UNIT_OPTIONS,
  isDiscreteUnit,
  type CreateInventoryItemRequest,
  type InventoryCategory,
  type InventoryItem,
  type InventoryItemStatus,
  type InventoryLocation,
  type InventoryUnit,
  type SupplierOption,
  type UpdateInventoryItemRequest,
} from '../../models/inventory.model';
import { InventoryService } from '../../services/inventory.service';

/** `item` present means edit; absent means create. */
export interface ItemFormDialogData {
  readonly item?: InventoryItem;
}

/**
 * Create/edit dialog for an inventory item.
 *
 * A dialog rather than a route because the list is the working context: staff add items
 * while scanning what is already there, and a full page navigation loses their filters and
 * scroll position.
 *
 * **In edit mode `currentQuantity` is not editable.** Stock changes go through the adjust
 * dialog, which records a quantity-specific history entry and is gated on a different
 * permission. Letting the edit form silently overwrite a stock level would make the
 * history unreliable — so the field is shown read-only with a pointer to the right action.
 */
@Component({
  selector: 'pb-item-form-dialog',
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
      [title]="isEdit() ? 'Edit item' : 'Add inventory item'"
      subtitle="What it is, how much there is, and when to reorder"
      icon="inventory_2"
    >
      @if (formError(); as message) {
        <pb-inline-alert slot="error" [message]="message" />
      }

      <form [formGroup]="form" class="pb-form flex flex-col gap-pb-5" novalidate>
        <pb-form-section title="What it is" icon="label">
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Item name</mat-label>
            <input matInput formControlName="name" maxlength="120" required autocomplete="off" />
            @if (error('name', 'Name'); as message) {
              <mat-error>{{ message }}</mat-error>
            }
          </mat-form-field>

          <!-- Two columns from sm up; stacked on a phone where side-by-side selects
             would be too narrow to read. -->
          <div class="grid grid-cols-1 gap-pb-3 sm:grid-cols-2">
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Category</mat-label>
              <mat-select formControlName="category" required>
                @for (option of categoryOptions; track option.value) {
                  <mat-option [value]="option.value">{{ option.label }}</mat-option>
                }
              </mat-select>
              @if (error('category', 'Category'); as message) {
                <mat-error>{{ message }}</mat-error>
              }
            </mat-form-field>

            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Location</mat-label>
              <mat-select formControlName="location" required>
                @for (option of locationOptions; track option.value) {
                  <mat-option [value]="option.value">{{ option.label }}</mat-option>
                }
              </mat-select>
              @if (error('location', 'Location'); as message) {
                <mat-error>{{ message }}</mat-error>
              }
            </mat-form-field>

            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Unit</mat-label>
              <mat-select formControlName="unit" required>
                @for (option of unitOptions; track option.value) {
                  <mat-option [value]="option.value">{{ option.label }}</mat-option>
                }
              </mat-select>
              @if (error('unit', 'Unit'); as message) {
                <mat-error>{{ message }}</mat-error>
              }
              @if (isDiscrete()) {
                <mat-hint>Whole numbers only</mat-hint>
              }
            </mat-form-field>

            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Status</mat-label>
              <mat-select formControlName="status">
                @for (option of statusOptions; track option.value) {
                  <mat-option [value]="option.value">{{ option.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>
        </pb-form-section>

        <pb-form-section
          title="Stock levels"
          icon="inventory"
          description="The minimum is the reorder trigger — the level at which this item starts showing as low."
        >
          <div class="grid grid-cols-1 gap-pb-3 sm:grid-cols-2">
            @if (isEdit()) {
              <!-- Read-only, with the reason and the alternative stated. -->
              <mat-form-field subscriptSizing="dynamic">
                <mat-label>Current quantity</mat-label>
                <input matInput [value]="currentQuantityDisplay()" readonly />
                <mat-icon matSuffix aria-hidden="true">lock</mat-icon>
                <mat-hint>Change stock with "Adjust quantity"</mat-hint>
              </mat-form-field>
            } @else {
              <mat-form-field subscriptSizing="dynamic">
                <mat-label>Current quantity</mat-label>
                <input
                  matInput
                  type="number"
                  inputmode="decimal"
                  formControlName="currentQuantity"
                  [step]="quantityStep()"
                  min="0"
                  required
                />
                <span matTextSuffix>{{ unitSuffix() }}</span>
                @if (error('currentQuantity', 'Current quantity'); as message) {
                  <mat-error>{{ message }}</mat-error>
                }
              </mat-form-field>
            }

            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Minimum quantity</mat-label>
              <input
                matInput
                type="number"
                inputmode="decimal"
                formControlName="minimumQuantity"
                [step]="quantityStep()"
                min="0"
                required
              />
              <span matTextSuffix>{{ unitSuffix() }}</span>
              @if (error('minimumQuantity', 'Minimum quantity'); as message) {
                <mat-error>{{ message }}</mat-error>
              } @else {
                <mat-hint>0 disables the low-stock warning</mat-hint>
              }
            </mat-form-field>
          </div>
        </pb-form-section>

        <!-- Purchasing. Both optional: an item can be tracked before anyone has priced
             it or decided where to buy it again. -->
        <pb-form-section
          title="Cost and supply"
          icon="payments"
          description="Both optional. An item can be tracked before anyone has priced it."
        >
          <div class="grid grid-cols-1 gap-pb-3 sm:grid-cols-2">
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Purchase price</mat-label>
              <input
                matInput
                type="number"
                inputmode="decimal"
                formControlName="purchasePrice"
                step="0.01"
                min="0"
              />
              <span matTextPrefix>₹&nbsp;</span>
              @if (error('purchasePrice', 'Purchase price'); as message) {
                <mat-error>{{ message }}</mat-error>
              } @else {
                <!-- "Per unit", not "Per {{ '{{' }} unitSuffix() }}": the abbreviations are
                   plural ("bottles", "packets"), so interpolating one reads as
                   "Per bottles". The unit is already shown on the quantity fields above. -->
                <mat-hint>Per unit, excluding tax</mat-hint>
              }
            </mat-form-field>

            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Supplier</mat-label>
              <mat-select formControlName="supplierId">
                <!-- An explicit "none" option: clearing a mat-select otherwise needs a
                   gesture most users never discover. -->
                <mat-option [value]="null">No supplier</mat-option>
                @for (option of supplierOptions(); track option.id) {
                  <mat-option [value]="option.id">{{ option.name }}</mat-option>
                }
              </mat-select>
              @if (error('supplierId', 'Supplier'); as message) {
                <mat-error>{{ message }}</mat-error>
              } @else {
                <mat-hint>Usual vendor — a purchase may still name any supplier</mat-hint>
              }
            </mat-form-field>
          </div>
        </pb-form-section>

        <pb-form-section
          title="Batch and expiry"
          icon="event"
          description="These describe the stock currently held, not the item itself."
        >
          <div class="grid grid-cols-1 gap-pb-3 sm:grid-cols-2">
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Batch number</mat-label>
              <input matInput formControlName="batchNumber" maxlength="60" autocomplete="off" />
              @if (error('batchNumber', 'Batch number'); as message) {
                <mat-error>{{ message }}</mat-error>
              }
            </mat-form-field>

            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Expiry date</mat-label>
              <!-- A native date input rather than a Material datepicker: it needs no extra
                 module, and YYYY-MM-DD is exactly the format the API expects, so there
                 is no timezone conversion between the field and the wire. -->
              <input matInput type="date" formControlName="expiryDate" />
              @if (error('expiryDate', 'Expiry date'); as message) {
                <mat-error>{{ message }}</mat-error>
              } @else {
                <mat-hint>Leave empty for items that do not expire</mat-hint>
              }
            </mat-form-field>
          </div>
        </pb-form-section>

        <pb-form-section title="Alerts and notes" icon="notifications_active">
          <div class="rounded-pb-lg border border-outline-variant p-pb-3">
            <mat-checkbox formControlName="lowStockAlertEnabled">
              <span class="text-pb-body">Alert when this item runs low</span>
            </mat-checkbox>
            <!-- Stated because the two are easy to conflate: switching this off silences the
                 warning, it does not remove the item from the low-stock list. -->
            <p class="m-0 mt-pb-1 pl-pb-6 text-pb-caption text-on-surface-variant">
              Turning this off silences the warning. The item still counts as low on stock.
            </p>
          </div>

          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Notes</mat-label>
            <textarea matInput formControlName="notes" rows="2" maxlength="1000"></textarea>
            @if (error('notes', 'Notes'); as message) {
              <mat-error>{{ message }}</mat-error>
            }
          </mat-form-field>
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
        [label]="isEdit() ? 'Save changes' : 'Add item'"
        [busy]="saving()"
        icon="check"
        (pressed)="save()"
      />
    </pb-dialog-shell>
  `,
})
export class ItemFormDialogComponent {
  readonly dialogRef =
    inject<MatDialogRef<ItemFormDialogComponent, InventoryItem | undefined>>(MatDialogRef);
  private readonly data = inject<ItemFormDialogData>(MAT_DIALOG_DATA, { optional: true });
  private readonly service = inject(InventoryService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly categoryOptions = INVENTORY_CATEGORY_OPTIONS;
  protected readonly locationOptions = INVENTORY_LOCATION_OPTIONS;
  protected readonly unitOptions = INVENTORY_UNIT_OPTIONS;
  protected readonly statusOptions = INVENTORY_STATUS_OPTIONS;

  private readonly existing = this.data?.item ?? null;

  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);

  /**
   * Defaults for a new item, typed as the unions rather than as string literals.
   *
   * Without the explicit types the form builder would infer the literal `'DAIRY'` and
   * reject every other category at compile time — which is why this is a typed constant
   * instead of an inline cast at each control.
   */
  private static readonly DEFAULTS: {
    category: InventoryCategory;
    location: InventoryLocation;
    unit: InventoryUnit;
    status: InventoryItemStatus;
  } = {
    category: 'DAIRY',
    location: 'HOME_WAREHOUSE',
    unit: 'KG',
    status: 'ACTIVE',
  };

  /**
   * `nonNullable` is dropped for the optional fields.
   *
   * A `nonNullable` control resets to its initial value rather than to null, and these
   * fields genuinely have an empty state — no price, no supplier, no expiry. Modelling
   * that as `''`/`null` here and normalising on submit keeps "cleared" distinguishable
   * from "unchanged", which is the distinction the PATCH endpoint is built around.
   */
  protected readonly form = this.formBuilder.nonNullable.group({
    name: [
      this.existing?.name ?? '',
      [Validators.required, Validators.minLength(2), Validators.maxLength(120)],
    ],
    category: [
      this.existing?.category ?? ItemFormDialogComponent.DEFAULTS.category,
      [Validators.required],
    ],
    location: [
      this.existing?.location ?? ItemFormDialogComponent.DEFAULTS.location,
      [Validators.required],
    ],
    unit: [this.existing?.unit ?? ItemFormDialogComponent.DEFAULTS.unit, [Validators.required]],
    status: [this.existing?.status ?? ItemFormDialogComponent.DEFAULTS.status],
    currentQuantity: [
      this.existing?.currentQuantity ?? 0,
      [Validators.required, Validators.min(0)],
    ],
    minimumQuantity: [
      this.existing?.minimumQuantity ?? 0,
      [Validators.required, Validators.min(0)],
    ],
    purchasePrice: this.formBuilder.control<number | null>(this.existing?.purchasePrice ?? null, [
      Validators.min(0),
    ]),
    supplierId: this.formBuilder.control<string | null>(this.existing?.supplierId ?? null),
    lowStockAlertEnabled: [this.existing?.lowStockAlertEnabled ?? true],
    batchNumber: [this.existing?.batchNumber ?? '', [Validators.maxLength(60)]],
    // Already `YYYY-MM-DD` from the API, which is exactly what `<input type="date">`
    // reads and writes — so the value never passes through a Date and never shifts a day.
    expiryDate: [this.existing?.expiryDate ?? ''],
    notes: [this.existing?.notes ?? ''],
  });

  /**
   * Suppliers for the dropdown.
   *
   * Loaded once per dialog and defaulted to empty on failure: a supplier list that fails
   * to load must not block adding an item, since the field is optional anyway. The
   * currently selected supplier still displays, because the item carries its own
   * `supplierName`.
   */
  protected readonly supplierOptions = toSignal(
    this.service.supplierOptions().pipe(catchError(() => of<readonly SupplierOption[]>([]))),
    { initialValue: [] as readonly SupplierOption[] },
  );

  /** Tracks the unit so the quantity inputs can adapt to it live. */
  private readonly selectedUnit = toSignal(this.form.controls.unit.valueChanges, {
    initialValue: this.form.controls.unit.value,
  });

  protected readonly isEdit = computed(() => this.existing !== null);
  protected readonly isDiscrete = computed(() => isDiscreteUnit(this.selectedUnit()));

  /** `1` for pieces and boxes, so the spinner cannot produce a fraction. */
  protected readonly quantityStep = computed(() => (this.isDiscrete() ? '1' : '0.001'));
  protected readonly unitSuffix = computed(() => INVENTORY_UNIT_ABBREVIATIONS[this.selectedUnit()]);

  protected readonly currentQuantityDisplay = computed(() => this.existing?.displayQuantity ?? '');

  protected error(control: keyof typeof this.form.controls, label: string): string | null {
    return firstErrorMessage(this.form.controls[control], label);
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

    const value = this.form.getRawValue();

    /*
     * Checked here as well as on the server, because it is the one rule a user is likely
     * to hit by accident and the message is far more useful next to the field than as a
     * 400 after a round trip.
     */
    if (this.isDiscrete()) {
      const fractional = [value.currentQuantity, value.minimumQuantity].some(
        (quantity) => !Number.isInteger(quantity),
      );

      if (fractional) {
        this.formError.set('Pieces and boxes must be whole numbers.');
        return;
      }
    }

    this.saving.set(true);
    this.form.disable();

    const request$ =
      this.existing === null
        ? this.service.create(this.toCreateRequest(value))
        : this.service.update(this.existing.id, this.toUpdateRequest(value));

    request$.subscribe({
      next: (item) => this.dialogRef.close(item),
      error: (error: AppError) => {
        this.saving.set(false);
        this.form.enable();

        // Field-scoped messages land under the offending input; anything unmatched — a
        // duplicate-name conflict, for instance — becomes the form-level message.
        const unmatched = applyServerErrors(this.form, error);
        this.formError.set(unmatched[0] ?? error.message);
      },
    });
  }

  private toCreateRequest(
    value: ReturnType<typeof this.form.getRawValue>,
  ): CreateInventoryItemRequest {
    const batchNumber = value.batchNumber.trim();

    // Optional fields are omitted when empty rather than sent as '' or null: the create
    // endpoint treats absence as "not set", and sending an empty string would fail
    // validation on the ones with a format.
    return {
      name: value.name.trim(),
      category: value.category,
      unit: value.unit,
      location: value.location,
      currentQuantity: value.currentQuantity,
      minimumQuantity: value.minimumQuantity,
      status: value.status,
      lowStockAlertEnabled: value.lowStockAlertEnabled,
      ...(value.purchasePrice !== null && { purchasePrice: value.purchasePrice }),
      ...(value.supplierId !== null && { supplierId: value.supplierId }),
      ...(batchNumber.length > 0 && { batchNumber }),
      ...(value.expiryDate.length > 0 && { expiryDate: value.expiryDate }),
      ...(value.notes.trim().length > 0 && { notes: value.notes.trim() }),
    };
  }

  /**
   * Sends only what changed.
   *
   * A full payload would record every field in the item's history as "changed" on every
   * save, drowning the real edits.
   */
  private toUpdateRequest(
    value: ReturnType<typeof this.form.getRawValue>,
  ): UpdateInventoryItemRequest {
    const existing = this.existing;

    if (existing === null) {
      return {};
    }

    const name = value.name.trim();
    const notes = value.notes.trim();
    // Emptied text fields become `null`, which is how the API is told to clear them.
    const batchNumber = value.batchNumber.trim() || null;
    const expiryDate = value.expiryDate.length > 0 ? value.expiryDate : null;

    // Conditional spreads rather than building an untyped record and asserting: a typo in
    // a key is then a compile error instead of a silently ignored field.
    return {
      ...(name !== existing.name && { name }),
      ...(value.category !== existing.category && { category: value.category }),
      ...(value.location !== existing.location && { location: value.location }),
      ...(value.unit !== existing.unit && { unit: value.unit }),
      ...(value.status !== existing.status && { status: value.status }),
      ...(value.minimumQuantity !== existing.minimumQuantity && {
        minimumQuantity: value.minimumQuantity,
      }),
      ...(value.purchasePrice !== existing.purchasePrice && {
        purchasePrice: value.purchasePrice,
      }),
      ...(value.supplierId !== existing.supplierId && { supplierId: value.supplierId }),
      ...(value.lowStockAlertEnabled !== existing.lowStockAlertEnabled && {
        lowStockAlertEnabled: value.lowStockAlertEnabled,
      }),
      ...(batchNumber !== existing.batchNumber && { batchNumber }),
      ...(expiryDate !== existing.expiryDate && { expiryDate }),
      // `null` clears the notes; the API treats `undefined` as "leave unchanged".
      ...(notes !== (existing.notes ?? '') && { notes: notes.length > 0 ? notes : null }),
    };
  }
}
