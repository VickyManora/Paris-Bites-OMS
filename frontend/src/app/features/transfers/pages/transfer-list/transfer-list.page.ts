import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import type { Sort } from '@angular/material/sort';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
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
import { StatCardComponent } from '../../../../shared/components/stat-card/stat-card.component';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import {
  MATERIAL_CORE_IMPORTS,
  MATERIAL_FORM_IMPORTS,
} from '../../../../shared/material/material-imports';
import type { TableColumn } from '../../../../shared/models/table-column.model';
import { CreateTransferDialogComponent } from '../../components/create-transfer-dialog/create-transfer-dialog.component';
import {
  TransferDetailDialogComponent,
  type TransferDetailDialogData,
} from '../../components/transfer-detail-dialog/transfer-detail-dialog.component';
import {
  TRANSFER_STATUS_OPTIONS,
  TRANSFER_STATUS_TONES,
  type StockTransfer,
  type TransferSortField,
} from '../../models/transfer.model';
import { TransferStore } from '../../services/transfer-store.service';
import { TransferService } from '../../services/transfer.service';

/**
 * Stock transfers list — a work queue for approvals and receipts.
 *
 * State lives in `TransferStore` (signals), provided here so filters and paging are scoped to
 * the page. A row tap opens the detail dialog, which is where every decision is taken; that
 * keeps one place responsible for the transitions rather than duplicating the action rules
 * across a row menu and a detail view.
 */
