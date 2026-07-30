import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import type { Sort } from '@angular/material/sort';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, of } from 'rxjs';
import { Permission } from '../../../../core/models/permission.model';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { DataTableComponent } from '../../../../shared/components/data-table/data-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import type { PageRequest } from '../../../../shared/components/paginator/paginator.component';
import { InlineAlertComponent } from '../../../../shared/components/inline-alert/inline-alert.component';
import {
  ListToolbarComponent,
  type FilterChip,
} from '../../../../shared/components/list-toolbar/list-toolbar.component';
import { StatCardComponent } from '../../../../shared/components/stat-card/stat-card.component';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import {
  MATERIAL_CORE_IMPORTS,
  MATERIAL_FORM_IMPORTS,
} from '../../../../shared/material/material-imports';
import type { TableColumn } from '../../../../shared/models/table-column.model';
import type { SupplierOption } from '../../../suppliers/models/supplier.model';
import { SupplierService } from '../../../suppliers/services/supplier.service';
import {
  PurchaseDetailDialogComponent,
  type PurchaseDetailDialogData,
} from '../../components/purchase-detail-dialog/purchase-detail-dialog.component';
import {
  GST_TREATMENT_OPTIONS,
  GST_TREATMENT_SHORT_LABELS,
  type Purchase,
  type PurchaseSortField,
} from '../../models/purchase.model';
import { PurchaseStore } from '../../services/purchase-store.service';
import { money } from '../../../../shared/utils/format.utils';

/**
 * Purchase history.
 *
 * The totals row describes **the current filter**, not the whole ledger — filtering to one
 * supplier and reading a global total next to four rows is how someone reports the wrong
 * figure. `PurchaseStore` fetches both with the same query for that reason.
 */
