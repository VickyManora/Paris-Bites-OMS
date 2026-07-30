import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type FormArray,
  type FormGroup,
} from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import type { AppError } from '../../../../core/errors/app-error';
import { NotificationService } from '../../../../core/services/notification.service';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import {
  FormStepsComponent,
  type FormStep,
} from '../../../../shared/components/form-steps/form-steps.component';
import { InlineAlertComponent } from '../../../../shared/components/inline-alert/inline-alert.component';
import { SubmitButtonComponent } from '../../../../shared/components/submit-button/submit-button.component';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import {
  MATERIAL_CORE_IMPORTS,
  MATERIAL_FORM_IMPORTS,
} from '../../../../shared/material/material-imports';
import { applyServerErrors } from '../../../../shared/utils/form.utils';
import {
  INVENTORY_CATEGORY_OPTIONS,
  INVENTORY_UNIT_OPTIONS,
  type InventoryItem,
} from '../../../inventory/models/inventory.model';
import { InventoryService } from '../../../inventory/services/inventory.service';
import type { SupplierOption } from '../../../suppliers/models/supplier.model';
import { SupplierService } from '../../../suppliers/services/supplier.service';
import {
  computeGstTotals,
  EMPTY_GST_TOTALS,
  GST_RATES,
  GST_TREATMENT_LABELS,
  predictGstTreatment,
  type CreatePurchaseLineRequest,
  type CreatePurchaseRequest,
  type GstTreatment,
} from '../../models/purchase.model';
import { PurchaseService } from '../../services/purchase.service';

/** One editable invoice line. `itemId === NEW_ITEM` switches the row to inline entry. */
const NEW_ITEM = '__new__';

const MAX_LINES = 100;

interface LineValue {
  itemId: string;
  newName: string;
  newCategory: string;
  newUnit: string;
  quantity: number;
  unitRate: number;
  hsnCode: string;
  gstRatePercent: number;
}

/**
 * Record a supplier invoice.
 *
 * A **page**, not a dialog, unlike every other form in the app. An invoice has a header,
 * an unbounded list of lines and a totals block; at three lines it already exceeds a
 * comfortable dialog height, and a dialog that scrolls internally hides the running total
 * that the user is checking against the paper bill in their hand.
 *
 * **The totals are computed locally as you type**, duplicating arithmetic the server also
 * does. That duplication is deliberate and bounded: a purchase form that cannot show a
 * total until it is submitted is one nobody can reconcile against the bill. The server
 * stays authoritative — what it returns is what is stored and shown afterwards.
 *
 * **An item that does not exist yet can be created inline.** Discovering mid-invoice that
 * an ingredient was never set up, and having to leave for the inventory screen and come
 * back, is where data entry gets abandoned half-done.
 */
