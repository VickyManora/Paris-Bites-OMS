import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import type { Sort } from '@angular/material/sort';
import { Permission } from '../../../../core/models/permission.model';
import { NotificationService } from '../../../../core/services/notification.service';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { DataTableComponent } from '../../../../shared/components/data-table/data-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import type { PageRequest } from '../../../../shared/components/paginator/paginator.component';
import { InlineAlertComponent } from '../../../../shared/components/inline-alert/inline-alert.component';
import {
  ListToolbarComponent,
  type FilterChip,
} from '../../../../shared/components/list-toolbar/list-toolbar.component';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import {
  MATERIAL_CORE_IMPORTS,
  MATERIAL_FORM_IMPORTS,
} from '../../../../shared/material/material-imports';
import type { TableColumn } from '../../../../shared/models/table-column.model';
import {
  SupplierDetailDialogComponent,
  type SupplierDetailDialogData,
  type SupplierDetailResult,
} from '../../components/supplier-detail-dialog/supplier-detail-dialog.component';
import {
  SupplierFormDialogComponent,
  type SupplierFormDialogData,
} from '../../components/supplier-form-dialog/supplier-form-dialog.component';
import {
  GST_STATE_OPTIONS,
  type Supplier,
  type SupplierSortField,
} from '../../models/supplier.model';
import { SupplierStore } from '../../services/supplier-store.service';

/**
 * Vendor master data.
 *
 * A plain list rather than a dashboard: suppliers are reference data that changes rarely,
 * so the page optimises for finding one and correcting it, not for monitoring.
 */
