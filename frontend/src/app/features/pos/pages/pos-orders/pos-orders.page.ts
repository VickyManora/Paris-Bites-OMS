import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import type { Sort } from '@angular/material/sort';
import { DEFAULT_PAGE_SIZE } from '../../../../core/constants/app.constants';
import type { PaginationMeta } from '../../../../core/models/api-response.model';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { DataTableComponent } from '../../../../shared/components/data-table/data-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import type { PageRequest } from '../../../../shared/components/paginator/paginator.component';
import { SearchBoxComponent } from '../../../../shared/components/search-box/search-box.component';
import {
  MATERIAL_CORE_IMPORTS,
  MATERIAL_FORM_IMPORTS,
} from '../../../../shared/material/material-imports';
import type { TableColumn } from '../../../../shared/models/table-column.model';
import { money, timestamp, toDateInput } from '../../../../shared/utils/format.utils';
import { OrderDetailDialogComponent } from '../../components/order-detail-dialog/order-detail-dialog.component';
import {
  PAYMENT_METHODS,
  type Order,
  type OrderStatus,
  type PaymentMethod,
} from '../../models/pos.model';
import { PosService } from '../../services/pos.service';

const EMPTY_PAGINATION: PaginationMeta = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrevious: false,
};

/**
 * The order history.
 *
 * Reuses `pb-data-table`, so it becomes a card list on a phone and gets paging, sorting and
 * the empty state for free — the same component eight other list screens use.
 *
 * **What this returns is decided by the server.** An admin sees every order ever taken; a
 * Store Manager sees their own from today. The date filters are still offered to both because
 * they are harmless: a narrower window inside an already-narrowed set is just a narrower
 * window.
 */
@Component({
  selector: 'pb-pos-orders-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    CardComponent,
    DataTableComponent,
    SearchBoxComponent,
    ...MATERIAL_CORE_IMPORTS,
    ...MATERIAL_FORM_IMPORTS,
  ],
  template: `
    <pb-page-header title="Orders" subtitle="Walk-in orders taken at the counter.">
      <a slot="actions" matButton="filled" href="/pos/new">
        <mat-icon>add</mat-icon>
        New order
      </a>
    </pb-page-header>

    <pb-card padding="none">
      <div class="grid grid-cols-1 gap-3 p-4 lg:grid-cols-5">
        <pb-search-box
          class="lg:col-span-2"
          label="Search orders"
          placeholder="Order number, item, customer…"
          [initialValue]="search()"
          (searchChange)="onSearch($event)"
        />

        <mat-form-field>
          <mat-label>From</mat-label>
          <input
            matInput
            type="date"
            [value]="fromDate()"
            [max]="today"
            (change)="onFrom($any($event.target).value)"
          />
        </mat-form-field>

        <mat-form-field>
          <mat-label>Status</mat-label>
          <mat-select [value]="status() ?? ''" (selectionChange)="onStatus($event.value)">
            <mat-option value="">Any status</mat-option>
            <mat-option value="PENDING_PAYMENT">Awaiting payment</mat-option>
            <mat-option value="PAID">Paid</mat-option>
            <mat-option value="CANCELLED">Cancelled</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field>
          <mat-label>Payment</mat-label>
          <mat-select [value]="method() ?? ''" (selectionChange)="onMethod($event.value)">
            <mat-option value="">Any method</mat-option>
            @for (option of methods; track option.value) {
              <mat-option [value]="option.value">{{ option.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      <pb-data-table
        class="p-2"
        [columns]="columns"
        [rows]="orders()"
        [pagination]="pagination()"
        [loading]="loading()"
        [selectable]="true"
        [sortActive]="sortField()"
        [sortDirection]="sortDirection()"
        [trackBy]="trackById"
        emptyIcon="receipt_long"
        emptyTitle="No orders"
        emptyMessage="Nothing matches these filters."
        (sortChange)="onSort($event)"
        (pageChange)="onPage($event)"
        (rowClick)="open($event)"
      />
    </pb-card>
  `,
})
export class PosOrdersPage implements OnInit {
  private readonly service = inject(PosService);
  private readonly dialog = inject(MatDialog);

