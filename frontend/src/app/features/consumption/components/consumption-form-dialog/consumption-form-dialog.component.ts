import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type FormArray,
  type FormGroup,
} from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { catchError, of } from 'rxjs';
import type { AppError } from '../../../../core/errors/app-error';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import { DialogShellComponent } from '../../../../shared/components/dialog-shell/dialog-shell.component';
import { SubmitButtonComponent } from '../../../../shared/components/submit-button/submit-button.component';
import { InlineAlertComponent } from '../../../../shared/components/inline-alert/inline-alert.component';
import { MATERIAL_FORM_IMPORTS } from '../../../../shared/material/material-imports';
import { applyServerErrors } from '../../../../shared/utils/form.utils';
import {
  INVENTORY_LOCATION_OPTIONS,
  isDiscreteUnit,
  type InventoryItem,
} from '../../../inventory/models/inventory.model';
import { InventoryService } from '../../../inventory/services/inventory.service';
import {
  entryUnitsFor,
  toItemUnit,
  type ConsumptionEntry,
  type ConsumptionResult,
  type EntryUnitOption,
} from '../../models/consumption.model';
import { ConsumptionService } from '../../services/consumption.service';

/** `entry` present means edit; absent means record a new sheet. */
export interface ConsumptionFormDialogData {
  readonly entry?: ConsumptionEntry;
}

/** One editable row. `entryUnit` is what the user typed in, not what is stored. */
interface LineValue {
  itemId: string;
  quantity: number;
  entryUnit: string;
  notes: string;
}

const MAX_LINES = 100;

/**
 * Record or correct a day's consumption.
 *
 * **Quantities can be typed in grams or millilitres.** A kitchen uses 500 g of Nutella
 * from a stock room that counts kilograms, and making someone convert that to 0.5 kg in
 * their head is where a decimal point goes missing. Each row offers the item's own unit
 * plus a finer sibling where one exists, and converts before sending — so the record
 * holds one canonical figure in the item's unit rather than two competing ones.
 *
 * **Editing sends the whole sheet.** The server computes the stock movement as a diff
 * against what is stored, which is why removing a row is expressed by its absence rather
 * than by a delete instruction.
 */
