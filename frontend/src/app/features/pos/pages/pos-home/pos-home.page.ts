import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnInit,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Permission } from '../../../../core/models/permission.model';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import {
  StatusBadgeComponent,
  type BadgeTone,
} from '../../../../shared/components/status-badge/status-badge.component';
import {
  MATERIAL_CORE_IMPORTS,
  MATERIAL_FORM_IMPORTS,
} from '../../../../shared/material/material-imports';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import { money, plural } from '../../../../shared/utils/format.utils';
import { OrderDetailDialogComponent } from '../../components/order-detail-dialog/order-detail-dialog.component';
import { ORDER_STATUS_STYLE, type Order, type PosDaySummary } from '../../models/pos.model';
import { PosService } from '../../services/pos.service';

/**
 * The POS home screen.
 *
 * One thing dominates it: a full-width button that starts an order. Everything else is a
 * glance — what the day has taken, what is still owed, and the last few orders in case
 * somebody asks about theirs.
 *
 * The recent list is deliberately short. A counter needs "the one I just did", not a ledger;
 * the full history is a tap away and is what the orders screen is for.
 */
@Component({
  selector: 'pb-pos-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    EmptyStateComponent,
    SpinnerComponent,
    StatusBadgeComponent,
    HasPermissionDirective,
    ...MATERIAL_CORE_IMPORTS,
    ...MATERIAL_FORM_IMPORTS,
  ],
  template: `
    <div class="mx-auto flex max-w-6xl flex-col gap-4">
      <header class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-pb-heading m-0 font-bold text-pos-brown">Point of sale</h1>
          <p class="text-pb-body m-0 text-on-surface-variant">
            {{ scopeLabel() }}
          </p>
        </div>

        <a matButton routerLink="/pos/orders">
          <mat-icon>receipt_long</mat-icon>
          {{ canSeeAll() ? 'All orders' : "Today's orders" }}
        </a>
      </header>

      <!--
        The primary action, and it is enormous on purpose. On a tablet propped at a cart this
        is hit with a thumb without looking, which is the difference between a ten-second
        order and a fifteen-second one.
      -->
      <a
        matButton="filled"
        routerLink="/pos/new"
        class="!flex !h-24 !items-center !justify-center !gap-3 !rounded-3xl !bg-pos-brown !text-pos-vanilla"
      >
        <mat-icon class="!h-9 !w-9 !text-[36px]">add_shopping_cart</mat-icon>
        <span class="text-pb-heading font-bold">New order</span>
      </a>

      @if (loading()) {
        <div class="flex justify-center py-10">
          <pb-spinner size="lg" label="Loading today’s figures…" />
        </div>
      } @else if (summary(); as day) {
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div [class]="tileClass">
            <span class="text-pb-caption text-on-surface-variant">Today's revenue</span>
            <span class="text-pb-heading font-bold tabular-nums text-pos-brown">
              {{ fmt(day.revenue) }}
            </span>
            <span class="text-pb-caption text-on-surface-variant">
              {{ plural(day.paidCount, 'paid order') }}
            </span>
          </div>

          <div [class]="tileClass">
            <span class="text-pb-caption text-on-surface-variant">Orders</span>
            <span class="text-pb-heading font-bold tabular-nums text-pos-brown">
              {{ day.orderCount }}
            </span>
            <span class="text-pb-caption text-on-surface-variant">
              {{ plural(day.itemsSold, 'item') }} sold
            </span>
          </div>

          <div [class]="tileClass">
            <span class="text-pb-caption text-on-surface-variant">Pending payment</span>
            <span
              class="text-pb-heading font-bold tabular-nums"
              [class]="day.pendingCount > 0 ? 'text-pb-warning-fg' : 'text-pos-brown'"
            >
              {{ fmt(day.pendingAmount) }}
            </span>
            <span class="text-pb-caption text-on-surface-variant">
              {{ plural(day.pendingCount, 'order') }} waiting
            </span>
          </div>

          <div [class]="tileClass">
            <span class="text-pb-caption text-on-surface-variant">Average order</span>
            <span class="text-pb-heading font-bold tabular-nums text-pos-brown">
              {{ day.averageOrderValue === null ? '—' : fmt(day.averageOrderValue) }}
            </span>
            <span class="text-pb-caption text-on-surface-variant">
              <!-- Cash versus digital is what gets counted at close, so it is on the tile. -->
              {{ fmt(day.byPaymentMethod.CASH) }} cash
            </span>
          </div>
        </div>
      }

      <section
        class="pos-light-surface rounded-2xl border border-pos-gold/40 bg-pos-vanilla text-pos-brown"
      >
        <header class="flex flex-wrap items-center gap-2 border-b border-pos-gold/40 px-4 py-3">
          <h2 class="text-pb-title m-0 font-bold text-pos-brown">Recent orders</h2>

          <mat-form-field class="ml-auto w-full sm:w-72" subscriptSizing="dynamic">
            <mat-label>Quick search</mat-label>
            <mat-icon matPrefix>search</mat-icon>
            <input
              matInput
              type="search"
              placeholder="Order number, item, phone…"
              [value]="search()"
              (input)="onSearch($any($event.target).value)"
            />
          </mat-form-field>
        </header>

        @if (ordersLoading()) {
          <div class="flex justify-center py-8">
            <pb-spinner label="Loading orders…" />
          </div>
        } @else if (orders().length === 0) {
          <pb-empty-state
            icon="receipt_long"
            title="No orders yet"
            [message]="
              search().length > 0
                ? 'Nothing matches that search.'
                : 'Take an order and it will appear here.'
            "
          />
        } @else {
          <ul class="m-0 flex list-none flex-col divide-y divide-pos-gold/30 p-0">
            @for (order of orders(); track order.id) {
              <li>
                <button
                  type="button"
                  class="flex w-full cursor-pointer appearance-none items-center gap-3 border-0 bg-transparent px-4 py-3 text-left font-[inherit] text-inherit hover:bg-pos-pink/30"
                  (click)="openOrder(order)"
                >
                  <div class="min-w-0 flex-1">
                    <p class="text-pb-body m-0 font-semibold">{{ order.orderNumber }}</p>
                    <p class="text-pb-caption m-0 truncate text-on-surface-variant">
                      {{ order.summary }}
                    </p>
                  </div>

                  <!-- Wrapped rather than styled directly: the badge sets its own display, so the
                       responsive hide belongs to a container instead of fighting it. -->
                  <span class="hidden shrink-0 sm:block">
                    <pb-status-badge
                      [tone]="statusTone(order)"
                      [icon]="statusIcon(order)"
                      [label]="order.statusLabel"
                    />
                  </span>

                  <span class="text-pb-body w-24 shrink-0 text-right font-semibold tabular-nums">
                    {{ fmt(order.grandTotal) }}
                  </span>

                  <mat-icon class="shrink-0 text-on-surface-variant">chevron_right</mat-icon>
                </button>
              </li>
            }
          </ul>
        }
      </section>

      <!-- Only shown to whoever can actually act on it. -->
      <p class="text-pb-caption m-0 text-on-surface-variant" *pbHasPermission="cancelPermission">
        Cancelling an order is available from its details.
      </p>
    </div>
  `,
})
export class PosHomePage implements OnInit {
  private readonly service = inject(PosService);
  private readonly dialog = inject(MatDialog);