@Component({
  selector: 'pb-purchase-record-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    PageHeaderComponent,
    CardComponent,
    SpinnerComponent,
    FormStepsComponent,
    InlineAlertComponent,
    SubmitButtonComponent,
    ...MATERIAL_CORE_IMPORTS,
    ...MATERIAL_FORM_IMPORTS,
  ],
  template: `
    <pb-page-header
      title="Record purchase"
      subtitle="Enter a supplier invoice. Stock is added when you save."
    />

    @if (loading()) {
      <pb-spinner size="md" label="Loading suppliers and stock…" />
    } @else if (loadError(); as message) {
      <!-- Shown instead of the form, not alongside it: a purchase form whose item picker
           failed to load is not a form anyone can complete. -->
      <pb-inline-alert title="Could not load suppliers and stock" [message]="message">
        <button slot="actions" matButton="filled" type="button" (click)="retry()">Try again</button>
        <button slot="actions" matButton type="button" (click)="cancel()">Back</button>
      </pb-inline-alert>
    } @else {
      <form [formGroup]="form" class="pb-form flex flex-col gap-pb-4 pb-24" novalidate>
        <!--
          Stepper-style progress, deliberately not a gated stepper.

          Recording a purchase means entering the invoice, then the lines, and watching the totals
          change as you type — the GST split derives from the supplier and the line rates, and checking
          it against the paper invoice is the whole point. A MatStepper would put the totals behind
          "next" and hide the number the task is about. This borrows the stepper's language — numbered
          stages, ticks, a connector — and keeps everything on one page and reachable.
        -->
        <pb-form-steps
          [steps]="steps()"
          ariaLabel="Purchase progress"
          (stepSelect)="scrollToStep($event)"
        />

        @if (formError(); as message) {
          <pb-inline-alert [message]="message" />
        }

        <!-- Invoice header -->
        <pb-card id="step-invoice" dense title="Invoice" subtitle="Who it is from, and when">
          <div class="grid grid-cols-1 gap-pb-3 sm:grid-cols-2 lg:grid-cols-3">
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Supplier</mat-label>
              <mat-select formControlName="supplierId" required>
                @for (option of supplierOptions(); track option.id) {
                  <mat-option [value]="option.id">{{ option.name }}</mat-option>
                }
              </mat-select>
              @if (supplierOptions().length === 0) {
                <mat-hint>No suppliers yet — add one first</mat-hint>
              }
            </mat-form-field>

            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Invoice number</mat-label>
              <input
                matInput
                formControlName="invoiceNumber"
                maxlength="64"
                required
                autocomplete="off"
              />
              <mat-hint>The supplier's number, not ours</mat-hint>
            </mat-form-field>

            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Invoice date</mat-label>
              <input matInput type="date" formControlName="invoiceDate" required />
            </mat-form-field>
          </div>

          <!-- The treatment is derived from the supplier, so it is shown rather than
               chosen: offering it as a field would let someone file IGST on a local
               invoice, and the server would overrule them anyway. -->
          @if (selectedSupplier(); as supplier) {
            <div
              class="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-surface-container px-3 py-2"
            >
              <mat-icon class="!h-5 !w-5 !text-xl" aria-hidden="true">receipt_long</mat-icon>
              <span class="text-pb-caption">
                {{ supplier.stateName }} · {{ supplier.gstin ?? 'no GSTIN' }} →
                <strong>{{ treatmentLabel() }}</strong>
              </span>
            </div>
          }

          <mat-form-field class="mt-3 w-full">
            <mat-label>Notes</mat-label>
            <textarea matInput formControlName="notes" rows="2" maxlength="1000"></textarea>
          </mat-form-field>
        </pb-card>

        <!-- Lines -->
        <pb-card id="step-items" dense title="Items" subtitle="What the invoice is for">
          <div formArrayName="lines" class="flex flex-col gap-3">
            @for (group of lineControls; track $index) {
              <div [formGroupName]="$index" class="rounded-lg border border-outline-variant p-3">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <span class="text-pb-body font-medium">Line {{ $index + 1 }}</span>
                  <button
                    matIconButton
                    type="button"
                    aria-label="Remove this line"
                    [disabled]="lineControls.length === 1"
                    (click)="removeLine($index)"
                  >
                    <mat-icon>delete_outline</mat-icon>
                  </button>
                </div>

                <!--
                  Stacked on a phone, paired on a tablet, one dense row only where it fits.

                  This went to twelve columns at lg, which is 1024px — where the sidebar rail
                  still takes 72px, leaving each column about 70px. The line total on a single
                  column was measured at 59px, too narrow for "₹1,234.00", and Quantity and Rate
                  had 140px each to hold a number, a unit suffix and a currency prefix. Twelve
                  columns need roughly 1280px to be worth having, so that is where they start now.
                -->
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-12">
                  <mat-form-field class="sm:col-span-2 xl:col-span-4">
                    <mat-label>Item</mat-label>
                    <mat-select formControlName="itemId" required>
                      <mat-option [value]="newItemValue">+ New item…</mat-option>
                      @for (item of items(); track item.id) {
                        <mat-option [value]="item.id">
                          {{ item.name }} ({{ item.unitAbbreviation }})
                        </mat-option>
                      }
                    </mat-select>
                  </mat-form-field>

                  <mat-form-field class="xl:col-span-2">
                    <mat-label>Quantity</mat-label>
                    <input
                      matInput
                      type="number"
                      inputmode="decimal"
                      formControlName="quantity"
                      min="0"
                      step="0.001"
                      required
                    />
                    <span matTextSuffix>{{ unitLabelAt($index) }}</span>
                  </mat-form-field>

                  <mat-form-field class="xl:col-span-2">
                    <mat-label>Rate</mat-label>
                    <input
                      matInput
                      type="number"
                      inputmode="decimal"
                      formControlName="unitRate"
                      min="0"
                      step="0.01"
                      required
                    />
                    <span matTextPrefix>₹&nbsp;</span>
                  </mat-form-field>

                  <mat-form-field class="xl:col-span-2">
                    <mat-label>GST</mat-label>
                    <mat-select formControlName="gstRatePercent">
                      @for (rate of gstRates; track rate) {
                        <mat-option [value]="rate">{{ rate }}%</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>

                  <div
                    class="flex min-w-[7rem] items-center sm:col-span-2 sm:justify-end xl:col-span-2"
                  >
                    <span class="w-full text-right font-medium tabular-nums text-pb-caption">
                      ₹{{ lineTotalAt($index) | number: '1.2-2' }}
                    </span>
                  </div>
                </div>

                <!-- Inline new-item fields, shown only for the "+ New item…" choice. -->
                @if (isNewItemAt($index)) {
                  <div
                    class="mt-2 grid grid-cols-1 gap-3 rounded-lg bg-surface-container p-3 sm:grid-cols-3"
                  >
                    <mat-form-field subscriptSizing="dynamic">
                      <mat-label>New item name</mat-label>
                      <input
                        matInput
                        formControlName="newName"
                        maxlength="120"
                        autocomplete="off"
                      />
                    </mat-form-field>
                    <mat-form-field subscriptSizing="dynamic">
                      <mat-label>Category</mat-label>
                      <mat-select formControlName="newCategory">
                        @for (option of categoryOptions; track option.value) {
                          <mat-option [value]="option.value">{{ option.label }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                    <mat-form-field subscriptSizing="dynamic">
                      <mat-label>Unit</mat-label>
                      <mat-select formControlName="newUnit">
                        @for (option of unitOptions; track option.value) {
                          <mat-option [value]="option.value">{{ option.label }}</mat-option>
                        }
                      </mat-select>
                    </mat-form-field>
                  </div>
                }

                <mat-form-field class="mt-2 !w-full sm:!w-48">
                  <mat-label>HSN code</mat-label>
                  <input matInput formControlName="hsnCode" maxlength="8" autocomplete="off" />
                  <mat-hint>Optional · 4–8 digits</mat-hint>
                </mat-form-field>
              </div>
            }
          </div>

          <button
            matButton="outlined"
            type="button"
            class="mt-3"
            [disabled]="lineControls.length >= maxLines"
            (click)="addLine()"
          >
            <mat-icon>add</mat-icon>
            Add line
          </button>
        </pb-card>

        <!-- Live totals -->
        <pb-card id="step-totals" dense title="Totals" subtitle="Checked here, recomputed on save">
          <dl class="ml-auto flex max-w-xs flex-col gap-1 text-pb-caption">
            <div class="flex justify-between">
              <dt class="text-on-surface-variant">Subtotal</dt>
              <dd class="tabular-nums">₹{{ totals().subtotal | number: '1.2-2' }}</dd>
            </div>
            @if (treatment() === 'INTRA_STATE') {
              <div class="flex justify-between">
                <dt class="text-on-surface-variant">CGST</dt>
                <dd class="tabular-nums">₹{{ totals().cgst | number: '1.2-2' }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-on-surface-variant">SGST</dt>
                <dd class="tabular-nums">₹{{ totals().sgst | number: '1.2-2' }}</dd>
              </div>
            }
            @if (treatment() === 'INTER_STATE') {
              <div class="flex justify-between">
                <dt class="text-on-surface-variant">IGST</dt>
                <dd class="tabular-nums">₹{{ totals().igst | number: '1.2-2' }}</dd>
              </div>
            }
            @if (treatment() === 'UNREGISTERED') {
              <div class="flex justify-between">
                <dt class="text-on-surface-variant">GST</dt>
                <dd>Not applicable</dd>
              </div>
            }
            <div
              class="mt-1 flex justify-between border-t border-outline-variant pt-1 font-medium text-pb-subtitle"
            >
              <dt>Total</dt>
              <dd class="tabular-nums">₹{{ totals().total | number: '1.2-2' }}</dd>
            </div>
          </dl>

          <p class="mt-2 text-right text-on-surface-variant text-pb-caption">
            Calculated here for checking; the server recomputes and stores the final figures.
          </p>
        </pb-card>

        <!--
          A pinned footer, which this form has earned: it is the one form in the app long enough to
          scroll past its own submit button. On a ten-line invoice the "Record purchase" button sat
          roughly two screens below the fold, so the way to save was to scroll to the bottom — and the
          totals you were checking scrolled away with it.

          'sticky bottom-0' rather than 'fixed': the footer belongs to the form's own scroll context,
          so it stops at the end of the form instead of hovering over the page below it. The negative
          margins let it span the page gutters, and the form's own 'pb-pb-8' reserves the height it
          occupies so the last field is never trapped underneath.
        -->
        <div
          class="sticky bottom-0 z-10 -mx-pb-3 -mb-24 flex flex-col-reverse gap-pb-2 border-t border-outline-variant bg-surface px-pb-3 py-pb-3 shadow-pb-sm sm:-mx-pb-4 sm:flex-row sm:items-center sm:px-pb-4 lg:-mx-pb-5 lg:px-pb-5"
        >
          <!-- The running total travels with the button, so what you are committing to is legible at
               the moment you commit to it. -->
          <p class="m-0 text-pb-caption text-on-surface-variant sm:mr-auto">
            {{ lineCount() }} {{ lineCount() === 1 ? 'line' : 'lines' }} ·
            <span class="text-pb-subtitle tabular-nums text-on-surface">{{
              grandTotalLabel()
            }}</span>
          </p>

          <button matButton type="button" [disabled]="saving()" (click)="cancel()">Cancel</button>
          <pb-submit-button
            label="Record purchase"
            busyLabel="Recording…"
            icon="check"
            [busy]="saving()"
            [minWidth]="180"
            (pressed)="save()"
          />
        </div>
      </form>
    }
  `,
})
export class PurchaseRecordPage {
  private readonly purchases = inject(PurchaseService);
  private readonly supplierService = inject(SupplierService);
  private readonly inventory = inject(InventoryService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  protected readonly newItemValue = NEW_ITEM;
  protected readonly maxLines = MAX_LINES;
  protected readonly gstRates = GST_RATES;
  protected readonly categoryOptions = INVENTORY_CATEGORY_OPTIONS;
  protected readonly unitOptions = INVENTORY_UNIT_OPTIONS;

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly supplierOptions = signal<readonly SupplierOption[]>([]);
  protected readonly items = signal<readonly InventoryItem[]>([]);

  private readonly businessStateCode = signal<string | null>(null);

  /**
   * A mirror of the `FormArray`'s values as a signal.
   *
   * `FormArray` is not signal-based, so the running totals and the per-row unit suffix
   * cannot derive from it directly. Every mutation calls `syncLines()`, which is the one
   * place that copies the array into this signal.
   */
  private readonly lineValues = signal<readonly LineValue[]>([]);

  protected readonly form = this.formBuilder.nonNullable.group({
    supplierId: ['', [Validators.required]],
    invoiceNumber: ['', [Validators.required, Validators.maxLength(64)]],
    invoiceDate: [this.today(), [Validators.required]],
    notes: [''],
    lines: this.formBuilder.array<FormGroup>([]),
  });

  private readonly supplierIdValue = toSignal(this.form.controls.supplierId.valueChanges, {
    initialValue: this.form.controls.supplierId.value,
  });

  protected readonly selectedSupplier = computed(() =>
    this.supplierOptions().find((option) => option.id === this.supplierIdValue()),
  );

  /**
   * The treatment the server will apply, predicted from the supplier.
   *
   * Null until a supplier is chosen, which is why the totals show no tax lines yet — an
   * arbitrary default would show a CGST split that changes the moment a supplier is picked.
   */
  protected readonly treatment = computed<GstTreatment | null>(() => {
    const supplier = this.selectedSupplier();
    const businessState = this.businessStateCode();

    if (supplier === undefined || businessState === null) {
      return null;
    }

    return predictGstTreatment(supplier.gstin, supplier.stateCode, businessState);
  });

  protected readonly treatmentLabel = computed(() => {
    const treatment = this.treatment();
    return treatment === null ? 'Working it out…' : GST_TREATMENT_LABELS[treatment];
  });

  protected readonly totals = computed(() =>
    this.lineValues().length === 0
      ? EMPTY_GST_TOTALS
      : computeGstTotals(this.lineValues(), this.treatment()),
  );

  /**
   * How far through the form the user is.
   *
   * Completion is claimed here rather than inferred from `FormGroup.valid`, for the reason
   * `pb-form-steps` documents: the invoice section is done once it has a supplier, a number and a
   * date, even though `notes` is empty and always will be. Reading `valid` off the group would mark it
   * incomplete for a reason nobody can see.
   *
   * "Totals" is complete when there is anything to total, because the section is a readout — there is
   * nothing in it for the user to finish.
   */
  protected readonly steps = computed<readonly FormStep[]>(() => {
    const controls = this.form.controls;
    const lineCount = this.lineValues().length;
    const invoiceDone =
      controls.supplierId.valid && controls.invoiceNumber.valid && controls.invoiceDate.valid;

    return [
      {
        id: 'step-invoice',
        label: 'Invoice',
        hint: this.selectedSupplier()?.name ?? 'Pick a supplier',
        complete: invoiceDone,
      },
      {
        id: 'step-items',
        label: 'Items',
        hint: lineCount === 0 ? 'Nothing added yet' : `${String(lineCount)} added`,
        complete: lineCount > 0 && this.lines.valid,
      },
      {
        id: 'step-totals',
        label: 'Totals',
        hint: lineCount === 0 ? 'Waiting on items' : this.grandTotalLabel(),
        // Gated on the same condition as Items, not merely on there being lines. A default empty line
        // makes `lineCount` 1 while the line is still invalid, which had Totals showing a tick beside
        // an incomplete Items — the progress contradicting itself.
        complete: lineCount > 0 && this.lines.valid,
      },
    ];
  });

  protected readonly lineCount = computed(() => this.lineValues().length);

  /** The figure the footer shows beside Record purchase. */
  protected readonly grandTotalLabel = computed(
    () => `₹${this.totals().total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
  );

  constructor() {
    this.loadReferenceData();
  }

  /**
   * Scrolls a section into view when its step is pressed.
   *
   * `scrollIntoView` on the section rather than a router fragment: the page lives inside
   * `mat-sidenav-content`, which is the actual scroll container, and a fragment link would ask the
   * document to scroll instead — the same mistake the shell's own scroll listener had to avoid.
   */
  protected scrollToStep(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected get lineControls(): FormGroup[] {
    return this.lines.controls;
  }

  private get lines(): FormArray<FormGroup> {
    return this.form.controls.lines;
  }

  protected isNewItemAt(index: number): boolean {
    return this.lineValues()[index]?.itemId === NEW_ITEM;
  }

  /** The unit suffix beside a quantity, so "10" is never ambiguous between kg and packets. */
  protected unitLabelAt(index: number): string {
    const line = this.lineValues()[index];

    if (line === undefined || line.itemId === NEW_ITEM || line.itemId === '') {
      return '';
    }

    return this.items().find((item) => item.id === line.itemId)?.unitAbbreviation ?? '';
  }

  protected lineTotalAt(index: number): number {
    const line = this.lineValues()[index];

    if (line === undefined) {
      return 0;
    }

    return computeGstTotals([line], this.treatment()).total;
  }

  protected addLine(): void {
    if (this.lines.length >= MAX_LINES) {
      return;
    }

    const group = this.formBuilder.nonNullable.group({
      itemId: ['', [Validators.required]],
      newName: [''],
      newCategory: ['TOPPINGS_AND_FLAVOURS'],
      newUnit: ['KG'],
      quantity: [1, [Validators.required, Validators.min(0.001)]],
      unitRate: [0, [Validators.required, Validators.min(0)]],
      hsnCode: [''],
      gstRatePercent: [0],
    });

    group.valueChanges.subscribe(() => {
      this.syncLines();
    });

    this.lines.push(group);
    this.syncLines();
  }

  protected removeLine(index: number): void {
    // The last line is not removable: an invoice with no lines is rejected by the API, and
    // an empty form with an "Add line" button is a worse starting point than one row.
    if (this.lines.length === 1) {
      return;
    }

    this.lines.removeAt(index);
    this.syncLines();
  }

  protected retry(): void {
    this.loadError.set(null);
    this.loading.set(true);
    this.loadReferenceData();
  }

  protected cancel(): void {
    void this.router.navigate(['/purchases']);
  }

  protected save(): void {
    this.formError.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.formError.set('Fill in the highlighted fields.');
      return;
    }

    const lineError = this.validateLines();

    if (lineError !== null) {
      this.formError.set(lineError);
      return;
    }

    if (this.saving()) {
      return;
    }

    this.saving.set(true);
    this.form.disable();

    this.purchases.create(this.toRequest()).subscribe({
      next: (result) => {
        const moved = result.effects.length;
        this.notifications.success(
          `Invoice ${result.purchase.invoiceNumber} recorded — stock updated for ` +
            `${String(moved)} ${moved === 1 ? 'item' : 'items'}.`,
        );
        void this.router.navigate(['/purchases']);
      },
      error: (error: AppError) => {
        this.saving.set(false);
        this.form.enable();

        /*
         * The API namespaces line failures as `body.lines.0.quantity`, which
         * `applyServerErrors` resolves against the matching `FormArray` control — so a bad
         * rate lands under that row's field rather than in a toast the user must map back
         * to a line themselves.
         */
        const unmatched = applyServerErrors(this.form, error);
        this.formError.set(unmatched[0] ?? error.message);
      },
    });
  }

  /**
   * The rules the form's own validators cannot express, checked before a round trip.
   *
   * Each returns the first problem rather than a list: the user fixes one thing and
   * resubmits, and a wall of messages for a six-line invoice is harder to act on.
   */
  private validateLines(): string | null {
    const lines = this.lineValues();

    if (lines.length === 0) {
      return 'Add at least one line to the invoice.';
    }

    const seen = new Set<string>();

    for (const [index, line] of lines.entries()) {
      const position = index + 1;

      if (line.itemId === '') {
        return `Line ${String(position)}: choose an item.`;
      }

      if (line.itemId === NEW_ITEM) {
        if (line.newName.trim().length === 0) {
          return `Line ${String(position)}: name the new item.`;
        }
        continue;
      }

      // The API rejects the same item twice on one invoice — it is a data-entry mistake,
      // not two amounts to sum — so it is caught here with the line number attached.
      if (seen.has(line.itemId)) {
        const name = this.items().find((item) => item.id === line.itemId)?.name ?? 'That item';
        return `${name} is on the invoice twice. Combine the quantities into one line.`;
      }

      seen.add(line.itemId);
    }

    return null;
  }

  private toRequest(): CreatePurchaseRequest {
    const value = this.form.getRawValue();
    const notes = value.notes.trim();

    return {
      supplierId: value.supplierId,
      invoiceNumber: value.invoiceNumber.trim(),
      invoiceDate: value.invoiceDate,
      ...(notes.length > 0 && { notes }),
      lines: this.lineValues().map((line) => this.toLineRequest(line)),
    };
  }

  private toLineRequest(line: LineValue): CreatePurchaseLineRequest {
    const hsnCode = line.hsnCode.trim();

    const base = {
      quantity: Number(line.quantity),
      unitRate: Number(line.unitRate),
      gstRatePercent: Number(line.gstRatePercent),
      ...(hsnCode.length > 0 && { hsnCode }),
    };

    // Exactly one of the two, never both — the API rejects the ambiguity rather than
    // guessing, which would create a duplicate item or price the wrong one.
    return line.itemId === NEW_ITEM
      ? {
          ...base,
          newItem: {
            name: line.newName.trim(),
            category: line.newCategory as CreatePurchaseLineRequest['newItem'] extends undefined
              ? never
              : NonNullable<CreatePurchaseLineRequest['newItem']>['category'],
            unit: line.newUnit as NonNullable<CreatePurchaseLineRequest['newItem']>['unit'],
          },
        }
      : { ...base, itemId: line.itemId };
  }

  private syncLines(): void {
    this.lineValues.set(this.lines.controls.map((group) => group.getRawValue() as LineValue));
  }

  /**
   * Loads the suppliers, the item list and the business's GST state before showing the form.
   *
   * **A failure here is reported, not swallowed.** Defaulting the item list to empty on
   * error renders a form that looks usable and offers nothing to pick — the user retypes
   * their invoice into a dropdown that will never contain their ingredient. Only the GST
   * state degrades quietly, because the form still works without it: the totals show no
   * tax split until it arrives, which is visible rather than misleading.
   */
  private loadReferenceData(): void {
    forkJoin({
      suppliers: this.supplierService.options(),
      items: this.inventory.listAllSelectable(),
      businessStateCode: this.purchases.businessStateCode().pipe(catchError(() => of(''))),
    }).subscribe({
      next: ({ suppliers, items, businessStateCode }) => {
        this.supplierOptions.set(suppliers);
        this.items.set(items);
        this.businessStateCode.set(businessStateCode.length > 0 ? businessStateCode : null);
        this.loading.set(false);

        // One empty row to start: an invoice always has at least one line, and making the
        // user press "Add line" before they can type anything is a pointless first step.
        if (this.lines.length === 0) {
          this.addLine();
        }
      },
      error: (error: AppError) => {
        this.loading.set(false);
        this.loadError.set(error.message);
      },
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