@Component({
  selector: 'pb-consumption-form-dialog',
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
      [title]="isEdit() ? 'Edit consumption' : 'Record consumption'"
      subtitle="Stock comes off when you save"
      icon="consumption"
    >
      @if (loading()) {
        <pb-spinner size="md" label="Loading stock…" />
      } @else if (items().length === 0) {
        <pb-empty-state
          icon="inventory_2"
          title="No stock to consume"
          message="Add inventory items before recording what the kitchen used."
        />
      } @else {
        <form [formGroup]="form" class="pb-form flex flex-col gap-pb-3" novalidate>
          @if (formError(); as message) {
            <pb-inline-alert [message]="message" />
          }

          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Date used</mat-label>
              <input matInput type="date" formControlName="entryDate" required />
              <mat-hint>The day the stock was used</mat-hint>
            </mat-form-field>

            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Location</mat-label>
              <mat-select formControlName="location" required>
                @for (option of locationOptions; track option.value) {
                  <mat-option [value]="option.value">{{ option.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>

          <div formArrayName="lines" class="pb-form flex flex-col gap-pb-3">
            @for (group of lineControls; track $index) {
              <div [formGroupName]="$index" class="rounded-lg border border-outline-variant p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <span class="text-pb-body font-medium">Item {{ $index + 1 }}</span>
                  <button
                    matIconButton
                    type="button"
                    aria-label="Remove this item"
                    [disabled]="lineControls.length === 1"
                    (click)="removeLine($index)"
                  >
                    <mat-icon>delete_outline</mat-icon>
                  </button>
                </div>

                <div class="grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <mat-form-field class="sm:col-span-6">
                    <mat-label>Item</mat-label>
                    <mat-select formControlName="itemId" required>
                      @for (item of items(); track item.id) {
                        <mat-option [value]="item.id">
                          {{ item.name }} ({{ item.currentQuantity }} {{ item.unitAbbreviation }} in
                          stock)
                        </mat-option>
                      }
                    </mat-select>
                  </mat-form-field>

                  <mat-form-field class="sm:col-span-3">
                    <mat-label>Used</mat-label>
                    <input
                      matInput
                      type="number"
                      inputmode="decimal"
                      formControlName="quantity"
                      min="0"
                      [step]="stepAt($index)"
                      required
                    />
                  </mat-form-field>

                  <mat-form-field class="sm:col-span-3">
                    <mat-label>Unit</mat-label>
                    <mat-select formControlName="entryUnit">
                      @for (option of unitOptionsAt($index); track option.value) {
                        <mat-option [value]="option.value">{{ option.label }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                </div>

                <!-- Shown only when the typed unit is not the stored one, so the user can
                     see what will actually be recorded before saving. -->
                @if (conversionHintAt($index); as hint) {
                  <p class="mt-1 text-on-surface-variant text-pb-caption">{{ hint }}</p>
                }

                <!-- Warned, not blocked: the server holds the authoritative figure under a
                     row lock, and stock may well have arrived since this list was loaded. -->
                @if (shortfallAt($index); as warning) {
                  <p class="mt-1 text-error text-pb-caption">{{ warning }}</p>
                }
              </div>
            }
          </div>

          <div>
            <button
              matButton="outlined"
              type="button"
              [disabled]="lineControls.length >= maxLines"
              (click)="addLine()"
            >
              <mat-icon>add</mat-icon>
              Add item
            </button>
          </div>

          <mat-form-field subscriptSizing="dynamic">
            <mat-label>Notes</mat-label>
            <textarea matInput formControlName="notes" rows="2" maxlength="1000"></textarea>
          </mat-form-field>

          @if (isEdit()) {
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Reason for the change</mat-label>
              <input matInput formControlName="note" maxlength="500" autocomplete="off" />
              <mat-hint>Recorded in this entry's history</mat-hint>
            </mat-form-field>
          }
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
        [label]="isEdit() ? 'Save changes' : 'Record'"
        icon="check"
        [busy]="saving()"
        [disabled]="items().length === 0"
        [minWidth]="160"
        (pressed)="save()"
      />
    </pb-dialog-shell>
  `,
})
export class ConsumptionFormDialogComponent {
  readonly dialogRef =
    inject<MatDialogRef<ConsumptionFormDialogComponent, ConsumptionResult | undefined>>(
      MatDialogRef,
    );
  private readonly data = inject<ConsumptionFormDialogData>(MAT_DIALOG_DATA, { optional: true });
  private readonly service = inject(ConsumptionService);
  private readonly inventory = inject(InventoryService);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly locationOptions = INVENTORY_LOCATION_OPTIONS;
  protected readonly maxLines = MAX_LINES;

  private readonly existing = this.data?.entry ?? null;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly items = signal<readonly InventoryItem[]>([]);

  /**
   * A mirror of the `FormArray` values as a signal.
   *
   * `FormArray` is not signal-based, so the per-row unit options, step and conversion
   * hint cannot derive from it directly. Every mutation calls `syncLines()`, which is the
   * one place that copies the array across.
   */
  private readonly lineValues = signal<readonly LineValue[]>([]);

  protected readonly form = this.formBuilder.nonNullable.group({
    entryDate: [this.existing?.entryDate ?? this.today(), [Validators.required]],
    location: [this.existing?.location ?? 'HOME_WAREHOUSE', [Validators.required]],
    notes: [this.existing?.notes ?? ''],
    note: [''],
    lines: this.formBuilder.array<FormGroup>([]),
  });

  protected readonly isEdit = computed(() => this.existing !== null);

  constructor() {
    this.loadItems();
  }

  protected get lineControls(): FormGroup[] {
    return this.lines.controls;
  }

  private get lines(): FormArray<FormGroup> {
    return this.form.controls.lines;
  }

  private itemAt(index: number): InventoryItem | undefined {
    const line = this.lineValues()[index];
    return line === undefined ? undefined : this.items().find((item) => item.id === line.itemId);
  }

  protected unitOptionsAt(index: number): readonly EntryUnitOption[] {
    const item = this.itemAt(index);

    return item === undefined
      ? []
      : entryUnitsFor(item.unit, item.unitAbbreviation, isDiscreteUnit(item.unit));
  }

  private optionAt(index: number): EntryUnitOption | undefined {
    const line = this.lineValues()[index];
    return this.unitOptionsAt(index).find((option) => option.value === line?.entryUnit);
  }

  protected stepAt(index: number): string {
    const option = this.optionAt(index);

    if (option === undefined) {
      return '0.001';
    }

    // Whole numbers for discrete units; grams and millilitres are counted whole too,
    // because a tenth of a gram is not something anyone weighs on a kitchen scale.
    return option.wholeOnly || option.factor !== 1 ? '1' : '0.001';
  }

  /** "= 0.5 kg recorded" — only when the typed unit differs from the stored one. */
  protected conversionHintAt(index: number): string | null {
    const line = this.lineValues()[index];
    const item = this.itemAt(index);
    const option = this.optionAt(index);

    if (line === undefined || item === undefined || option === undefined || option.factor === 1) {
      return null;
    }

    const converted = toItemUnit(Number(line.quantity), option);
    return `= ${String(converted)} ${item.unitAbbreviation} recorded`;
  }

  /**
   * Warns when a row asks for more than the list says is on the shelf.
   *
   * Advisory only: the server checks against a locked row, and stock may have arrived
   * since this dropdown was populated. Blocking here would refuse valid entries on stale
   * data; saying nothing would let an obvious typo reach a server error.
   */
  protected shortfallAt(index: number): string | null {
    const line = this.lineValues()[index];
    const item = this.itemAt(index);
    const option = this.optionAt(index);

    if (line === undefined || item === undefined || option === undefined) {
      return null;
    }

    const wanted = toItemUnit(Number(line.quantity), option);

    // On an edit the previously recorded amount is already deducted, so the shelf figure
    // shown includes it — comparing naively would warn about a quantity that is not
    // actually a shortfall.
    const alreadyRecorded =
      this.existing?.lines.find((existingLine) => existingLine.itemId === item.id)?.quantity ?? 0;

    const available = item.currentQuantity + alreadyRecorded;

    return wanted > available
      ? `Only ${String(available)} ${item.unitAbbreviation} available.`
      : null;
  }

  protected addLine(): void {
    if (this.lines.length >= MAX_LINES) {
      return;
    }

    this.pushLine({ itemId: '', quantity: 1, entryUnit: '', notes: '' });
    this.syncLines();
  }

  protected removeLine(index: number): void {
    // The last row stays: an entry with no items is rejected by the API, and an empty
    // form with an "Add item" button is a worse starting point than one row.
    if (this.lines.length === 1) {
      return;
    }

    this.lines.removeAt(index);
    this.syncLines();
  }

  protected save(): void {
    this.formError.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError.set('Fill in the highlighted fields.');
      return;
    }

    const problem = this.validateLines();

    if (problem !== null) {
      this.formError.set(problem);
      return;
    }

    if (this.saving()) {
      return;
    }

    /*
     * Snapshot the rows *before* disabling the form.
     *
     * `disable()` emits `valueChanges` on every control, which re-runs the item-changed
     * handler below and resets each row's entry unit. Reading the values afterwards
     * therefore loses a "g" selection and sends the typed number as kilograms — 500 g
     * became 500 kg, which the server rightly refused. Capturing first makes the submitted
     * values exactly the ones on screen.
     */
    const lines = this.lineValues();
    const unitOptions = lines.map((_line, index) => this.unitOptionsAt(index));

    this.saving.set(true);
    this.form.disable();

    const value = this.form.getRawValue();
    const notes = value.notes.trim();
    const note = value.note.trim();

    const request = {
      entryDate: value.entryDate,
      location: value.location,
      ...(notes.length > 0 && { notes }),
      lines: lines.map((line, index) => {
        const option = unitOptions[index]?.find((o) => o.value === line.entryUnit);
        const lineNotes = line.notes.trim();

        return {
          itemId: line.itemId,
          // Converted here, so the server only ever sees the item's own unit.
          quantity:
            option === undefined
              ? Number(line.quantity)
              : toItemUnit(Number(line.quantity), option),
          ...(lineNotes.length > 0 && { notes: lineNotes }),
        };
      }),
    };

    const request$ =
      this.existing === null
        ? this.service.record(request)
        : this.service.update(this.existing.id, {
            ...request,
            ...(note.length > 0 && { note }),
          });

    request$.subscribe({
      next: (result) => this.dialogRef.close(result),
      error: (error: AppError) => {
        this.saving.set(false);
        this.form.enable();

        const unmatched = applyServerErrors(this.form, error);
        this.formError.set(unmatched[0] ?? error.message);
      },
    });
  }

  /** The rules the form's own validators cannot express, checked before a round trip. */
  private validateLines(): string | null {
    const lines = this.lineValues();

    if (lines.length === 0) {
      return 'Add at least one item.';
    }

    const seen = new Set<string>();

    for (const [index, line] of lines.entries()) {
      const position = index + 1;

      if (line.itemId === '') {
        return `Item ${String(position)}: choose an item.`;
      }

      const option = this.unitOptionsAt(index).find((o) => o.value === line.entryUnit);
      const quantity =
        option === undefined ? Number(line.quantity) : toItemUnit(Number(line.quantity), option);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        return `Item ${String(position)}: enter a quantity greater than zero.`;
      }

      // The API rejects the same item twice on one sheet, so it is caught here with the
      // row number attached rather than as an opaque conflict.
      if (seen.has(line.itemId)) {
        const name = this.items().find((item) => item.id === line.itemId)?.name ?? 'That item';
        return `${name} is on the sheet twice. Combine the amounts into one row.`;
      }

      seen.add(line.itemId);
    }

    return null;
  }

  private pushLine(value: LineValue): void {
    const group = this.formBuilder.nonNullable.group({
      itemId: [value.itemId, [Validators.required]],
      quantity: [value.quantity, [Validators.required, Validators.min(0)]],
      entryUnit: [value.entryUnit],
      notes: [value.notes],
    });

    /*
     * Choosing an item decides which units the row may be entered in, so the selected unit
     * has to follow it. Without this, picking a litre-tracked item after a kilogram-tracked
     * one would leave "g" selected and silently record a thousandth of the intended amount.
     *
     * Guarded on the id actually changing. `valueChanges` also fires when the form is
     * disabled or enabled, and resetting the unit on those would silently discard a
     * deliberate "g" selection at exactly the moment the value is about to be submitted.
     */
    let lastItemId = value.itemId;

    group.controls.itemId.valueChanges.subscribe((itemId) => {
      if (itemId !== lastItemId) {
        lastItemId = itemId;

        const item = this.items().find((candidate) => candidate.id === itemId);

        if (item !== undefined) {
          group.controls.entryUnit.setValue(item.unit, { emitEvent: false });
        }
      }

      this.syncLines();
    });

    group.valueChanges.subscribe(() => {
      this.syncLines();
    });

    this.lines.push(group);
  }

  private syncLines(): void {
    this.lineValues.set(this.lines.controls.map((group) => group.getRawValue() as LineValue));
  }

  private loadItems(): void {
    this.inventory
      .listAllSelectable()
      .pipe(catchError(() => of<readonly InventoryItem[]>([])))
      .subscribe((items) => {
        this.items.set(items);
        this.loading.set(false);

        if (this.existing === null) {
          this.addLine();
          return;
        }

        // Rehydrate the sheet in the item's own unit. The original entry unit is not
        // stored — only the canonical figure is — so an edit starts from that rather than
        // guessing that "0.5 kg" was once typed as "500 g".
        for (const line of this.existing.lines) {
          this.pushLine({
            itemId: line.itemId,
            quantity: line.quantity,
            entryUnit: line.unit,
            notes: line.notes ?? '',
          });
        }

        this.syncLines();
      });
  }

  /** Today in `YYYY-MM-DD`, from local components — the user means their own date. */
  private today(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${String(now.getFullYear())}-${month}-${day}`;
  }
}
