import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import type { AppError } from '../../../../core/errors/app-error';
import { Permission } from '../../../../core/models/permission.model';
import { ConfirmDialogService } from '../../../../shared/components/confirm-dialog/confirm-dialog.service';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import { MATERIAL_CORE_IMPORTS } from '../../../../shared/material/material-imports';
import type { Purchase, PurchaseSummary } from '../../../purchases/models/purchase.model';
import { PurchaseService } from '../../../purchases/services/purchase.service';
import type { Supplier } from '../../models/supplier.model';
import { SupplierService } from '../../services/supplier.service';
import { money } from '../../../../shared/utils/format.utils';

export interface SupplierDetailDialogData {
  readonly supplier: Supplier;
}

/**
 * What the dialog did, so the list knows whether to reopen an editor or just refresh.
 *
 * `deactivated` and `deleted` are separate because the server treats them separately: a
 * supplier with invoices is retired rather than removed, and telling the user "removed"
 * when the row is still there would be a lie.
 */
export type SupplierDetailResult =
  | { readonly action: 'edit' }
  | { readonly action: 'deactivated'; readonly supplier: Supplier }
  | { readonly action: 'deleted' };

/** How many invoices to show inline before deferring to the purchases page. */
const RECENT_LIMIT = 5;

/**
 * One supplier, in full, with what has been bought from them.
 *
 * The purchase history is the reason this dialog exists rather than sending a row click
 * straight to the edit form. "Who is this vendor and what do we buy from them" is one
 * question, and answering it by making the user open a second screen and set a filter is
 * how the answer stops being looked up at all.
 *
 * Only the most recent few invoices are listed. This is a supplier record, not the
 * purchase ledger — the full, filterable list is one link away.
 */