  protected readonly methods = PAYMENT_METHODS;
  protected readonly today = toDateInput(new Date());

  protected readonly orders = signal<readonly Order[]>([]);
  protected readonly pagination = signal<PaginationMeta>(EMPTY_PAGINATION);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly fromDate = signal('');
  protected readonly status = signal<OrderStatus | null>(null);
  protected readonly method = signal<PaymentMethod | null>(null);
  protected readonly sortField = signal<'createdAt' | 'grandTotal' | 'orderNumber'>('createdAt');
  protected readonly sortDirection = signal<'asc' | 'desc'>('desc');

  private page = 1;
  private pageSize = DEFAULT_PAGE_SIZE;
  /** Guards against a slow response for an old filter overwriting a newer one. */
  private sequence = 0;

  ngOnInit(): void {
    this.load();
  }

  protected readonly columns = computed<readonly TableColumn<Order>[]>(() => [
    {
      key: 'orderNumber',
      header: 'Order',
      value: (row) => row.orderNumber,
      sortable: true,
      primary: true,
    },
    { key: 'summary', header: 'Items', value: (row) => row.summary, hideOnMobile: true },
    {
      key: 'createdAt',
      header: 'Time',
      value: (row) => timestamp(row.createdAt),
      sortable: true,
      hideOnMobile: true,
    },
    { key: 'status', header: 'Status', value: (row) => row.statusLabel },
    {
      key: 'paymentMethodLabel',
      header: 'Payment',
      value: (row) => row.paymentMethodLabel ?? '—',
      hideOnMobile: true,
    },
    {
      key: 'grandTotal',
      header: 'Total',
      value: (row) => money(row.grandTotal),
      sortable: true,
      align: 'right',
      numeric: true,
    },
  ])();

  protected readonly trackById = (row: Order): string => row.id;

  protected onSearch(value: string): void {
    this.search.set(value);
    this.page = 1;
    this.load();
  }

  protected onFrom(value: string): void {
    this.fromDate.set(value);
    this.page = 1;
    this.load();
  }

  protected onStatus(value: string): void {
    this.status.set(value === '' ? null : (value as OrderStatus));
    this.page = 1;
    this.load();
  }

  protected onMethod(value: string): void {
    this.method.set(value === '' ? null : (value as PaymentMethod));
    this.page = 1;
    this.load();
  }

  protected onSort(sort: Sort): void {
    const field =
      sort.active === 'grandTotal' || sort.active === 'orderNumber' ? sort.active : 'createdAt';

    this.sortField.set(field);
    this.sortDirection.set(sort.direction === 'asc' ? 'asc' : 'desc');
    this.page = 1;
    this.load();
  }

  protected onPage(request: PageRequest): void {
    this.page = request.page;
    this.pageSize = request.pageSize;
    this.load();
  }

  protected open(order: Order): void {
    this.dialog
      .open(OrderDetailDialogComponent, {
        data: { orderId: order.id },
        width: '560px',
        maxWidth: '96vw',
      })
      .afterClosed()
      .subscribe((changed: boolean | undefined) => {
        if (changed === true) {
          this.load();
        }
      });
  }

  private load(): void {
    const sequence = ++this.sequence;
    const term = this.search().trim();
    const from = this.fromDate();

    this.loading.set(true);

    this.service
      .orders({
        page: this.page,
        pageSize: this.pageSize,
        sortField: this.sortField(),
        sortDirection: this.sortDirection(),
        ...(term.length === 0 ? {} : { search: term }),
        ...(from.length === 0 ? {} : { fromDate: from, toDate: this.today }),
        ...(this.status() === null ? {} : { status: this.status() ?? undefined }),
        ...(this.method() === null ? {} : { paymentMethod: this.method() ?? undefined }),
      })
      .subscribe({
        next: (result) => {
          if (sequence !== this.sequence) {
            return;
          }

          this.orders.set(result.items);
          this.pagination.set(result.pagination);
          this.loading.set(false);
        },
        error: () => {
          if (sequence === this.sequence) {
            this.loading.set(false);
          }
        },
      });
  }
}
