import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import type { Sort } from '@angular/material/sort';
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
import { INVENTORY_LOCATION_OPTIONS } from '../../../inventory/models/inventory.model';
import {
  ConsumptionDetailDialogComponent,
  type ConsumptionDetailDialogData,
  type ConsumptionDetailResult,
} from '../../components/consumption-detail-dialog/consumption-detail-dialog.component';
import {
  ConsumptionFormDialogComponent,
  type ConsumptionFormDialogData,
} from '../../components/consumption-form-dialog/consumption-form-dialog.component';
import type {
  ConsumptionEntry,
  ConsumptionResult,
  ConsumptionSortField,
} from '../../models/consumption.model';
import { ConsumptionStore } from '../../services/consumption-store.service';
import { ConsumptionService } from '../../services/consumption.service';

/**
 * The daily consumption log.
 *
 * A row is one day's sheet. Opening it shows what was used and how the record has
 * changed; recording and correcting both happen through the same form, because an edit is
 * the same shape of statement as the original.
 */
@Component({
  selector: 'pb-consumption-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ConsumptionStore],
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
    <pb-page-header
      title="Consumption"
      subtitle="What the kitchen used. Stock is deducted when you record it."
    >
      <button
        slot="actions"
        matButton="filled"
        type="button"
        *pbHasPermission="recordPermission"
        (click)="openRecord()"
      >
        <mat-icon>add</mat-icon>
        Record consumption
      </button>
    </pb-page-header>

    <!-- Two columns on mobile so they stay readable, four from lg. -->
    <div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <pb-stat-card
        label="Sheets"
        [value]="entryCount()"
        iconName="calendar"
        [loading]="store.loading()"
      />
      <pb-stat-card
        label="Lines"
        [value]="lineCount()"
        iconName="tasks"
        [loading]="store.loading()"
      />
      <pb-stat-card
        label="Items used"
        [value]="itemCount()"
        iconName="consumption"
        [loading]="store.loading()"
      />
      <pb-stat-card
        label="Voided"
        [value]="voidedCount()"
        iconName="adjusted"
        positiveWhen="down"
        [loading]="store.loading()"
      />
    </div>

    <pb-card padding="none">
      <div class="flex flex-col gap-pb-3 p-pb-4">
        <pb-list-toolbar
          searchLabel="Search consumption"
          searchPlaceholder="Item name or notes…"
          [searchValue]="store.searchTerm()"
          [filters]="filterChips()"
          (searchChange)="store.setSearch($event)"
          (chipRemove)="removeFilter($event)"
          (clearAll)="store.clearFilters()"
        >
          <mat-form-field slot="filters" class="lg:!w-44" subscriptSizing="dynamic">
            <mat-label>Location</mat-label>
            <mat-select
              [value]="store.filters().location"
              (valueChange)="store.setLocation($event)"
            >
              <mat-option [value]="null">All locations</mat-option>
              @for (option of locationOptions; track option.value) {
                <mat-option [value]="option.value">{{ option.label }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

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

          <mat-checkbox
            slot="filters"
            class="lg:shrink-0 lg:self-center"
            [checked]="store.filters().includeVoided"
            (change)="store.toggleIncludeVoided()"
          >
            <span class="text-pb-body">Include voided</span>
          </mat-checkbox>
        </pb-list-toolbar>

        @if (store.invalidDateRange()) {
          <pb-inline-alert
            tone="warning"
            message="The “from” date is after the “to” date, so nothing can match. Adjust one of them."
          />
        }

        @if (store.error(); as failure) {
          <pb-inline-alert title="Could not load consumption" [message]="failure.message">
            <button slot="actions" matButton type="button" (click)="store.reload()">
              Try again
            </button>
          </pb-inline-alert>
        }
      </div>

      <div class="px-pb-4 pb-pb-4">
        <pb-data-table
          [columns]="columns"
          [rows]="store.entries()"
          [pagination]="store.pagination()"
          [loading]="store.loading()"
          [selectable]="true"
          selection="multiple"
          stickyHeader
          maxHeight="60vh"
          exportName="consumption"
          [sortActive]="store.sortField()"
          [sortDirection]="store.sortDirection()"
          [trackBy]="trackById"
          [emptyIconName]="store.isEmptyDueToFilters() ? 'searchEmpty' : 'consumption'"
          [emptyTitle]="
            store.isEmptyDueToFilters()
              ? 'No sheets match your filters'
              : 'No consumption recorded yet'
          "
          [emptyMessage]="
            store.isEmptyDueToFilters()
              ? 'Try a different search, or clear the filters to see every sheet again.'
              : 'Record what the kitchen used and the stock comes off automatically.'
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
export class ConsumptionListPage {
  protected readonly store = inject(ConsumptionStore);
  private readonly service = inject(ConsumptionService);
  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);

  protected readonly recordPermission = Permission.STOCK_ADJUST;
  protected readonly locationOptions = INVENTORY_LOCATION_OPTIONS;

  protected readonly entryCount = computed(() => this.store.summary()?.entryCount ?? 0);
  protected readonly lineCount = computed(() => this.store.summary()?.lineCount ?? 0);
  protected readonly itemCount = computed(() => this.store.summary()?.itemCount ?? 0);
  protected readonly voidedCount = computed(() => this.store.summary()?.voidedCount ?? 0);

  protected readonly columns: readonly TableColumn<ConsumptionEntry>[] = [
    {
      key: 'entryDate',
      header: 'Date',
      // Printed as the API's YYYY-MM-DD string: a calendar day put through a Date can
      // render as the day before, which on a daily sheet files the whole day wrongly.
      value: (row) => row.entryDate,
      sortable: true,
      primary: true,
    },
    { key: 'location', header: 'Location', value: (row) => row.locationLabel, hideOnMobile: true },
    { key: 'summary', header: 'Items used', value: (row) => row.summary },
    {
      key: 'lineCount',
      header: 'Lines',
      value: (row) => row.lineCount,
      align: 'right',
      numeric: true,
      hideOnMobile: true,
    },
    {
      key: 'recordedBy',
      header: 'Recorded by',
      value: (row) => row.recordedByName ?? 'System',
      hideOnMobile: true,
    },
    {
      key: 'status',
      // One column for both flags: they are mutually exclusive in practice and a row only
      // has room for the exception, not for two mostly-empty columns.
      header: 'Status',
      value: (row) => (row.isVoided ? 'Voided' : row.isEdited ? 'Edited' : 'Recorded'),
      // Voided is the exception worth finding; edited is worth noticing; recorded is the norm and
      // deliberately quiet — a column of green "Recorded" pills would drown the two that matter.
      // `null` for the ordinary case, so only the exceptions wear a pill — see the note on `tone`.
      tone: (row) => (row.isVoided ? 'danger' : row.isEdited ? 'info' : null),
    },
  ];

  constructor() {
    this.store.load();
  }

  protected readonly trackById = (row: ConsumptionEntry): string => row.id;

  /** See the note on the inventory page's `filterChips`. */
  protected readonly filterChips = computed<readonly FilterChip[]>(() => {
    const filters = this.store.filters();
    const chips: FilterChip[] = [];

    if (filters.location !== null) {
      chips.push({
        key: 'location',
        label: `Location: ${
          this.locationOptions.find((option) => option.value === filters.location)?.label ??
          filters.location
        }`,
      });
    }

    const from = filters.fromDate;
    const to = filters.toDate;

    if (from !== null || to !== null) {
      chips.push({
        key: 'dateRange',
        label:
          from !== null && to !== null
            ? `${from} to ${to}`
            : from !== null
              ? `From ${from}`
              : `Until ${String(to)}`,
      });
    }

    if (filters.includeVoided) {
      chips.push({ key: 'includeVoided', label: 'Including voided' });
    }

    return chips;
  });

  protected removeFilter(key: string): void {
    switch (key) {
      case 'location':
        this.store.setLocation(null);
        break;
      case 'dateRange':
        this.store.setFromDate(null);
        this.store.setToDate(null);
        break;
      case 'includeVoided':
        this.store.toggleIncludeVoided();
        break;
      default:
        break;
    }
  }

  protected onSort(sort: Sort): void {
    if (sort.direction === '') {
      this.store.setSort('entryDate', 'desc');
      return;
    }
    this.store.setSort(sort.active as ConsumptionSortField, sort.direction);
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
    const ref = this.dialog.open<
      ConsumptionFormDialogComponent,
      ConsumptionFormDialogData,
      ConsumptionResult | undefined
    >(ConsumptionFormDialogComponent, {
      width: '860px',
      maxWidth: 'calc(100vw - 2rem)',
      autoFocus: 'first-tabbable',
    });

    ref.afterClosed().subscribe((result) => {
      if (result !== undefined) {
        this.announce(result, 'recorded');
        this.store.reload();
      }
    });
  }

  /**
   * Opens the sheet, refetching it first.
   *
   * The list row carries no revision history — that would be a join per row for something
   * only the detail view shows — so the record is fetched fresh on open.
   */
  protected async openDetail(entry: ConsumptionEntry): Promise<void> {
    const full = await firstValueFrom(this.service.getById(entry.id)).catch(() => null);

    if (full === null) {
      // `errorInterceptor` has already reported it.
      return;
    }

    const ref = this.dialog.open<
      ConsumptionDetailDialogComponent,
      ConsumptionDetailDialogData,
      ConsumptionDetailResult | undefined
    >(ConsumptionDetailDialogComponent, {
      data: { entry: full },
      width: '760px',
      maxWidth: 'calc(100vw - 2rem)',
      autoFocus: 'first-tabbable',
    });

    ref.afterClosed().subscribe((result) => {
      if (result === undefined) {
        return;
      }

      if (result.action === 'edit') {
        this.openEdit(full);
        return;
      }

      this.notifications.success(`Sheet for ${full.entryDate} voided — stock returned.`);
      this.store.reload();
    });
  }

  private openEdit(entry: ConsumptionEntry): void {
    const ref = this.dialog.open<
      ConsumptionFormDialogComponent,
      ConsumptionFormDialogData,
      ConsumptionResult | undefined
    >(ConsumptionFormDialogComponent, {
      data: { entry },
      width: '860px',
      maxWidth: 'calc(100vw - 2rem)',
      autoFocus: 'first-tabbable',
    });

    ref.afterClosed().subscribe((result) => {
      if (result !== undefined) {
        this.announce(result, 'updated');
        this.store.reload();
      }
    });
  }

  /**
   * Reports what the save did to stock.
   *
   * The count of items whose stock actually moved, not the number of lines: an edit that
   * only changed a note moves nothing, and claiming otherwise would undermine the one
   * number this screen exists to make trustworthy.
   */
  private announce(result: ConsumptionResult, verb: 'recorded' | 'updated'): void {
    const moved = result.effects.length;

    this.notifications.success(
      moved === 0
        ? `Sheet for ${result.entry.entryDate} ${verb} — no stock change.`
        : `Sheet for ${result.entry.entryDate} ${verb} — stock updated for ` +
            `${String(moved)} ${moved === 1 ? 'item' : 'items'}.`,
    );
  }
}