@Component({
  selector: 'pb-supplier-detail-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    MatDialogModule,
    SpinnerComponent,
    HasPermissionDirective,
    ...MATERIAL_CORE_IMPORTS,
  ],
  template: `
    <h2 mat-dialog-title class="!flex !flex-wrap !items-center !gap-2">
      <span>{{ supplier().name }}</span>
      <span
        class="pb-badge pb-badge-pill"
        [class]="supplier().isActive ? 'pb-tone-success' : 'pb-tone-neutral'"
      >
        {{ supplier().isActive ? 'Active' : 'Inactive' }}
      </span>
      @if (!supplier().isGstRegistered) {
        <span class="pb-badge pb-badge-pill pb-tone-neutral"> Unregistered </span>
      }
    </h2>

    <mat-dialog-content>
      <div class="flex flex-col gap-4">
        <dl class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt class="text-pb-caption text-on-surface-variant">GSTIN</dt>
            <dd class="text-pb-body">{{ supplier().gstin ?? 'Not registered' }}</dd>
          </div>
          <div>
            <dt class="text-pb-caption text-on-surface-variant">State</dt>
            <dd class="text-pb-body">{{ supplier().stateName }} ({{ supplier().stateCode }})</dd>
          </div>
          <div>
            <dt class="text-pb-caption text-on-surface-variant">Contact</dt>
            <dd class="text-pb-body">{{ supplier().contactName ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-pb-caption text-on-surface-variant">Phone</dt>
            <dd class="text-pb-body">{{ supplier().phone ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-pb-caption text-on-surface-variant">Email</dt>
            <dd class="break-all text-pb-body">{{ supplier().email ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-pb-caption text-on-surface-variant">City</dt>
            <dd class="text-pb-body">{{ supplier().city ?? '—' }}</dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="text-pb-caption text-on-surface-variant">Address</dt>
            <dd class="text-pb-body">{{ supplier().addressLine ?? '—' }}</dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="text-pb-caption text-on-surface-variant">Added</dt>
            <dd class="text-pb-body">{{ supplier().createdAt | date: 'mediumDate' }}</dd>
          </div>
        </dl>

        @if (supplier().notes; as notes) {
          <p class="rounded-lg bg-surface-container px-3 py-2 text-pb-caption">{{ notes }}</p>
        }

        <!-- Purchase history -->
        <section class="flex flex-col gap-2">
          <h3 class="text-pb-subtitle">Purchase history</h3>

          @if (loadingHistory()) {
            <pb-spinner size="sm" label="Loading invoices…" />
          } @else if (historyError()) {
            <p class="text-pb-caption text-on-surface-variant">
              Could not load this supplier's invoices.
            </p>
          } @else if (invoiceCount() === 0) {
            <p class="text-pb-caption text-on-surface-variant">
              Nothing has been bought from this supplier yet.
            </p>
          } @else {
            <!-- Totals first: "how much do we spend here" is the question a supplier
                 record is opened to answer. -->
            <div class="grid grid-cols-3 gap-2">
              <div class="rounded-lg bg-surface-container p-2.5">
                <div class="text-pb-caption text-on-surface-variant">Invoices</div>
                <div class="tabular-nums text-pb-subtitle">{{ invoiceCount() }}</div>
              </div>
              <div class="rounded-lg bg-surface-container p-2.5">
                <div class="text-pb-caption text-on-surface-variant">Total</div>
                <div class="tabular-nums text-pb-subtitle">{{ money(totalValue()) }}</div>
              </div>
              <div class="rounded-lg bg-surface-container p-2.5">
                <div class="text-pb-caption text-on-surface-variant">GST</div>
                <div class="tabular-nums text-pb-subtitle">{{ money(totalTax()) }}</div>
              </div>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full border-collapse text-left text-pb-caption">
                <thead>
                  <tr class="border-b border-outline-variant text-on-surface-variant">
                    <th class="py-2 pr-3 font-medium">Invoice</th>
                    <th class="py-2 pr-3 font-medium">Date</th>
                    <th class="py-2 pr-3 text-right font-medium">Items</th>
                    <th class="py-2 pr-3 text-right font-medium">Total</th>
                    <th class="py-2 font-medium">Bill</th>
                  </tr>
                </thead>
                <tbody>
                  @for (purchase of recent(); track purchase.id) {
                    <tr class="border-b border-outline-variant/50">
                      <td class="py-2 pr-3">{{ purchase.invoiceNumber }}</td>
                      <!-- Printed as the API's YYYY-MM-DD string: a calendar day put
                           through a Date can render as the day before. -->
                      <td class="py-2 pr-3">{{ purchase.invoiceDate }}</td>
                      <td class="py-2 pr-3 text-right tabular-nums">{{ purchase.lineCount }}</td>
                      <td class="py-2 pr-3 text-right tabular-nums">
                        {{ money(purchase.totalAmount) }}
                      </td>
                      <td class="py-2">
                        {{ purchase.hasInvoiceFile ? 'Attached' : 'Missing' }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            @if (invoiceCount() > recent().length) {
              <p class="text-pb-caption text-on-surface-variant">
                Showing the {{ recent().length }} most recent of {{ invoiceCount() }}.
              </p>
            }

            <div>
              <button matButton type="button" (click)="viewAllPurchases()">
                <mat-icon>receipt_long</mat-icon>
                View all invoices
              </button>
            </div>
          }
        </section>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions
      class="!flex-col-reverse !items-stretch gap-2 sm:!flex-row sm:!justify-between"
    >
      <span *pbHasPermission="managePermission">
        <button
          matButton
          type="button"
          class="!text-error"
          [disabled]="removing()"
          (click)="remove()"
        >
          <mat-icon>delete_outline</mat-icon>
          {{ removing() ? 'Removing…' : 'Remove' }}
        </button>
      </span>

      <span class="flex flex-col-reverse gap-2 sm:flex-row">
        <button matButton type="button" (click)="dialogRef.close()">Close</button>
        <button
          matButton="filled"
          type="button"
          *pbHasPermission="managePermission"
          (click)="dialogRef.close({ action: 'edit' })"
        >
          <mat-icon>edit</mat-icon>
          Edit
        </button>
      </span>
    </mat-dialog-actions>
  `,
})
export class SupplierDetailDialogComponent {
  readonly dialogRef =
    inject<MatDialogRef<SupplierDetailDialogComponent, SupplierDetailResult | undefined>>(
      MatDialogRef,
    );
  private readonly data = inject<SupplierDetailDialogData>(MAT_DIALOG_DATA);
  private readonly purchases = inject(PurchaseService);
  private readonly suppliers = inject(SupplierService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly router = inject(Router);

  protected readonly managePermission = Permission.SUPPLIER_MANAGE;

  protected readonly supplier = signal<Supplier>(this.data.supplier).asReadonly();

  protected readonly loadingHistory = signal(true);
  protected readonly historyError = signal(false);
  protected readonly removing = signal(false);

  private readonly recentState = signal<readonly Purchase[]>([]);
  private readonly summaryState = signal<PurchaseSummary | null>(null);

  protected readonly recent = this.recentState.asReadonly();
  protected readonly invoiceCount = computed(() => this.summaryState()?.purchaseCount ?? 0);
  protected readonly totalValue = computed(() => this.summaryState()?.totalValue ?? 0);
  protected readonly totalTax = computed(() => this.summaryState()?.totalTax ?? 0);

  constructor() {
    this.loadHistory();
  }

  /** Indian digit grouping, which is what every figure on a GST invoice uses. */
  protected money(value: number): string {
    return money(value);
  }

  protected viewAllPurchases(): void {
    // The purchase list reads `?supplierId=`, so this is a real link rather than a
    // navigation the user then has to re-filter by hand.
    this.dialogRef.close();
    void this.router.navigate(['/purchases'], {
      queryParams: { supplierId: this.supplier().id },
    });
  }

  /**
   * Removal, with the outcome the server actually chose.
   *
   * A supplier that has invoices is deactivated rather than deleted, so the confirmation
   * says which will happen — promising removal and then leaving the row visible reads as
   * a failure.
   */
  protected async remove(): Promise<void> {
    const supplier = this.supplier();
    const hasHistory = this.invoiceCount() > 0;

    const confirmed = await this.confirm.ask({
      title: hasHistory ? `Deactivate ${supplier.name}?` : `Remove ${supplier.name}?`,
      message: hasHistory
        ? `${supplier.name} has ${String(this.invoiceCount())} recorded ` +
          `${this.invoiceCount() === 1 ? 'invoice' : 'invoices'}, so the record is kept and ` +
          'marked inactive. It stays on those invoices but cannot be named on a new one.'
        : 'The supplier disappears from the list and cannot be named on a new invoice.',
      confirmLabel: hasHistory ? 'Deactivate' : 'Remove',
      variant: 'danger',
    });

    if (!confirmed) {
      return;
    }

    this.removing.set(true);

    this.suppliers.remove(supplier.id).subscribe({
      // A body means the server deactivated it and handed back the updated row; `null`
      // means it was removed outright.
      next: (updated) => {
        this.dialogRef.close(
          updated === null ? { action: 'deleted' } : { action: 'deactivated', supplier: updated },
        );
      },
      error: (_error: AppError) => {
        // `errorInterceptor` has already shown the message; just re-enable the button.
        this.removing.set(false);
      },
    });
  }

  /**
   * The recent invoices and the totals, fetched together.
   *
   * Both are scoped to this supplier, so the count under "Invoices" is the count of what
   * the table is showing a slice of. A failure is reported in place rather than thrown:
   * the supplier's own details are already on screen and still useful.
   */
  private loadHistory(): void {
    const base = {
      supplierId: this.supplier().id,
      page: 1,
      pageSize: RECENT_LIMIT,
      sortField: 'invoiceDate' as const,
      sortDirection: 'desc' as const,
    };

    forkJoin({
      page: this.purchases.list(base).pipe(catchError(() => of(null))),
      summary: this.purchases.summary(base).pipe(catchError(() => of(null))),
    }).subscribe(({ page, summary }) => {
      this.loadingHistory.set(false);

      if (page === null || summary === null) {
        this.historyError.set(true);
        return;
      }

      this.recentState.set(page.items);
      this.summaryState.set(summary);
    });
  }
}