@Component({
  selector: 'pb-supplier-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [SupplierStore],
  imports: [
    PageHeaderComponent,
    CardComponent,
    DataTableComponent,
    InlineAlertComponent,
    ListToolbarComponent,
    HasPermissionDirective,
    ...MATERIAL_CORE_IMPORTS,
    ...MATERIAL_FORM_IMPORTS,
  ],
  template: `
    <pb-page-header title="Suppliers" subtitle="Vendors you buy from">
      <!-- The slot attribute is required: pb-page-header projects with
           select="[slot=actions]", so content without it is silently dropped. -->
      <button
        slot="actions"
        matButton="filled"
        type="button"
        *pbHasPermission="managePermission"
        (click)="openCreate()"
      >
        <mat-icon>add</mat-icon>
        Add supplier
      </button>
    </pb-page-header>

    <pb-card padding="none">
      <div class="flex flex-col gap-pb-3 p-pb-4">
        <pb-list-toolbar
          searchLabel="Search suppliers"
          searchPlaceholder="Name, GSTIN, contact, city or email…"
          [searchValue]="store.searchTerm()"
          [filters]="filterChips()"
          (searchChange)="store.setSearch($event)"
          (chipRemove)="removeFilter($event)"
          (clearAll)="store.clearFilters()"
        >
          <mat-form-field slot="filters" class="lg:!w-56" subscriptSizing="dynamic">
            <mat-label>State</mat-label>
            <mat-select
              [value]="store.filters().stateCode"
              (valueChange)="store.setStateCode($event)"
            >
              <mat-option [value]="null">All states</mat-option>
              @for (option of stateOptions; track option.value) {
                <mat-option [value]="option.value">{{ option.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field slot="filters" class="lg:!w-36" subscriptSizing="dynamic">
            <mat-label>Status</mat-label>
            <mat-select
              [value]="store.filters().isActive"
              (valueChange)="store.setIsActive($event)"
            >
              <mat-option [value]="null">Any</mat-option>
              <mat-option [value]="true">Active</mat-option>
              <mat-option [value]="false">Inactive</mat-option>
            </mat-select>
          </mat-form-field>
        </pb-list-toolbar>

        @if (store.error(); as failure) {
          <pb-inline-alert title="Could not load suppliers" [message]="failure.message">
            <button slot="actions" matButton type="button" (click)="store.load()">Try again</button>
          </pb-inline-alert>
        }
      </div>

      <div class="px-pb-4 pb-pb-4">
        <pb-data-table
          [columns]="columns"
          [rows]="store.suppliers()"
          [pagination]="store.pagination()"
          [loading]="store.loading()"
          [selectable]="true"
          selection="multiple"
          stickyHeader
          maxHeight="60vh"
          exportName="suppliers"
          [sortActive]="store.sortField()"
          [sortDirection]="store.sortDirection()"
          [trackBy]="trackById"
          [emptyIconName]="store.isEmptyDueToFilters() ? 'searchEmpty' : 'suppliers'"
          [emptyTitle]="
            store.isEmptyDueToFilters() ? 'No suppliers match your filters' : 'No suppliers yet'
          "
          [emptyMessage]="
            store.isEmptyDueToFilters()
              ? 'Try a different search, or clear the filters to see every supplier again.'
              : 'Add the vendors you buy from so their invoices can be recorded against them.'
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
export class SupplierListPage {
  protected readonly store = inject(SupplierStore);
  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);

  protected readonly managePermission = Permission.SUPPLIER_MANAGE;
  protected readonly stateOptions = GST_STATE_OPTIONS;

  protected readonly columns: readonly TableColumn<Supplier>[] = [
    { key: 'name', header: 'Supplier', value: (row) => row.name, sortable: true, primary: true },
    {
      key: 'gstin',
      // An unregistered supplier is a normal, valid state — labelled rather than blank so
      // an empty cell does not read as missing data.
      header: 'GSTIN',
      value: (row) => row.gstin ?? 'Unregistered',
      hideOnMobile: true,
    },
    { key: 'stateName', header: 'State', value: (row) => row.stateName, hideOnMobile: true },
    {
      key: 'city',
      header: 'City',
      value: (row) => row.city ?? '—',
      sortable: true,
      hideOnMobile: true,
    },
    {
      key: 'contact',
      header: 'Contact',
      value: (row) => row.contactName ?? row.phone ?? row.email ?? '—',
      hideOnMobile: true,
    },
    {
      key: 'status',
      header: 'Status',
      value: (row) => (row.isActive ? 'Active' : 'Inactive'),
      // Neutral rather than danger for inactive: a retired supplier is a normal state, not a fault.
      tone: (row) => (row.isActive ? 'success' : 'neutral'),
    },
  ];

  constructor() {
    this.store.load();
  }

  protected readonly trackById = (row: Supplier): string => row.id;

  /** See the note on the inventory page's `filterChips` for why these are built per page. */
  protected readonly filterChips = computed<readonly FilterChip[]>(() => {
    const filters = this.store.filters();
    const chips: FilterChip[] = [];

    if (filters.stateCode !== null) {
      chips.push({
        key: 'stateCode',
        label: `State: ${
          this.stateOptions.find((option) => option.value === filters.stateCode)?.label ??
          filters.stateCode
        }`,
      });
    }

    if (filters.isActive !== null) {
      chips.push({ key: 'isActive', label: filters.isActive ? 'Active only' : 'Inactive only' });
    }

    return chips;
  });

  protected removeFilter(key: string): void {
    if (key === 'stateCode') {
      this.store.setStateCode(null);
    } else if (key === 'isActive') {
      this.store.setIsActive(null);
    }
  }

  protected onSort(sort: Sort): void {
    if (sort.direction === '') {
      this.store.setSort('name', 'asc');
      return;
    }
    this.store.setSort(sort.active as SupplierSortField, sort.direction);
  }

  protected onPageChange(request: PageRequest): void {
    this.store.setPage(request.page, request.pageSize);
  }

  protected openCreate(): void {
    const ref = this.dialog.open<SupplierFormDialogComponent, SupplierFormDialogData, Supplier>(
      SupplierFormDialogComponent,
      { width: '680px', maxWidth: 'calc(100vw - 2rem)', autoFocus: 'first-tabbable' },
    );

    ref.afterClosed().subscribe((created) => {
      if (created !== undefined) {
        this.notifications.success(`${created.name} added.`);
        this.store.load();
      }
    });
  }

  /**
   * A row opens the record, not the editor.
   *
   * Reading a supplier — who they are, what we buy from them — is far more common than
   * correcting one, and dropping straight into a form makes the common case an accidental
   * edit waiting to happen. Editing and removal are actions taken from the record.
   */
  protected openDetail(supplier: Supplier): void {
    const ref = this.dialog.open<
      SupplierDetailDialogComponent,
      SupplierDetailDialogData,
      SupplierDetailResult | undefined
    >(SupplierDetailDialogComponent, {
      data: { supplier },
      width: '760px',
      maxWidth: 'calc(100vw - 2rem)',
      autoFocus: 'first-tabbable',
    });

    ref.afterClosed().subscribe((result) => {
      if (result === undefined) {
        return;
      }

      if (result.action === 'edit') {
        this.openEdit(supplier);
        return;
      }

      // The two removal outcomes are reported differently on purpose: saying "removed"
      // when the row is still there, merely inactive, reads as a failed delete.
      this.notifications.success(
        result.action === 'deleted'
          ? `${supplier.name} removed.`
          : `${result.supplier.name} deactivated — it stays on its existing invoices.`,
      );
      this.store.load();
    });
  }

  protected openEdit(supplier: Supplier): void {
    const ref = this.dialog.open<SupplierFormDialogComponent, SupplierFormDialogData, Supplier>(
      SupplierFormDialogComponent,
      {
        data: { supplier },
        width: '680px',
        maxWidth: 'calc(100vw - 2rem)',
        autoFocus: 'first-tabbable',
      },
    );

    ref.afterClosed().subscribe((updated) => {
      if (updated !== undefined) {
        this.notifications.success(`${updated.name} updated.`);
        this.store.load();
      }
    });
  }
}
