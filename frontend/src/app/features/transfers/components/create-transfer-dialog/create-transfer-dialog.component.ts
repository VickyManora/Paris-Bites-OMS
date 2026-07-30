import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type FormArray,
  type FormGroup,
} from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import type { AppError } from '../../../../core/errors/app-error';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import { DialogShellComponent } from '../../../../shared/components/dialog-shell/dialog-shell.component';
import { SubmitButtonComponent } from '../../../../shared/components/submit-button/submit-button.component';
import { InlineAlertComponent } from '../../../../shared/components/inline-alert/inline-alert.component';
import { MATERIAL_FORM_IMPORTS } from '../../../../shared/material/material-imports';
import { applyServerErrors } from '../../../../shared/utils/form.utils';
import { isDiscreteUnit, type InventoryItem } from '../../../inventory/models/inventory.model';
import { InventoryService } from '../../../inventory/services/inventory.service';
import type { StockTransfer } from '../../models/transfer.model';
import { TransferService } from '../../services/transfer.service';

/** One editable line: which warehouse item, and how much. */
interface LineForm {
  itemId: string;
  quantity: number;
}

/**
 * Create a Home Warehouse → Cart transfer.
 *
 * Multi-line, because a cart load is normally several ingredients at once and one transfer
 * per item would produce a queue nobody wants to approve.
 *
 * Only Home Warehouse items are selectable — the direction is fixed, and offering cart items
 * would let the user build a request the API rejects. Each row shows what is actually
 * available and warns when the requested amount exceeds it, but does **not** block: stock may
 * arrive before approval, and approval is where availability is authoritatively checked
 * against locked rows.
 */