  protected readonly cancelPermission = Permission.POS_ORDER_CANCEL;
  protected readonly tileClass =
    'pos-light-surface flex flex-col gap-0.5 rounded-2xl border border-pos-gold/40 bg-pos-vanilla p-4 text-pos-brown';

  protected readonly summary = signal<PosDaySummary | null>(null);
  protected readonly orders = signal<readonly Order[]>([]);
  protected readonly loading = signal(true);
  protected readonly ordersLoading = signal(true);
  protected readonly search = signal('');

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly canSeeAll = computed(() => this.summary()?.scope === 'all');

  protected readonly scopeLabel = computed(() => {
    const day = this.summary();

    if (day === null) {
      return 'Walk-in orders';
    }

    // Says whose figures these are. A Store Manager sees their own takings, and a tile that
    // did not say so would read as the whole cart's.
    return day.scope === 'all'
      ? "Walk-in orders · today's figures"
      : 'Walk-in orders · your figures today';
  });

  ngOnInit(): void {
    this.loadSummary();
    this.loadOrders();
  }

  protected fmt(value: number): string {
    return money(value);
  }

  protected plural(value: number, word: string): string {
    return plural(value, word);
  }

  protected statusIcon(order: Order): string {
    return ORDER_STATUS_STYLE[order.status].icon;
  }

  protected statusTone(order: Order): BadgeTone {
    return ORDER_STATUS_STYLE[order.status].tone;
  }

  protected onSearch(value: string): void {
    this.search.set(value);

    // Debounced by hand rather than through `pb-search-box`: this input sits inline in a
    // header with a prefix icon, and the shared component brings its own form field.
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
    }

    this.searchTimer = setTimeout(() => this.loadOrders(), 300);
  }

  protected openOrder(order: Order): void {
    this.dialog
      .open(OrderDetailDialogComponent, {
        data: { orderId: order.id },
        width: '560px',
        maxWidth: '96vw',
      })
      .afterClosed()
      .subscribe((changed: boolean | undefined) => {
        if (changed === true) {
          this.loadSummary();
          this.loadOrders();
        }
      });
  }

  private loadSummary(): void {
    this.service.summary().subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  private loadOrders(): void {
    this.ordersLoading.set(true);

    const term = this.search().trim();

    this.service
      .orders({ page: 1, pageSize: 8, ...(term.length === 0 ? {} : { search: term }) })
      .subscribe({
        next: (result) => {
          this.orders.set(result.items);
          this.ordersLoading.set(false);
        },
        error: () => this.ordersLoading.set(false),
      });
  }
}
