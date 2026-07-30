import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import type { AppError } from '../../../../core/errors/app-error';
import { Permission } from '../../../../core/models/permission.model';
import { NotificationService } from '../../../../core/services/notification.service';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import { MATERIAL_CORE_IMPORTS } from '../../../../shared/material/material-imports';
import { GstTreatment, type Purchase } from '../../models/purchase.model';
import { PurchaseService } from '../../services/purchase.service';
import { InlineAlertComponent } from '../../../../shared/components/inline-alert/inline-alert.component';

export interface PurchaseDetailDialogData {
  readonly purchase: Purchase;
}

/** Bill formats the API accepts. Mirrors the server's allow-list. */
const ACCEPTED_TYPES = 'application/pdf,image/jpeg,image/png,image/webp';
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * One recorded invoice, in full.
 *
 * Read-only by design: a purchase has already moved stock and money, so a correction is
 * an inventory adjustment rather than an edit — the same rule stock transfers follow, and
 * for the same reason. A document that can be rewritten after it has moved goods makes
 * the stock ledger unreconstructable.
 *
 * The one thing that *can* change is the attached bill, because scanning it is a separate
 * physical step from entering the numbers.
 */
@Component({
  selector: 'pb-purchase-detail-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    InlineAlertComponent,
    DatePipe,
    DecimalPipe,
    MatDialogModule,
    HasPermissionDirective,
    ...MATERIAL_CORE_IMPORTS,
  ],
  template: `
    <h2 mat-dialog-title class="!flex !flex-wrap !items-center !gap-2">
      <span>Invoice {{ purchase().invoiceNumber }}</span>
      <span class="pb-badge pb-badge-pill pb-tone-neutral">{{ purchase().gstTreatmentLabel }}</span>
    </h2>

    <mat-dialog-content>
      <div class="flex flex-col gap-4">
        <!-- Header facts. Two columns from sm; stacked on a phone where a
             label/value pair side by side would wrap awkwardly. -->
        <dl class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt class="text-pb-caption text-on-surface-variant">Supplier</dt>
            <dd class="text-pb-body">{{ purchase().supplierName ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-pb-caption text-on-surface-variant">Invoice date</dt>
            <dd class="text-pb-body">{{ purchase().invoiceDate }}</dd>
          </div>
          <div>
            <dt class="text-pb-caption text-on-surface-variant">Supplier GSTIN</dt>
            <dd class="text-pb-body">{{ purchase().supplierGstin ?? 'Unregistered' }}</dd>
          </div>
          <div>
            <dt class="text-pb-caption text-on-surface-variant">Place of supply</dt>
            <dd class="text-pb-body">{{ purchase().supplierStateName }}</dd>
          </div>
          <div>
            <dt class="text-pb-caption text-on-surface-variant">Recorded by</dt>
            <dd class="text-pb-body">{{ purchase().recordedByName ?? 'System' }}</dd>
          </div>
          <div>
            <dt class="text-pb-caption text-on-surface-variant">Recorded on</dt>
            <dd class="text-pb-body">{{ purchase().createdAt | date: 'medium' }}</dd>
          </div>
        </dl>

        @if (purchase().notes; as notes) {
          <p class="rounded-lg bg-surface-container px-3 py-2 text-pb-caption">{{ notes }}</p>
        }

        <!-- Lines. A table from sm up; a card per line below that, because seven
             numeric columns cannot be read on a 390px screen. -->
        <section>
          <h3 class="mb-2 text-pb-subtitle">
            {{ purchase().lineCount }} {{ purchase().lineCount === 1 ? 'item' : 'items' }}
          </h3>

          <div class="hidden overflow-x-auto sm:block">
            <table class="w-full border-collapse text-left text-pb-caption">
              <thead>
                <tr class="border-b border-outline-variant text-on-surface-variant">
                  <th class="py-2 pr-3 font-medium">Item</th>
                  <th class="py-2 pr-3 text-right font-medium">Qty</th>
                  <th class="py-2 pr-3 text-right font-medium">Rate</th>
                  <th class="py-2 pr-3 text-right font-medium">Taxable</th>
                  <th class="py-2 pr-3 text-right font-medium">GST</th>
                  <th class="py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                @for (line of purchase().lines; track line.id) {
                  <tr class="border-b border-outline-variant/50">
                    <td class="py-2 pr-3">
                      <div>{{ line.itemName }}</div>
                      <div class="text-on-surface-variant text-pb-caption">
                        {{ line.categoryLabel }}
                        @if (line.hsnCode) {
                          · HSN {{ line.hsnCode }}
                        }
                      </div>
                    </td>
                    <td class="py-2 pr-3 text-right tabular-nums">{{ line.displayQuantity }}</td>
                    <td class="py-2 pr-3 text-right tabular-nums">
                      ₹{{ line.unitRate | number: '1.2-2' }}
                    </td>
                    <td class="py-2 pr-3 text-right tabular-nums">
                      ₹{{ line.taxableAmount | number: '1.2-2' }}
                    </td>
                    <td class="py-2 pr-3 text-right tabular-nums">
                      {{ line.gstRatePercent }}%
                      <div class="text-on-surface-variant text-pb-caption">
                        ₹{{
                          lineTax(line.cgstAmount, line.sgstAmount, line.igstAmount)
                            | number: '1.2-2'
                        }}
                      </div>
                    </td>
                    <td class="py-2 text-right font-medium tabular-nums">
                      ₹{{ line.lineTotal | number: '1.2-2' }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <div class="flex flex-col gap-2 sm:hidden">
            @for (line of purchase().lines; track line.id) {
              <div class="rounded-lg border border-outline-variant p-3">
                <div class="font-medium text-pb-body">{{ line.itemName }}</div>
                <div class="text-on-surface-variant text-pb-caption">
                  {{ line.displayQuantity }} × ₹{{ line.unitRate | number: '1.2-2' }} ·
                  {{ line.gstRatePercent }}% GST
                </div>
                <div class="mt-1 text-right font-medium text-pb-body">
                  ₹{{ line.lineTotal | number: '1.2-2' }}
                </div>
              </div>
            }
          </div>
        </section>

        <!-- Totals. Only the tax lines that apply are shown: printing "IGST ₹0.00" on an
             intra-state invoice invites reading it as a missing figure. -->
        <section class="rounded-lg bg-surface-container p-3">
          <dl class="ml-auto flex max-w-xs flex-col gap-1 text-pb-caption">
            <div class="flex justify-between">
              <dt class="text-on-surface-variant">Subtotal</dt>
              <dd class="tabular-nums">₹{{ purchase().subtotal | number: '1.2-2' }}</dd>
            </div>
            @if (isIntraState()) {
              <div class="flex justify-between">
                <dt class="text-on-surface-variant">CGST</dt>
                <dd class="tabular-nums">₹{{ purchase().totalCgst | number: '1.2-2' }}</dd>
              </div>
              <div class="flex justify-between">
                <dt class="text-on-surface-variant">SGST</dt>
                <dd class="tabular-nums">₹{{ purchase().totalSgst | number: '1.2-2' }}</dd>
              </div>
            }
            @if (isInterState()) {
              <div class="flex justify-between">
                <dt class="text-on-surface-variant">IGST</dt>
                <dd class="tabular-nums">₹{{ purchase().totalIgst | number: '1.2-2' }}</dd>
              </div>
            }
            @if (isUnregistered()) {
              <div class="flex justify-between">
                <dt class="text-on-surface-variant">GST</dt>
                <dd>Not applicable</dd>
              </div>
            }
            <div
              class="mt-1 flex justify-between border-t border-outline-variant pt-1 font-medium text-pb-subtitle"
            >
              <dt>Total</dt>
              <dd class="tabular-nums">₹{{ purchase().totalAmount | number: '1.2-2' }}</dd>
            </div>
          </dl>
        </section>

        <!-- The bill itself. -->
        <section class="flex flex-col gap-2">
          <h3 class="text-pb-subtitle">Invoice file</h3>

          @if (uploadError(); as message) {
            <pb-inline-alert [message]="message" />
          }

          @if (purchase().invoiceFile; as file) {
            <div
              class="flex flex-wrap items-center gap-3 rounded-lg border border-outline-variant p-3"
            >
              <mat-icon aria-hidden="true">description</mat-icon>
              <div class="min-w-0 flex-1">
                <div class="truncate text-pb-body">{{ file.fileName }}</div>
                <div class="text-on-surface-variant text-pb-caption">
                  {{ readableSize(file.sizeBytes) }} · uploaded
                  {{ file.uploadedAt | date: 'medium' }}
                </div>
              </div>
              <button matButton type="button" [disabled]="downloading()" (click)="download()">
                <mat-icon>download</mat-icon>
                {{ downloading() ? 'Opening…' : 'Open' }}
              </button>
            </div>
          } @else {
            <p class="text-on-surface-variant text-pb-caption">
              No bill attached yet. The invoice is still recorded — this is the scan for the file.
            </p>
          }

          <div *pbHasPermission="createPermission">
            <input
              #fileInput
              type="file"
              class="hidden"
              [accept]="acceptedTypes"
              (change)="onFileSelected($event)"
            />
            <button
              matButton="outlined"
              type="button"
              [disabled]="uploading()"
              (click)="fileInput.click()"
            >
              <mat-icon>upload_file</mat-icon>
              {{
                uploading()
                  ? 'Uploading…'
                  : purchase().hasInvoiceFile
                    ? 'Replace bill'
                    : 'Attach bill'
              }}
            </button>
            <span class="ml-2 text-on-surface-variant text-pb-caption">
              PDF, JPEG, PNG or WebP · up to 10 MB
            </span>
          </div>
        </section>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions class="!justify-end">
      <button matButton type="button" (click)="dialogRef.close(result())">Close</button>
    </mat-dialog-actions>
  `,
})
export class PurchaseDetailDialogComponent {
  readonly dialogRef =
    inject<MatDialogRef<PurchaseDetailDialogComponent, Purchase | undefined>>(MatDialogRef);
  private readonly data = inject<PurchaseDetailDialogData>(MAT_DIALOG_DATA);
  private readonly service = inject(PurchaseService);
  private readonly notifications = inject(NotificationService);

