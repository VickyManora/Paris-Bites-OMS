import { ChangeDetectionStrategy, Component, computed, inject, type OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import type { Sort } from '@angular/material/sort';
import { Permission } from '../../../../core/models/permission.model';
import { NotificationService } from '../../../../core/services/notification.service';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { DataTableComponent } from '../../../../shared/components/data-table/data-table.component';
import { InlineAlertComponent } from '../../../../shared/components/inline-alert/inline-alert.component';
import {
  ListToolbarComponent,
  type FilterChip,
} from '../../../../shared/components/list-toolbar/list-toolbar.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import type { PageRequest } from '../../../../shared/components/paginator/paginator.component';
import { StatCardComponent } from '../../../../shared/components/stat-card/stat-card.component';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import {
  MATERIAL_CORE_IMPORTS,
  MATERIAL_FORM_IMPORTS,
} from '../../../../shared/material/material-imports';
import type { TableColumn } from '../../../../shared/models/table-column.model';
import {
  DailySalesFormDialogComponent,
  type DailySalesFormDialogData,
} from '../../components/daily-sales-form-dialog/daily-sales-form-dialog.component';
import {
  SALES_BUCKETS,
  SALES_CHANNEL_LABELS,
  SalesChannel,
  toDateInput,
  type DailySalesEntry,
  type DailySalesSortField,
} from '../../models/daily-sales.model';
import { DailySalesStore } from '../../services/daily-sales-store.service';
import { DailySalesDetailDialogComponent } from '../../components/daily-sales-detail-dialog/daily-sales-detail-dialog.component';
import { money } from '../../../../shared/utils/format.utils';

/**
 * The daily sales log.
 *
 * One row per trading day, entered once at close of business. There is deliberately no
 * per-product or per-order entry: the business has no till that itemises, and a model
 * nobody fills in is worth less than a total that gets entered every evening.
 *
 * The consequence is worth stating on the screen itself, which is why the subtitle says
 * what this is — a figure, not a sale — and why the empty state does too. Someone looking
 * for "which desserts sold" should not have to read the schema to find out it is not here.
 */
@Component({
  selector: 'pb-sales-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DailySalesStore],
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
      title="Daily sales"
      subtitle="One entry per trading day: what each channel took, entered at close of business."
    >
      <button
        slot="actions"
        matButton="filled"
        type="button"
        *pbHasPermission="recordPermission"
        (click)="openRecord()"
      >
        <mat-icon>add</mat-icon>
        Record a day
      </button>
    </pb-page-header>

    <div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <pb-stat-card
        label="Total sales"
        [value]="totalSales()"
        iconName="revenue"
        [caption]="periodCaption()"
        [loading]="store.loading()"
      />
      <pb-stat-card
        label="Days recorded"
        [value]="daysRecorded()"
        iconName="calendar"
        [caption]="averageCaption()"
        [loading]="store.loading()"
      />
      <pb-stat-card
        label="Cash"
        [value]="cashTotal()"
        iconName="cash"
        [caption]="cashCaption()"
        [loading]="store.loading()"
      />
      <pb-stat-card
        label="Aggregators"
        [value]="aggregatorTotal()"
        iconName="platforms"
        [caption]="aggregatorCaption()"
        [loading]="store.loading()"
      />
    </div>

    <pb-card padding="none">
      <div class="flex flex-col gap-pb-3 p-pb-4">
        <!--
          No search box: there is nothing to search. A row here is a date and four totals, and the
          date range control already narrows by the only free-text-ish field there is.
        -->
        <pb-list-toolbar
          [showSearch]="false"
          [filters]="filterChips()"
          (chipRemove)="removeFilter($event)"
          (clearAll)="store.clearFilters()"
        >
          <div slot="filters" class="flex items-start gap-pb-2">
            <mat-form-field class="!w-40" subscriptSizing="dynamic">
              <mat-label>From date</mat-label>
              <input
                matInput
                type="date"
                [value]="store.filters().fromDate ?? ''"
                [max]="today"
                (change)="onFromDate($any($event.target).value)"
              />
            </mat-form-field>

            <mat-form-field class="!w-40" subscriptSizing="dynamic">
              <mat-label>To date</mat-label>
              <input
                matInput
                type="date"
                [value]="store.filters().toDate ?? ''"
                [max]="today"
                (change)="onToDate($any($event.target).value)"
              />
            </mat-form-field>
          </div>

          <mat-form-field slot="filters" class="lg:!w-44" subscriptSizing="dynamic">
            <mat-label>Channel</mat-label>
            <mat-select
              [value]="store.filters().channel ?? ''"
              (selectionChange)="onChannel($event.value)"
            >
              <mat-option value="">All channels</mat-option>
              <mat-option [value]="channels.WALK_IN">Walk-in</mat-option>
              <mat-option [value]="channels.ZOMATO">Zomato</mat-option>
              <mat-option [value]="channels.SWIGGY">Swiggy</mat-option>
            </mat-select>
            <mat-hint>Days that took money through it</mat-hint>
          </mat-form-field>
        </pb-list-toolbar>

        @if (store.invalidDateRange()) {
          <!-- Refused rather than silently swapped: the user meant one of the two bounds
               to be different, and guessing which hides the mistake behind plausible rows. -->
          <pb-inline-alert
            tone="warning"
            message="The “from” date is after the “to” date, so nothing would match. Adjust one of them."
          />
        }

        @if (store.error(); as failure) {
          <pb-inline-alert title="Could not load daily sales" [message]="failure.message">
            <button slot="actions" matButton type="button" (click)="store.load()">Try again</button>
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
          exportName="daily-sales"
          [sortActive]="store.sortField()"
          [sortDirection]="store.sortDirection()"
          [trackBy]="trackById"
          [emptyIconName]="store.hasActiveFilters() ? 'searchEmpty' : 'sales'"
          [emptyTitle]="
            store.hasActiveFilters() ? 'No days match your filters' : 'No days recorded'
          "
          [emptyMessage]="
            store.hasActiveFilters()
              ? 'Try a wider date range, or clear the filters to see every recorded day.'
              : 'Record a day to start building the sales history. This is a daily total per channel, not a record of individual orders.'
          "
          [emptyActionLabel]="store.hasActiveFilters() ? 'Clear filters' : ''"
          (emptyAction)="store.clearFilters()"
          (sortChange)="onSort($event)"
          (pageChange)="onPage($event)"
          (rowClick)="openDetail($event)"
        />
      </div>
    </pb-card>
  `,
})
export class SalesListPage implements OnInit {
  protected readonly store = inject(DailySalesStore);
  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);

  protected readonly recordPermission = Permission.SALE_RECORD;
  protected readonly channels = SalesChannel;
  protected readonly today = toDateInput(new Date());

  ngOnInit(): void {
    this.store.load();
  }

  /**
   * One column per bucket, plus the total.
   *
   * Built from `SALES_BUCKETS` rather than written out, so the table and the form can
   * never offer a different set of channels.
   */
  protected readonly columns: readonly TableColumn<DailySalesEntry>[] = [
    {
      key: 'entryDate',
      header: 'Date',
      value: (row) => this.formatDate(row),
      sortable: true,
      primary: true,
    },
    ...SALES_BUCKETS.map((bucket) => ({
      key: bucket.key,
      header: bucket.shortLabel,
      value: (row: DailySalesEntry) => money(row.amounts[bucket.key] ?? 0),
      align: 'right' as const,
      numeric: true,
      hideOnMobile: true,
    })),
    {
      key: 'totalAmount',
      header: 'Total',
      value: (row) => money(row.totalAmount),
      sortable: true,
      align: 'right',
      numeric: true,
    },
    {
      key: 'recordedByName',
      header: 'Recorded by',
      value: (row) => row.recordedByName ?? '—',
      hideOnMobile: true,
    },
  ];

  protected readonly trackById = (row: DailySalesEntry): string => row.id;

  /** See the note on the inventory page's `filterChips`. */
  protected readonly filterChips = computed<readonly FilterChip[]>(() => {
    const filters = this.store.filters();
    const chips: FilterChip[] = [];

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

    if (filters.channel !== null && filters.channel !== undefined) {
      chips.push({ key: 'channel', label: `Channel: ${SALES_CHANNEL_LABELS[filters.channel]}` });
    }

    return chips;
  });

  protected removeFilter(key: string): void {
    if (key === 'dateRange') {
      this.store.setDateRange(null, null);
    } else if (key === 'channel') {
      this.store.setChannel(null);
    }
  }

  protected readonly totalSales = computed(() => money(this.store.summary()?.totalAmount ?? 0));
  protected readonly daysRecorded = computed(() => this.store.summary()?.days ?? 0);
  protected readonly cashTotal = computed(() => money(this.store.summary()?.cashTotal ?? 0));

  protected readonly aggregatorTotal = computed(() => {
    const byChannel = this.store.summary()?.byChannel;

    if (byChannel === undefined) {
      return money(0);
    }

    return money((byChannel.ZOMATO ?? 0) + (byChannel.SWIGGY ?? 0));
  });

  /**
   * Says what the tiles cover.
   *
   * A total beside a filtered, paginated table is read as "everything" unless it says
   * otherwise — and this one is the whole filtered set, not the page.
   */
  protected readonly periodCaption = computed(() => {
    const filters = this.store.filters();
    const parts: string[] = [];

    if (filters.fromDate !== null && filters.toDate !== null) {
      parts.push(`${filters.fromDate} to ${filters.toDate}`);
    } else if (filters.fromDate !== null) {
      parts.push(`from ${filters.fromDate}`);
    } else if (filters.toDate !== null) {
      parts.push(`up to ${filters.toDate}`);
    }

    // The channel belongs here too. The tiles do follow it — filtering to Zomato really
    // does drop the walk-in-only days out of the total — so a caption that still read
    // "all recorded days" would attach an honest number to a false description of it.
    if (filters.channel !== null) {
      parts.push(`days using ${SALES_CHANNEL_LABELS[filters.channel]}`);
    }

    return parts.length === 0 ? 'all recorded days' : parts.join(', ');
  });

  protected readonly averageCaption = computed(() => {
    const average = this.store.summary()?.averagePerDay;
    // Per recorded day, not per calendar day — said out loud, because the two differ for
    // any business that does not trade every day.
    return average === null || average === undefined
      ? 'no days yet'
      : `${money(average)} per recorded day`;
  });

  protected readonly cashCaption = computed(() => {
    const summary = this.store.summary();

    if (summary === null || summary.totalAmount <= 0) {
      return 'no takings yet';
    }

    return `${Math.round((summary.cashTotal / summary.totalAmount) * 100)}% of takings`;
  });

  protected readonly aggregatorCaption = computed(() => {
    const summary = this.store.summary();

    if (summary === null || summary.totalAmount <= 0) {
      return 'no takings yet';
    }

    const aggregator = (summary.byChannel.ZOMATO ?? 0) + (summary.byChannel.SWIGGY ?? 0);
    return `${Math.round((aggregator / summary.totalAmount) * 100)}% of takings`;
  });

  protected openRecord(): void {
    this.open({});
  }

  protected openDetail(entry: DailySalesEntry): void {
    this.dialog
      .open(DailySalesDetailDialogComponent, {
        data: { entryId: entry.id },
        width: '640px',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((result: 'edit' | undefined) => {
        if (result === 'edit') {
          this.open({ entry });
        }
      });
  }

  private open(data: DailySalesFormDialogData): void {
    this.dialog
      .open(DailySalesFormDialogComponent, { data, width: '640px', maxWidth: '95vw' })
      .afterClosed()
      .subscribe((entry: DailySalesEntry | undefined) => {
        if (entry === undefined) {
          return;
        }

        this.notifications.success(
          entry.isEdited
            ? `${entry.entryDate} corrected — ${money(entry.totalAmount)}`
            : `${entry.entryDate} recorded — ${money(entry.totalAmount)}`,
        );
        this.store.load();
      });
  }

  protected onSort(sort: Sort): void {
    const field: DailySalesSortField = sort.active === 'totalAmount' ? 'totalAmount' : 'entryDate';
    this.store.setSort(field, sort.direction === 'asc' ? 'asc' : 'desc');
  }

  protected onPage(page: PageRequest): void {
    this.store.setPage(page.page, page.pageSize);
  }

  protected onFromDate(value: string): void {
    this.store.setDateRange(value, this.store.filters().toDate);
  }

  protected onToDate(value: string): void {
    this.store.setDateRange(this.store.filters().fromDate, value);
  }

  protected onChannel(value: string): void {
    this.store.setChannel(value === '' ? null : (value as SalesChannel));
  }

  /** `Mon 27 Jul 2026`, plus a marker when the day has been corrected. */
  private formatDate(entry: DailySalesEntry): string {
    const date = new Date(`${entry.entryDate}T00:00:00`);
    const formatted = date.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });

    return entry.isEdited ? `${formatted} · corrected` : formatted;
  }
}