@Component({
  selector: 'pb-create-transfer-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    EmptyStateComponent,
    SpinnerComponent,
    DialogShellComponent,
    InlineAlertComponent,
    SubmitButtonComponent,
    ...MATERIAL_FORM_IMPORTS,
  ],
  template: `
    <pb-dialog-shell
      title="New transfer"
      subtitle="Move stock from the Home Warehouse to the Cart"
      icon="swap_horiz"
    >
      <p class="text-pb-caption text-on-surface-variant">
        Home Warehouse → Cart. Stock moves when the transfer is approved.
      </p>

      @if (loadingItems()) {
        <pb-spinner size="md" label="Loading warehouse stock…" />
      } @else if (availableItems().length === 0) {
        <pb-empty-state
          icon="inventory_2"
          title="Nothing to transfer"
          message="The Home Warehouse has no stock available."
        />
      } @else {
        <form [formGroup]="form" class="pb-form mt-pb-3 flex flex-col gap-pb-3" novalidate>
          @if (formError(); as message) {
            <pb-inline-alert [message]="message" />
          }

          <div formArrayName="lines" class="pb-form flex flex-col gap-pb-3">
            @for (line of lineControls(); track $index) {
              <div
                [formGroupName]="$index"
                class="grid grid-cols-1 gap-2 rounded-lg border border-outline-variant p-3 sm:grid-cols-[1fr_auto_auto] sm:items-start"
              >
                <mat-form-field subscriptSizing="dynamic">
                  <mat-label>Item</mat-label>
                  <mat-select formControlName="itemId">
                    @for (item of selectableFor($index); track item.id) {
                      <mat-option [value]="item.id">
                        {{ item.name }} — {{ item.displayQuantity }} available
                      </mat-option>
                    }
                  </mat-select>
                </mat-form-field>

                <mat-form-field class="sm:!w-32" subscriptSizing="dynamic">
                  <mat-label>Quantity</mat-label>
                  <input
                    matInput
                    type="number"
                    inputmode="decimal"
                    formControlName="quantity"
                    [step]="stepFor($index)"
                    min="0"
                  />
                  <span matTextSuffix>{{ unitFor($index) }}</span>
                </mat-form-field>

                <button
                  matIconButton
                  type="button"
                  class="justify-self-end"
                  [attr.aria-label]="'Remove line ' + ($index + 1)"
                  [disabled]="lineControls().length === 1"
                  (click)="removeLine($index)"
                >
                  <mat-icon>delete</mat-icon>
                </button>

                <!-- Advisory only: the request may exceed current stock. -->
                @if (warningFor($index); as warning) {
                  <p class="text-pb-caption text-error sm:col-span-3">{{ warning }}</p>
                }
              </div>
            }
          </div>

          <button
            matButton
            type="button"
            class="self-start"
            [disabled]="!canAddLine()"
            (click)="addLine()"
          >
            <mat-icon>add</mat-icon>
            Add another item
          </button>

          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Notes (optional)</mat-label>
            <textarea matInput formControlName="notes" rows="2" maxlength="1000"></textarea>
          </mat-form-field>
        </form>
      }

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
        label="Request transfer"
        busyLabel="Creating…"
        icon="check"
        [busy]="saving()"
        [disabled]="availableItems().length === 0"
        [minWidth]="180"
        (pressed)="save()"
      />
    </pb-dialog-shell>
  `,
})
export class CreateTransferDialogComponent {
  readonly dialogRef =
    inject<MatDialogRef<CreateTransferDialogComponent, StockTransfer | undefined>>(MatDialogRef);
  private readonly transfers = inject(TransferService);
  private readonly inventory = inject(InventoryService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly saving = signal(false);
  protected readonly loadingItems = signal(true);
  protected readonly formError = signal<string | null>(null);

  /** Home Warehouse items only — the transfer direction is fixed. */
  protected readonly availableItems = signal<readonly InventoryItem[]>([]);

  /**
   * Mirrors the form array's value into a signal.
   *
   * `FormArray` is not signal-based, so the per-row hints (unit suffix, step, availability
   * warning) would not update on their own. Every mutation writes here too.
   */
  private readonly lineValues = signal<readonly LineForm[]>([]);

  protected readonly form = this.formBuilder.nonNullable.group({
    lines: this.formBuilder.array<FormGroup>([]),
    notes: [''],
  });

  /** The API caps a transfer at 50 lines; there is no point offering more. */
  protected readonly canAddLine = computed(
    () => this.lineValues().length < Math.min(50, this.availableItems().length),
  );

  constructor() {
    this.inventory
      .list({
        location: 'HOME_WAREHOUSE',
        status: 'ACTIVE',
        page: 1,
        // One page large enough to hold a realistic warehouse; a picker that paginates would
        // be worse than one that lists everything.
        pageSize: 100,
        sortField: 'name',
        sortDirection: 'asc',
      })
      .subscribe({
        next: (page) => {
          // Zero-stock items are excluded: requesting them can never be approved.
          this.availableItems.set(page.items.filter((item) => item.currentQuantity > 0));
          this.loadingItems.set(false);

          if (this.availableItems().length > 0) {
            this.addLine();
          }
        },
        error: (error: AppError) => {
          this.formError.set(error.message);
          this.loadingItems.set(false);
        },
      });
  }

  private get lines(): FormArray<FormGroup> {
    return this.form.controls.lines;
  }

  protected lineControls(): readonly FormGroup[] {
    return this.lines.controls;
  }

  protected addLine(): void {
    const used = new Set(this.lineValues().map((line) => line.itemId));
    const next = this.availableItems().find((item) => !used.has(item.id));

    if (next === undefined) {
      return;
    }

    const group = this.formBuilder.nonNullable.group({
      itemId: [next.id, [Validators.required]],
      quantity: [1, [Validators.required, Validators.min(0.001)]],
    });

    // Keeps the mirror in step with the form as the user edits.
    group.valueChanges.subscribe(() => this.syncLineValues());

    this.lines.push(group);
    this.syncLineValues();
  }

  protected removeLine(index: number): void {
    this.lines.removeAt(index);
    this.syncLineValues();
  }

  /**
   * Items still selectable for a row: everything not already used by another row, plus this
   * row's own current choice.
   *
   * Excluding used items in the dropdown is why the duplicate-line error is nearly
   * unreachable from the UI — the API still rejects it, for other clients.
   */
  protected selectableFor(index: number): readonly InventoryItem[] {
    const values = this.lineValues();
    const own = values[index]?.itemId;
    const usedElsewhere = new Set(values.filter((_, i) => i !== index).map((line) => line.itemId));

    return this.availableItems().filter((item) => item.id === own || !usedElsewhere.has(item.id));
  }

  protected unitFor(index: number): string {
    return this.itemFor(index)?.unitAbbreviation ?? '';
  }

  protected stepFor(index: number): string {
    const item = this.itemFor(index);
    return item !== undefined && isDiscreteUnit(item.unit) ? '1' : '0.001';
  }

  /** Advisory warning; never blocks submission. */
  protected warningFor(index: number): string | null {
    const item = this.itemFor(index);
    const value = this.lineValues()[index];

    if (item === undefined || value === undefined) {
      return null;
    }

    const quantity = Number(value.quantity);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return 'Enter a quantity greater than zero.';
    }

    if (isDiscreteUnit(item.unit) && !Number.isInteger(quantity)) {
      return `${item.name} is counted in whole ${item.unitAbbreviation}.`;
    }

    if (quantity > item.currentQuantity) {
      return `Only ${item.displayQuantity} available — approval will fail unless more arrives.`;
    }

    return null;
  }

  private itemFor(index: number): InventoryItem | undefined {
    const itemId = this.lineValues()[index]?.itemId;
    return this.availableItems().find((item) => item.id === itemId);
  }

  private syncLineValues(): void {
    this.lineValues.set(this.lines.controls.map((group) => group.getRawValue() as LineForm));
  }

  protected save(): void {
    this.formError.set(null);

    if (this.lines.length === 0) {
      this.formError.set('Add at least one item to transfer.');
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError.set('Check the quantities below.');
      return;
    }

    // Blocks only what can never succeed; an over-quantity request is allowed through.
    const blocking = this.lineValues().some((_, index) => {
      const warning = this.warningFor(index);
      return warning !== null && !warning.startsWith('Only ');
    });

    if (blocking) {
      this.formError.set('Fix the highlighted lines.');
      return;
    }

    if (this.saving()) {
      return;
    }

    this.saving.set(true);
    this.form.disable();

    const notes = this.form.controls.notes.value.trim();

    this.transfers
      .create({
        lines: this.lineValues().map((line) => ({
          itemId: line.itemId,
          quantity: Number(line.quantity),
        })),
        ...(notes.length > 0 && { notes }),
      })
      .subscribe({
        next: (transfer) => this.dialogRef.close(transfer),
        error: (error: AppError) => {
          this.saving.set(false);
          this.form.enable();

          const unmatched = applyServerErrors(this.form, error);
          this.formError.set(unmatched[0] ?? error.message);
        },
      });
  }
}
