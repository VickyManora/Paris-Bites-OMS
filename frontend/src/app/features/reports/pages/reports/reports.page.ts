import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import type { Sort } from '@angular/material/sort';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { NotificationService } from '../../../../core/services/notification.service';
import { CardComponent } from '../../../../shared/components/card/card.component';
import {
  ChartComponent,
  type ChartSpec,
} from '../../../../shared/components/chart/chart.component';
import { DataTableComponent } from '../../../../shared/components/data-table/data-table.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import type { PageRequest } from '../../../../shared/components/paginator/paginator.component';
import { SearchBoxComponent } from '../../../../shared/components/search-box/search-box.component';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import { StatCardComponent } from '../../../../shared/components/stat-card/stat-card.component';
import {
  MATERIAL_CORE_IMPORTS,
  MATERIAL_FORM_IMPORTS,
} from '../../../../shared/material/material-imports';
import type { TableColumn } from '../../../../shared/models/table-column.model';
import { INVENTORY_LOCATION_OPTIONS } from '../../../inventory/models/inventory.model';
import type { SupplierOption } from '../../../suppliers/models/supplier.model';
import { SupplierService } from '../../../suppliers/services/supplier.service';
import type { ReportColumn, ReportFormat, ReportId, ReportRow } from '../../models/report.model';
import { isNumericColumn } from '../../models/report.model';
import { ReportsStore } from '../../services/reports-store.service';
import { ReportService } from '../../services/report.service';
import { count, money, quantity, timestamp } from '../../../../shared/utils/format.utils';

/**
 * The reports screen.
 *
 * One page for all six reports rather than six pages. Every report is the same shape of
 * thing — filter a set of rows, look at it, take it away as a file — and the differences
 * between them (which filters apply, which columns exist, what to chart) are already
 * described by the server. Six near-identical pages would drift apart within a month.
 *
 * The columns are **not** declared here. They arrive with the data, which is what lets the
 * same table render an invoice ledger and a stock list, and what makes the permission rule
 * work without the UI knowing it exists: a Store Manager's payload simply has no cost
 * column, so no cost column is drawn.
 */