@Component({
  selector: 'pb-transfer-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [TransferStore],
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
    <div class="flex flex-col gap-6">
      <pb-page-header
        title="Stock transfers"
        subtitle="Move stock from the Home Warehouse to the Cart"
      >
        <button
          slot="actions"
          matButton="outlined"
          type="button"
          [disabled]="store.loading()"
          (click)="store.reload()"
        >
          <mat-icon>refresh</mat-icon>
          Refresh
        </button>
        <button
          slot="actions"
          matButton="filled"
          type="button"
          *pbHasPermission="createPermission"
          (click)="openCreate()"
        >
          <mat-icon>add</mat-icon>
          New transfer
        </button>
      </pb-page-header>

      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <!--
          "Pending" rather than the full "Pending approval" status label: at 390px the stat
          cards sit two to a row, and the longer text truncated to "Pending ap…". Beside
          "In transit", "Completed" and "Rejected" the short form is unambiguous.
        -->
        <pb-stat-card
          label="Pending"
          [value]="store.summary()?.pending ?? '—'"
          iconName="pending"
          positiveWhen="down"
          [loading]="store.loading()"
        />
        <pb-stat-card
          label="In transit"
          [value]="store.summary()?.inTransit ?? '—'"
          iconName="suppliers"
          [loading]="store.loading()"
        />
        <pb-stat-card
          label="Completed"
          [value]="store.summary()?.completed ?? '—'"
          iconName="ok"
          [loading]="store.loading()"
        />
        <pb-stat-card
          label="Rejected"
          [value]="store.summary()?.rejected ?? '—'"
          iconName="critical"
          positiveWhen="down"
          [loading]="store.loading()"
        />
      </div>

      <pb-card padding="none">
        <div class="flex flex-col gap-pb-3 p-pb-4">
          <pb-list-toolbar
            searchLabel="Search transfers"
            searchPlaceholder="Reference or item name…"
            [searchValue]="store.searchTerm()"
            [filters]="filterChips()"
            (searchChange)="store.setSearch($event)"
            (chipRemove)="removeFilter($event)"
            (clearAll)="store.clearFilters()"
          >
            <mat-form-field slot="filters" class="lg:!w-52" subscriptSizing="dynamic">
              <mat-label>Status</mat-label>
              <mat-select [value]="store.status()" (valueChange)="store.setStatus($event)">
                <mat-option [value]="null">All statuses</mat-option>
                @for (option of statusOptions; track option.value) {
                  <mat-option [value]="option.value">{{ option.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </pb-list-toolbar>

          @if (store.error(); as failure) {
            <pb-inline-alert title="Could not load transfers" [message]="failure.message">
              <button slot="actions" matButton type="button" (click)="store.reload()">
                Try again
              </button>
            </pb-inline-alert>
          }
        </div>

        <div class="px-pb-4 pb-pb-4">
          <pb-data-table
            [columns]="columns"
            [rows]="store.transfers()"
            [pagination]="store.pagination()"
            [loading]="store.loading()"
            [selectable]="true"
            selection="multiple"
            stickyHeader
            maxHeight="60vh"
            exportName="transfers"
            [sortActive]="store.sortField()"
            [sortDirection]="store.sortDirection()"
            [trackBy]="trackById"
            [emptyIconName]="store.isEmptyDueToFilters() ? 'searchEmpty' : 'transfers'"
            [emptyTitle]="
              store.isEmptyDueToFilters() ? 'No transfers match your filters' : 'No transfers yet'
            "
            [emptyMessage]="
              store.isEmptyDueToFilters()
                ? 'Try a different search, or clear the filters to see every transfer again.'
                : 'Create a transfer to move stock from the Home Warehouse to the Cart.'
            "
            [emptyActionLabel]="store.isEmptyDueToFilters() ? 'Clear filters' : ''"
            (emptyAction)="store.clearFilters()"
            (sortChange)="onSort($event)"
            (pageChange)="onPageChange($event)"
            (rowClick)="openDetail($event)"
          />
        </div>
      </pb-card>
    </div>
  `,
})
export class TransferListPage {
  protected readonly store = inject(TransferStore);
  private readonly service = inject(TransferService);
  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly datePipe = new DatePipe('en-GB');

  protected readonly statusOptions = TRANSFER_STATUS_OPTIONS;
  protected readonly createPermission = Permission.TRANSFER_CREATE;

  protected readonly columns: readonly TableColumn<StockTransfer>[] = [
    {
      key: 'reference',
      header: 'Reference',
      value: (row) => row.reference,
      sortable: true,
      primary: true,
    },
    {
      key: 'status',
      // The server's label, which reads "In transit" for APPROVED — where the goods are is
      // more useful than the name of the decision.
      header: 'Status',
      value: (row) => row.statusLabel,
      tone: (row) => TRANSFER_STATUS_TONES[row.status] ?? 'neutral',
      sortable: true,
    },
    {
      key: 'items',
      header: 'Items',
      value: (row) =>
        row.lineCount === 1 ? (row.lines[0]?.itemName ?? '1 item') : `${row.lineCount} items`,
    },
    {
      key: 'requestedAt',
      header: 'Requested',
      value: (row) => this.datePipe.transform(row.requestedAt, 'd MMM, HH:mm') ?? '—',
      sortable: true,
      hideOnMobile: true,
    },
    {
      key: 'requestedBy',
      header: 'By',
      value: (row) => row.requestedByName ?? '—',
      hideOnMobile: true,
    },
  ];

  constructor() {
    this.store.load();
    this.openDeepLinkedTransfer();
  }

  /**
   * Opens the transfer named by `?transfer=<id>`, which is how a notification links here.
   *
   * Read once from the snapshot rather than subscribed: this is an entry point, not a
   * filter, and re-firing on every query-param change would reopen the dialog when the
   * user closes it.
   *
   * The parameter is stripped immediately afterwards, so the URL left in the address bar
   * is the plain list. Without that, a refresh — or a bookmark — reopens a dialog the
   * user has already dismissed.
   */
  private openDeepLinkedTransfer(): void {
    const id = this.route.snapshot.queryParamMap.get('transfer');

    if (id === null) {
      return;
    }

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { transfer: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });

    void this.showDetailById(id);
  }

  protected readonly trackById = (row: StockTransfer): string => row.id;

  /** See the note on the inventory page's `filterChips` for why these are built per page. */
  protected readonly filterChips = computed<readonly FilterChip[]>(() => {
    const status = this.store.status();

    if (status === null) {
      return [];
    }

    return [
      {
        key: 'status',
        label: `Status: ${
          this.statusOptions.find((option) => option.value === status)?.label ?? status
        }`,
      },
    ];
  });

  protected removeFilter(key: string): void {
    if (key === 'status') {
      this.store.setStatus(null);
    }
  }

  protected onSort(sort: Sort): void {
    // `pb-data-table` sets `matSortDisableClear`, so the direction is never empty; the guard
    // remains because `Sort` still types it as possible.
    if (sort.direction === '') {
      this.store.setSort('requestedAt', 'desc');
      return;
    }

    this.store.setSort(sort.active as TransferSortField, sort.direction);
  }

  protected onPageChange(request: PageRequest): void {
    this.store.setPage(request.page, request.pageSize);
  }

  protected openCreate(): void {
    const ref = this.dialog.open<CreateTransferDialogComponent, undefined, StockTransfer>(
      CreateTransferDialogComponent,
      { width: '720px', maxWidth: 'calc(100vw - 2rem)', autoFocus: 'first-tabbable' },
    );

    ref.afterClosed().subscribe((created) => {
      if (created !== undefined) {
        this.notifications.success(`${created.reference} requested — awaiting approval.`);
        this.store.reload();
      }
    });
  }

  /**
   * Opens the detail dialog, refetching the transfer first.
   *
   * The row may be stale — a transfer list is a shared queue, and someone else may have acted
   * since it loaded. Opening on fresh data means the action buttons reflect reality rather
   * than offering an approval that will be refused.
   */
  protected openDetail(row: StockTransfer): void {
    void this.showDetail(row);
  }

  /**
   * Opens the dialog for an id with no row in hand — the deep-link path.
   *
   * Unlike `showDetail`, there is nothing to fall back to, so a failed fetch reports and
   * stops rather than opening a dialog on invented data. A notification whose transfer has
   * since been deleted is the realistic case.
   */
  private async showDetailById(id: string): Promise<void> {
    try {
      await this.openDetailDialog(await firstValueFrom(this.service.getById(id)));
    } catch {
      this.notifications.error('That transfer could not be opened. It may have been removed.');
    }
  }

  private async showDetail(row: StockTransfer): Promise<void> {
    let transfer = row;

    try {
      transfer = await firstValueFrom(this.service.getById(row.id));
    } catch {
      // Fall back to the row we have; the error banner has already reported the failure.
    }

    await this.openDetailDialog(transfer);
  }

  private async openDetailDialog(transfer: StockTransfer): Promise<void> {
    const ref = this.dialog.open<
      TransferDetailDialogComponent,
      TransferDetailDialogData,
      StockTransfer | undefined
    >(TransferDetailDialogComponent, {
      data: { transfer },
      width: '620px',
      maxWidth: 'calc(100vw - 2rem)',
    });

    const updated = await firstValueFrom(ref.afterClosed());

    if (updated !== undefined) {
      // A status change alters the summary counts and may remove the row from a filtered
      // list, so a full reload is the only consistent refresh.
      this.store.reload();
    }
  }
}