@Component({
  selector: 'pb-purchase-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [PurchaseStore],
  imports: [
    PageHeaderComponent,
    CardComponent,
    DataTableComponent,
    InlineAlertComponent,
    ListToolbarComponent,
    StatCardComponent,
    HasPermissionDirective,
    ...MATERIAL_CORE_IMPORTS,
    ...MATERIAL_FORM_IMPORTS,
  ],
  template: `
    <pb-page-header title="Purchases" subtitle="Supplier invoices and the stock they added">
      <!-- The slot attribute is required: pb-page-header projects with
           select="[slot=actions]", so content without it is silently dropped. -->
      <button
        slot="actions"
        matButton="filled"
        type="button"
        *pbHasPermission="createPermission"
        (click)="openRecord()"
      >
        <mat-icon>add</mat-icon>
        Record purchase
      </button>
    </pb-page-header>

    <!-- Two columns on mobile so they stay readable, four from lg. -->
    <div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <pb-stat-card
        label="Invoices"
        [value]="summaryCount()"
        iconName="purchases"
        [loading]="store.loading()"
      />
      <pb-stat-card
        label="Total value"
        [value]="money(summaryValue())"
        iconName="revenue"
        [loading]="store.loading()"
      />
      <pb-stat-card
        label="GST"
        [value]="money(summaryTax())"
        iconName="tax"
        [loading]="store.loading()"
      />
      <pb-stat-card
        label="Missing bills"
        [value]="summaryMissing()"
        iconName="warning"
        positiveWhen="down"
        [loading]="store.loading()"
      />
    </div>

    <pb-card padding="none">
      <div class="flex flex-col gap-pb-3 p-pb-4">
        <pb-list-toolbar
          searchLabel="Search invoices"
          searchPlaceholder="Invoice number, supplier or notes…"
          [searchValue]="store.searchTerm()"
          [filters]="filterChips()"
          (searchChange)="store.setSearch($event)"
          (chipRemove)="removeFilter($event)"
          (clearAll)="store.clearFilters()"
        >
          <mat-form-field slot="filters" class="lg:!w-52" subscriptSizing="dynamic">
            <mat-label>Supplier</mat-label>
            <mat-select
              [value]="store.filters().supplierId"
              (valueChange)="store.setSupplier($event)"
            >
              <mat-option [value]="null">All suppliers</mat-option>
              @for (option of supplierOptions(); track option.id) {
                <mat-option [value]="option.id">{{ option.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <!-- "GST" rather than "GST treatment": the full label truncated to "GST tr…" at this
               width, and a truncated label is worse than a short one. The chip it produces spells it
               out in full. -->
          <mat-form-field slot="filters" class="lg:!w-40" subscriptSizing="dynamic">
            <mat-label>GST</mat-label>
            <mat-select
              [value]="store.filters().gstTreatment"
              (valueChange)="store.setGstTreatment($event)"
            >
              <mat-option [value]="null">Any</mat-option>
              @for (option of gstTreatmentOptions; track option.value) {
                <mat-option [value]="option.value">{{ option.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field slot="filters" class="lg:!w-36" subscriptSizing="dynamic">
            <mat-label>Bill</mat-label>
            <mat-select
              [value]="store.filters().hasInvoiceFile"
              (valueChange)="store.setHasInvoiceFile($event)"
            >
              <mat-option [value]="null">Any</mat-option>
              <mat-option [value]="true">Attached</mat-option>
              <mat-option [value]="false">Missing</mat-option>
            </mat-select>
          </mat-form-field>

          <!-- The two bounds sit in one group: they are a single range, and separating them across a
               grid meant "to" could wrap to a different row from "from". -->
          <div slot="filters" class="flex items-start gap-pb-2">
            <mat-form-field class="!w-40" subscriptSizing="dynamic">
              <mat-label>From date</mat-label>
              <input
                matInput
                type="date"
                [value]="store.filters().fromDate ?? ''"
                (change)="onFromDate($event)"
              />
            </mat-form-field>

            <mat-form-field class="!w-40" subscriptSizing="dynamic">
              <mat-label>To date</mat-label>
              <input
                matInput
                type="date"
                [value]="store.filters().toDate ?? ''"
                (change)="onToDate($event)"
              />
            </mat-form-field>
          </div>
        </pb-list-toolbar>

        <!-- Stated rather than silently swapped: the user meant one of the two bounds to
             be different, and guessing which hides the mistake behind plausible results. -->
        @if (store.invalidDateRange()) {
          <pb-inline-alert
            tone="warning"
            message="The “from” date is after the “to” date, so nothing can match. Adjust one of them."
          />
        }

        @if (store.error(); as failure) {
          <pb-inline-alert title="Could not load purchases" [message]="failure.message">
            <button slot="actions" matButton type="button" (click)="store.reload()">
              Try again
            </button>
          </pb-inline-alert>
        }
      </div>

      <div class="px-pb-4 pb-pb-4">
        <pb-data-table
          [columns]="columns"
          [rows]="store.purchases()"
          [pagination]="store.pagination()"
          [loading]="store.loading()"
          [selectable]="true"
          selection="multiple"
          stickyHeader
          maxHeight="60vh"
          exportName="purchases"
          [sortActive]="store.sortField()"
          [sortDirection]="store.sortDirection()"
          [trackBy]="trackById"
          [emptyIconName]="store.isEmptyDueToFilters() ? 'searchEmpty' : 'purchases'"
          [emptyTitle]="
            store.isEmptyDueToFilters() ? 'No invoices match your filters' : 'No purchases yet'
          "
          [emptyMessage]="
            store.isEmptyDueToFilters()
              ? 'Try a different search, or clear the filters to see every invoice again.'
              : 'Record a supplier invoice to add stock and start the purchase history.'
          "
          [emptyActionLabel]="store.isEmptyDueToFilters() ? 'Clear filters' : ''"
          (emptyAction)="store.clearFilters()"
          (sortChange)="onSort($event)"
          (pageChange)="onPageChange($event)"
          (rowClick)="openDetail($event)"
        />
      </div>
    </pb-card>
  `,
})
export class PurchaseListPage {
  protected readonly store = inject(PurchaseStore);
  private readonly suppliers = inject(SupplierService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly createPermission = Permission.PURCHASE_ORDER_CREATE;
  protected readonly gstTreatmentOptions = GST_TREATMENT_OPTIONS;

  /**
   * Suppliers for the filter dropdown.
   *
   * Defaulted to empty on failure: a broken supplier list must not take the purchase
   * history down with it — the rows already carry their supplier's name.
   */
  protected readonly supplierOptions = signal<readonly SupplierOption[]>([]);

  protected readonly summaryCount = computed(() => this.store.summary()?.purchaseCount ?? 0);
  protected readonly summaryValue = computed(() => this.store.summary()?.totalValue ?? 0);
  protected readonly summaryTax = computed(() => this.store.summary()?.totalTax ?? 0);
  protected readonly summaryMissing = computed(
    () => this.store.summary()?.missingInvoiceFiles ?? 0,
  );

  protected readonly columns: readonly TableColumn<Purchase>[] = [
    {
      key: 'invoiceNumber',
      header: 'Invoice',
      value: (row) => row.invoiceNumber,
      sortable: true,
      primary: true,
    },
    {
      key: 'supplierName',
      header: 'Supplier',
      value: (row) => row.supplierName ?? '—',
      sortable: true,
    },
    {
      key: 'invoiceDate',
      // Rendered from the API's `YYYY-MM-DD` string as-is. Passing it through a Date
      // would re-interpret a calendar day in the browser's timezone and can show the
      // day before.
      header: 'Date',
      value: (row) => row.invoiceDate,
      sortable: true,
      hideOnMobile: true,
    },
    {
      key: 'lineCount',
      header: 'Items',
      value: (row) => row.lineCount,
      align: 'right',
      numeric: true,
      hideOnMobile: true,
    },
    {
      key: 'gstTreatment',
      header: 'GST',
      value: (row) => GST_TREATMENT_SHORT_LABELS[row.gstTreatment],
      hideOnMobile: true,
    },
    {
      key: 'totalAmount',
      header: 'Total',
      value: (row) => this.money(row.totalAmount),
      sortable: true,
      align: 'right',
      numeric: true,
    },
    {
      key: 'hasInvoiceFile',
      // A word, not an icon column: "Missing" is what someone chasing paperwork scans for,
      // and an absent icon reads as an unrendered cell.
      header: 'Bill',
      value: (row) => (row.hasInvoiceFile ? 'Attached' : 'Missing'),
    },
  ];

  constructor() {
    this.applySupplierFromUrl();
    this.store.load();
    this.loadSupplierOptions();
  }

  /**
   * Applies `?supplierId=` before the first load.
   *
   * This is what makes "view all invoices from this supplier" a link rather than an
   * instruction to go and set a filter — and it means a filtered list is bookmarkable and
   * survives a reload, the same rule the inventory list follows for `?search=`.
   *
   * Read once from the snapshot rather than subscribed: it is an entry point, not a live
   * binding. Re-applying it whenever the query string changed would fight the user the
   * moment they picked a different supplier from the dropdown.
   *
   * Set on the store *before* `load()` so the page makes one request, not one unfiltered
   * request followed by a filtered one.
   */
  private applySupplierFromUrl(): void {
    const supplierId = this.route.snapshot.queryParamMap.get('supplierId');

    if (supplierId !== null && supplierId.length > 0) {
      this.store.setSupplier(supplierId, { load: false });
    }
  }

  protected readonly trackById = (row: Purchase): string => row.id;

  /**
   * See the note on the inventory page's `filterChips`.
   *
   * The date range is **one** chip rather than two, because a half-open range is a single idea and
   * removing "from" while leaving "to" is rarely what anyone means. It reads as whichever bounds are
   * set, so a one-sided range still describes itself.
   */
  protected readonly filterChips = computed<readonly FilterChip[]>(() => {
    const filters = this.store.filters();
    const chips: FilterChip[] = [];

    if (filters.supplierId !== null) {
      chips.push({
        key: 'supplierId',
        label: `Supplier: ${
          this.supplierOptions().find((option) => option.id === filters.supplierId)?.name ??
          'selected'
        }`,
      });
    }

    if (filters.gstTreatment !== null) {
      chips.push({
        key: 'gstTreatment',
        label: `GST: ${
          this.gstTreatmentOptions.find((option) => option.value === filters.gstTreatment)?.label ??
          filters.gstTreatment
        }`,
      });
    }

    if (filters.hasInvoiceFile !== null) {
      chips.push({
        key: 'hasInvoiceFile',
        label: filters.hasInvoiceFile ? 'Bill attached' : 'Bill missing',
      });
    }

    const from = filters.fromDate;
    const to = filters.toDate;

    if (from !== null || to !== null) {
      const label =
        from !== null && to !== null
          ? `${from} to ${to}`
          : from !== null
            ? `From ${from}`
            : `Until ${String(to)}`;

      chips.push({ key: 'dateRange', label });
    }

    return chips;
  });

  protected removeFilter(key: string): void {
    switch (key) {
      case 'supplierId':
        this.store.setSupplier(null);
        break;
      case 'gstTreatment':
        this.store.setGstTreatment(null);
        break;
      case 'hasInvoiceFile':
        this.store.setHasInvoiceFile(null);
        break;
      case 'dateRange':
        // Both bounds, since the chip described both.
        this.store.setFromDate(null);
        this.store.setToDate(null);
        break;
      default:
        break;
    }
  }

  /** Indian digit grouping, which is what every figure on a GST invoice uses. */
  protected money(value: number): string {
    return money(value);
  }

  protected onSort(sort: Sort): void {
    if (sort.direction === '') {
      this.store.setSort('invoiceDate', 'desc');
      return;
    }
    this.store.setSort(sort.active as PurchaseSortField, sort.direction);
  }

  protected onPageChange(request: PageRequest): void {
    this.store.setPage(request.page, request.pageSize);
  }

  protected onFromDate(event: Event): void {
    this.store.setFromDate((event.target as HTMLInputElement).value);
  }

  protected onToDate(event: Event): void {
    this.store.setToDate((event.target as HTMLInputElement).value);
  }

  protected openRecord(): void {
    void this.router.navigate(['/purchases/record']);
  }

  protected openDetail(purchase: Purchase): void {
    const ref = this.dialog.open<
      PurchaseDetailDialogComponent,
      PurchaseDetailDialogData,
      Purchase | undefined
    >(PurchaseDetailDialogComponent, {
      data: { purchase },
      width: '860px',
      maxWidth: 'calc(100vw - 2rem)',
      autoFocus: 'first-tabbable',
    });

    ref.afterClosed().subscribe((updated) => {
      // Only returned when the bill changed. Replaced in place rather than refetching the
      // page: nothing else moved, and a reload would lose the user's scroll position.
      if (updated !== undefined) {
        this.store.replace(updated);
      }
    });
  }

  private loadSupplierOptions(): void {
    this.suppliers
      .options()
      .pipe(catchError(() => of<readonly SupplierOption[]>([])))
      .subscribe((options) => this.supplierOptions.set(options));
  }
}