@Component({
  selector: 'pb-reports-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ReportsStore],
  imports: [
    PageHeaderComponent,
    CardComponent,
    ChartComponent,
    DataTableComponent,
    EmptyStateComponent,
    SearchBoxComponent,
    SpinnerComponent,
    StatCardComponent,
    MatButtonToggleModule,
    ...MATERIAL_CORE_IMPORTS,
    ...MATERIAL_FORM_IMPORTS,
  ],
  template: `
    <pb-page-header
      title="Reports"
      subtitle="Filter, chart and export the numbers behind the business."
    >
      @if (store.result(); as result) {
        <div slot="actions" class="flex gap-2">
          <button
            matButton="outlined"
            type="button"
            [disabled]="exporting() !== null || result.rows.length === 0"
            (click)="download('xlsx')"
          >
            <mat-icon>table_view</mat-icon>
            {{ exporting() === 'xlsx' ? 'Preparing…' : 'Excel' }}
          </button>
          <button
            matButton="filled"
            type="button"
            [disabled]="exporting() !== null || result.rows.length === 0"
            (click)="download('pdf')"
          >
            <mat-icon>picture_as_pdf</mat-icon>
            {{ exporting() === 'pdf' ? 'Preparing…' : 'PDF' }}
          </button>
        </div>
      }
    </pb-page-header>

    @if (store.reportsLoading()) {
      <pb-spinner size="lg" label="Loading reports…" />
    } @else if (store.reports().length === 0) {
      <pb-empty-state
        icon="lock"
        title="No reports available"
        message="Your role does not have access to any reports."
      />
    } @else {
      <!--
        A scrolling toggle group rather than a select: with six reports, seeing all the
        options at once is the difference between browsing and remembering.
      -->
      <div class="mb-4 overflow-x-auto pb-1">
        <mat-button-toggle-group
          class="w-max"
          [value]="store.reportId()"
          (change)="store.selectReport($any($event).value)"
          aria-label="Report"
        >
          @for (report of store.reports(); track report.id) {
            <mat-button-toggle [value]="report.id">{{ report.label }}</mat-button-toggle>
          }
        </mat-button-toggle-group>
      </div>

      @if (store.descriptor(); as descriptor) {
        <pb-card padding="none" class="mb-4">
          <div class="grid grid-cols-1 gap-3 p-4 lg:grid-cols-4">
            <pb-search-box
              class="lg:col-span-2"
              label="Search"
              [placeholder]="descriptor.searchHint + '…'"
              [initialValue]="store.filters().search ?? ''"
              (searchChange)="store.setFilter('search', $event)"
            />

            @if (descriptor.supportsDateRange) {
              <mat-form-field>
                <mat-label>From date</mat-label>
                <input
                  matInput
                  type="date"
                  [value]="store.filters().fromDate ?? ''"
                  (change)="store.setFilter('fromDate', $any($event.target).value)"
                />
              </mat-form-field>

              <mat-form-field>
                <mat-label>To date</mat-label>
                <input
                  matInput
                  type="date"
                  [value]="store.filters().toDate ?? ''"
                  (change)="store.setFilter('toDate', $any($event.target).value)"
                />
              </mat-form-field>
            }

            @if (descriptor.supportsLocation) {
              <mat-form-field>
                <mat-label>Location</mat-label>
                <mat-select
                  [value]="store.filters().location ?? ''"
                  (selectionChange)="store.setFilter('location', $event.value)"
                >
                  <mat-option value="">All locations</mat-option>
                  @for (option of locationOptions; track option.value) {
                    <mat-option [value]="option.value">{{ option.label }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }

            @if (descriptor.supportsSupplier) {
              <mat-form-field>
                <mat-label>Supplier</mat-label>
                <mat-select
                  [value]="store.filters().supplierId ?? ''"
                  (selectionChange)="store.setFilter('supplierId', $event.value)"
                >
                  <mat-option value="">All suppliers</mat-option>
                  @for (option of suppliers(); track option.id) {
                    <mat-option [value]="option.id">{{ option.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }
          </div>

          <!--
            The filters in force, spelled out. A number on screen with an invisible filter
            behind it is the single easiest way to mislead someone, and this row is also
            what gets printed onto the exported file.
          -->
          <div
            class="flex flex-wrap items-center gap-2 border-t border-outline-variant px-4 py-2.5"
          >
            <span class="text-pb-caption text-on-surface-variant">Showing:</span>
            @if (store.appliedFilters().length === 0) {
              <span class="text-pb-caption">all records</span>
            } @else {
              @for (filter of store.appliedFilters(); track filter) {
                <span class="pb-badge pb-badge-pill pb-tone-neutral">{{ filter }}</span>
              }
              <button matButton type="button" class="ml-auto" (click)="store.clearFilters()">
                <mat-icon>filter_alt_off</mat-icon>
                Clear
              </button>
            }
          </div>
        </pb-card>
      }

      @if (totalCards().length > 0) {
        <div class="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          @for (card of totalCards(); track card.label) {
            <pb-stat-card
              [label]="card.label"
              [value]="card.value"
              [icon]="card.icon"
              [caption]="card.caption"
              [loading]="store.loading()"
            />
          }
        </div>
      }

      @if (chartSpec(); as spec) {
        <pb-card [title]="store.result()?.chart?.title ?? ''" class="mb-4">
          <pb-chart [spec]="spec" />
        </pb-card>
      }

      <pb-card padding="none">
        <pb-data-table
          class="p-2"
          [columns]="tableColumns()"
          [rows]="store.rows()"
          [pagination]="store.pagination()"
          [loading]="store.loading()"
          [sortActive]="store.filters().sortField ?? ''"
          [sortDirection]="store.filters().sortDirection ?? ''"
          emptyIcon="query_stats"
          emptyTitle="Nothing matches"
          emptyMessage="No rows for these filters. Try widening the date range or clearing the search."
          (sortChange)="onSort($event)"
          (pageChange)="onPage($event)"
        />
      </pb-card>

      @if (store.result(); as result) {
        <p class="text-pb-caption mt-3 text-on-surface-variant">
          Generated {{ generatedAt() }} · exports contain every matching row, not just this page.
        </p>
      }
    }
  `,
})
export class ReportsPage {
  protected readonly store = inject(ReportsStore);
  private readonly service = inject(ReportService);
  private readonly suppliersService = inject(SupplierService);
  private readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly locationOptions = INVENTORY_LOCATION_OPTIONS;
  protected readonly exporting = signal<ReportFormat | null>(null);

  /** Only needed by the purchase report; harmless to load once for the page. */
  protected readonly suppliers = toSignal(
    this.suppliersService.options().pipe(catchError(() => of([]))),
    { initialValue: [] as readonly SupplierOption[] },
  );