  protected readonly createPermission = Permission.PURCHASE_ORDER_CREATE;
  protected readonly acceptedTypes = ACCEPTED_TYPES;

  /**
   * Local, because an upload replaces the purchase and the dialog must show the new file
   * without closing. The updated row is handed back on close so the list agrees.
   */
  private readonly purchaseState = signal<Purchase>(this.data.purchase);
  private readonly changed = signal(false);

  protected readonly purchase = this.purchaseState.asReadonly();
  protected readonly uploading = signal(false);
  protected readonly downloading = signal(false);
  protected readonly uploadError = signal<string | null>(null);

  protected readonly isIntraState = computed(
    () => this.purchaseState().gstTreatment === GstTreatment.INTRA_STATE,
  );
  protected readonly isInterState = computed(
    () => this.purchaseState().gstTreatment === GstTreatment.INTER_STATE,
  );
  protected readonly isUnregistered = computed(
    () => this.purchaseState().gstTreatment === GstTreatment.UNREGISTERED,
  );

  protected result(): Purchase | undefined {
    return this.changed() ? this.purchaseState() : undefined;
  }

  protected lineTax(cgst: number, sgst: number, igst: number): number {
    return Math.round((cgst + sgst + igst) * 100) / 100;
  }

  protected readableSize(bytes: number): string {
    if (bytes < 1024) {
      return `${String(bytes)} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    // Clear immediately, so selecting the same file twice after a failure still fires
    // `change` — otherwise a retry silently does nothing.
    input.value = '';

    if (file === undefined) {
      return;
    }

    this.uploadError.set(null);

    // Checked here as well as on the server: uploading 40 MB only to be refused wastes
    // the user's connection, and on a phone their data.
    if (file.size > MAX_BYTES) {
      this.uploadError.set('That file is larger than 10 MB. Attach a smaller scan.');
      return;
    }

    this.uploading.set(true);

    this.service.uploadInvoice(this.purchaseState().id, file).subscribe({
      next: (updated) => {
        this.purchaseState.set(updated);
        this.changed.set(true);
        this.uploading.set(false);
        this.notifications.success('Bill attached.');
      },
      error: (error: AppError) => {
        this.uploading.set(false);
        this.uploadError.set(error.message);
      },
    });
  }

  /**
   * Opens the bill in a new tab.
   *
   * Fetched as a blob rather than linked directly, because the endpoint needs the
   * `Authorization` header and a plain navigation cannot carry one. The object URL is
   * revoked on a timer: revoking it immediately races the tab that is still loading it.
   */
  protected download(): void {
    this.downloading.set(true);

    this.service.downloadInvoice(this.purchaseState().id).subscribe({
      next: (blob) => {
        this.downloading.set(false);

        const url = URL.createObjectURL(blob);
        const opened = window.open(url, '_blank', 'noopener');

        if (opened === null) {
          // Pop-up blocked — fall back to a download so the click is not simply lost.
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = this.purchaseState().invoiceFile?.fileName ?? 'invoice';
          anchor.click();
        }

        setTimeout(() => {
          URL.revokeObjectURL(url);
        }, 60_000);
      },
      error: () => {
        this.downloading.set(false);
        this.notifications.error('Could not open the bill.');
      },
    });
  }
}