  constructor() {
    // A report view is worth linking to. The id and filters live in the URL so a
    // "last quarter's purchases" link survives a reload and can be pasted to someone else.
    const params = this.route.snapshot.queryParamMap;
    this.store.restore({
      reportId: (params.get('report') as ReportId | null) ?? undefined,
      search: params.get('search') ?? undefined,
      fromDate: params.get('from') ?? undefined,
      toDate: params.get('to') ?? undefined,
      location: params.get('location') ?? undefined,
      supplierId: params.get('supplier') ?? undefined,
      sortField: params.get('sort') ?? undefined,
      sortDirection: (params.get('dir') as 'asc' | 'desc' | null) ?? undefined,
      page: Number(params.get('page') ?? '1'),
    });

    effect(() => {
      const query = this.store.urlState();

      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: query,
        // `replaceUrl` so typing in the search box does not fill the back button with
        // one entry per keystroke-debounce.
        replaceUrl: true,
      });
    });
  }

  /**
   * Builds table columns from the server's descriptors.
   *
   * Formatting is decided by the declared type, so a money column is right-aligned and
   * rupee-prefixed wherever it appears, and a report gaining a column needs no change here.
   */
  protected readonly tableColumns = computed<readonly TableColumn<ReportRow>[]>(() => {
    const descriptor = this.store.descriptor();
    const sortable = new Set(descriptor?.sortFields ?? []);

    return this.store.columns().map((column) => ({
      key: column.key,
      header: column.header,
      value: (row: ReportRow) => this.format(row[column.key], column),
      sortable: sortable.has(column.key),
      numeric: isNumericColumn(column),
      align: isNumericColumn(column) ? ('right' as const) : ('left' as const),
      primary: column === this.store.columns()[0],
    }));
  });

  /** Totals become stat cards, labelled with the column they total. */
  protected readonly totalCards = computed(() => {
    const result = this.store.result();

    if (result === null) {
      return [];
    }

    const cards = Object.entries(result.totals).map(([key, value]) => {
      const column = result.columns.find((candidate) => candidate.key === key);

      return {
        label: column?.header ?? key,
        value: this.format(value, column ?? { key, header: key, type: 'number' }),
        icon: column?.type === 'money' ? 'payments' : 'functions',
        // Says what the number covers. A total beside a paginated table is read as the
        // page's total unless it explicitly says otherwise — and this one is not.
        caption: `across all ${String(result.pagination.total)} rows`,
      };
    });

    return [
      {
        label: 'Rows',
        value: count(result.pagination.total),
        icon: 'table_rows',
        caption: this.store.appliedFilters().length === 0 ? 'unfiltered' : 'matching the filters',
      },
      ...cards,
    ];
  });

  protected readonly chartSpec = computed<ChartSpec | null>(() => {
    const chart = this.store.result()?.chart;

    if (chart === null || chart === undefined || (chart.series[0]?.data.length ?? 0) === 0) {
      return null;
    }

    // A donut takes bare numbers; every other type takes named series. The server sends
    // the named form for both, so the donut is flattened here rather than special-cased
    // in six queries.
    const first = chart.series[0];

    return {
      type: chart.type,
      labels: chart.labels,
      series: chart.type === 'donut' ? (first?.data ?? []) : chart.series,
      horizontal: chart.type === 'bar',
      height: 300,
      ...(chart.valuePrefix === undefined ? {} : { valuePrefix: chart.valuePrefix }),
    };
  });

  protected readonly generatedAt = computed(() => {
    const at = this.store.result()?.generatedAt;
    return at === undefined ? '' : timestamp(at);
  });

  protected onSort(sort: Sort): void {
    this.store.setSort(sort.active, sort.direction === '' ? 'asc' : sort.direction);
  }

  protected onPage(page: PageRequest): void {
    this.store.setPage(page.page, page.pageSize);
  }

  /**
   * Downloads the current report as a file.
   *
   * The blob is saved rather than opened: a spreadsheet rendered in a browser tab is
   * useless, and the server already sets `Content-Disposition: attachment`.
   */
  protected download(format: ReportFormat): void {
    const id = this.store.reportId();

    if (id === null) {
      return;
    }

    this.exporting.set(format);

    this.service.export(id, format, this.store.filters()).subscribe({
      next: (file) => {
        this.exporting.set(null);

        const url = URL.createObjectURL(file.blob);
        const anchor = document.createElement('a');

        anchor.href = url;
        anchor.download = file.filename;
        anchor.click();

        URL.revokeObjectURL(url);
        this.notifications.success(`Downloaded ${file.filename}`);
      },
      error: () => {
        this.exporting.set(null);
        this.notifications.error('The export could not be generated. Please try again.');
      },
    });
  }

  /** Renders a value the way its declared type says it should read. */
  private format(value: string | number | null | undefined, column: ReportColumn): string {
    if (value === null || value === undefined || value === '') {
      return '—';
    }

    if (column.type === 'money') {
      return money(Number(value));
    }

    if (column.type === 'number') {
      return quantity(Number(value));
    }

    if (column.type === 'datetime') {
      return timestamp(String(value));
    }

    return String(value);
  }
}
