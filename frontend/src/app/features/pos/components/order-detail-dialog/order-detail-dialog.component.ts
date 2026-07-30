import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import type { AppError } from '../../../../core/errors/app-error';
import { Permission } from '../../../../core/models/permission.model';
import { NotificationService } from '../../../../core/services/notification.service';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import {
  StatusBadgeComponent,
  type BadgeTone,
} from '../../../../shared/components/status-badge/status-badge.component';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import {
  MATERIAL_CORE_IMPORTS,
  MATERIAL_FORM_IMPORTS,
} from '../../../../shared/material/material-imports';
import { money, timestamp } from '../../../../shared/utils/format.utils';
import {
  ORDER_STATUS_STYLE,
  PAYMENT_METHODS,
  type Order,
  type PaymentMethod,
} from '../../models/pos.model';
import { PosService } from '../../services/pos.service';

export interface OrderDetailDialogData {
  readonly orderId: string;
}

/**
 * One order, in full.
 *
 * Also where the two follow-up actions live — taking payment on an order left unpaid, and
 * cancelling one. Both are here rather than on the list because both need the staff member to
 * have read the order first, and neither is part of the fast path.
 */
@Component({
  selector: 'pb-order-detail-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    SpinnerComponent,
    StatusBadgeComponent,
    HasPermissionDirective,
    ...MATERIAL_CORE_IMPORTS,
    ...MATERIAL_FORM_IMPORTS,
  ],
  template: `
    @if (order(); as detail) {
      <h2 mat-dialog-title class="flex flex-wrap items-center gap-2">
        {{ detail.orderNumber }}
        <pb-status-badge
          [tone]="statusTone(detail)"
          [icon]="statusIcon(detail)"
          [label]="detail.statusLabel"
        />
      </h2>

      <mat-dialog-content>
        <p class="text-pb-caption mt-0 text-on-surface-variant">
          {{ when(detail.createdAt) }}
          @if (detail.placedByName !== null) {
            · by {{ detail.placedByName }}
          }
        </p>

        <ul class="m-0 flex list-none flex-col gap-1 p-0">
          @for (item of detail.items; track item.id) {
            <li class="flex items-baseline gap-2">
              <span class="text-pb-body flex-1">
                {{ item.productName }}
                @if (item.quantity > 1) {
                  <span class="text-on-surface-variant">× {{ item.quantity }}</span>
                }
              </span>
              <span class="text-pb-caption tabular-nums text-on-surface-variant">
                {{ fmt(item.unitPrice) }}
              </span>
              <span class="text-pb-body w-20 text-right font-medium tabular-nums">
                {{ fmt(item.lineTotal) }}
              </span>
            </li>
          }
        </ul>

        <dl class="m-0 mt-4 flex flex-col gap-1 border-t border-outline-variant pt-3">
          <div class="flex justify-between">
            <dt class="text-pb-caption text-on-surface-variant">Subtotal</dt>
            <dd class="text-pb-caption m-0 tabular-nums">{{ fmt(detail.subtotal) }}</dd>
          </div>
          @if (detail.discountAmount > 0) {
            <div class="flex justify-between">
              <dt class="text-pb-caption text-on-surface-variant">
                Discount
                @if (detail.discountType === 'PERCENTAGE') {
                  ({{ detail.discountValue }}%)
                }
              </dt>
              <dd class="text-pb-caption m-0 tabular-nums text-error">
                −{{ fmt(detail.discountAmount) }}
              </dd>
            </div>
            @if (detail.discountReason !== null) {
              <p class="text-pb-caption m-0 italic text-on-surface-variant">
                {{ detail.discountReason }}
              </p>
            }
          }
          <div
            class="mt-1 flex items-baseline justify-between border-t border-outline-variant pt-2"
          >
            <dt class="text-pb-subtitle font-bold">Total</dt>
            <dd class="text-pb-title m-0 font-bold tabular-nums">
              {{ fmt(detail.grandTotal) }}
            </dd>
          </div>
        </dl>

        @if (detail.payments.length > 0) {
          <h3 class="text-pb-subtitle mb-1 mt-4">Payment</h3>
          <ul class="m-0 flex list-none flex-col gap-1 p-0">
            @for (payment of detail.payments; track payment.id) {
              <li class="text-pb-caption">
                {{ payment.methodLabel }} · {{ fmt(payment.amount) }}
                @if (payment.reference !== null) {
                  · ref {{ payment.reference }}
                }
                @if (payment.confirmedByName !== null) {
                  · confirmed by {{ payment.confirmedByName }}
                }
              </li>
            }
          </ul>
        }

        @if (detail.notes !== null) {
          <p class="text-pb-caption mt-4 rounded-xl bg-surface-container-low p-3">
            <span class="font-semibold">Notes:</span> {{ detail.notes }}
          </p>
        }

        @if (detail.customerName !== null || detail.customerPhone !== null) {
          <p class="text-pb-caption mt-3">
            <span class="text-on-surface-variant">Customer:</span>
            {{ detail.customerName ?? 'Not given' }}
            @if (detail.customerPhone !== null) {
              · {{ detail.customerPhone }}
            }
          </p>
        }

        @if (detail.cancelledAt !== null) {
          <div class="pb-tone-danger mt-4 rounded-xl border p-3">
            <p class="text-pb-caption m-0">
              <span class="font-semibold">Cancelled</span>
              @if (detail.cancelledByName !== null) {
                by {{ detail.cancelledByName }}
              }
              · {{ detail.cancelReason }}
            </p>
          </div>
        }

        <!-- Cancelling asks for a reason inline rather than in a second dialog: a dialog on
             top of a dialog is where people lose track of what they were doing. -->
        @if (cancelling()) {
          <mat-form-field class="mt-4 w-full" subscriptSizing="dynamic">
            <mat-label>Why is this being cancelled?</mat-label>
            <input
              matInput
              [value]="cancelReason()"
              maxlength="300"
              (input)="cancelReason.set($any($event.target).value)"
            />
          </mat-form-field>
        }

        @if (detail.amountDue > 0 && choosingMethod()) {
          <div class="mt-4 grid grid-cols-2 gap-2">
            @for (option of methods; track option.value) {
              <button
                matButton="outlined"
                type="button"
                class="!h-14"
                [disabled]="busy()"
                (click)="pay(option.value)"
              >
                <mat-icon>{{ option.icon }}</mat-icon>
                {{ option.label }}
              </button>
            }
          </div>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button matButton type="button" [disabled]="busy()" (click)="close()">Close</button>

        @if (detail.amountDue > 0 && !choosingMethod() && !cancelling()) {
          <button matButton="filled" type="button" (click)="choosingMethod.set(true)">
            <mat-icon>payments</mat-icon>
            Take {{ fmt(detail.amountDue) }}
          </button>
        }

        @if (detail.status !== 'CANCELLED' && !choosingMethod()) {
          @if (cancelling()) {
            <button matButton type="button" [disabled]="busy()" (click)="cancelling.set(false)">
              Keep order
            </button>
            <button
              matButton="filled"
              type="button"
              class="!bg-error !text-on-error"
              [disabled]="busy() || cancelReason().trim().length < 3"
              (click)="confirmCancel()"
            >
              {{ busy() ? 'Cancelling…' : 'Cancel order' }}
            </button>
          } @else {
            <button
              matButton
              type="button"
              *pbHasPermission="cancelPermission"
              (click)="cancelling.set(true)"
            >
              <mat-icon>cancel</mat-icon>
              Cancel order
            </button>
          }
        }
      </mat-dialog-actions>
    } @else if (failed()) {
      <mat-dialog-content>
        <p class="text-pb-body text-error">That order could not be loaded.</p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" (click)="close()">Close</button>
      </mat-dialog-actions>
    } @else {
      <mat-dialog-content>
        <div class="flex justify-center py-10">
          <pb-spinner size="lg" label="Loading the order…" />
        </div>
      </mat-dialog-content>
    }
  `,
})
export class OrderDetailDialogComponent {
  private readonly service = inject(PosService);
  private readonly notifications = inject(NotificationService);
  private readonly dialogRef =
    inject<MatDialogRef<OrderDetailDialogComponent, boolean>>(MatDialogRef);
  private readonly data = inject<OrderDetailDialogData>(MAT_DIALOG_DATA);

  protected readonly methods = PAYMENT_METHODS;
  protected readonly cancelPermission = Permission.POS_ORDER_CANCEL;

  protected readonly order = signal<Order | null>(null);
  protected readonly failed = signal(false);
  protected readonly busy = signal(false);
  protected readonly choosingMethod = signal(false);
  protected readonly cancelling = signal(false);
  protected readonly cancelReason = signal('');

  /** Whether anything changed, so the caller knows to refresh its figures. */
  private changed = false;

  constructor() {
    this.load();
  }

  protected fmt(value: number): string {
    return money(value);
  }

  protected when(iso: string): string {
    return timestamp(iso);
  }

  protected statusIcon(order: Order): string {
    return ORDER_STATUS_STYLE[order.status].icon;
  }

  protected statusTone(order: Order): BadgeTone {
    return ORDER_STATUS_STYLE[order.status].tone;
  }

  protected pay(method: PaymentMethod): void {
    const current = this.order();

    if (current === null) {
      return;
    }

    this.busy.set(true);

    this.service.receivePayment(current.id, method).subscribe({
      next: (updated) => {
        this.order.set(updated);
        this.busy.set(false);
        this.choosingMethod.set(false);
        this.changed = true;
        this.notifications.success(`${updated.orderNumber} paid`);
      },
      error: (error: AppError) => {
        this.busy.set(false);
        this.notifications.error(error.message);
      },
    });
  }

  protected confirmCancel(): void {
    const current = this.order();

    if (current === null) {
      return;
    }

    this.busy.set(true);

    this.service.cancel(current.id, this.cancelReason().trim()).subscribe({
      next: (updated) => {
        this.order.set(updated);
        this.busy.set(false);
        this.cancelling.set(false);
        this.changed = true;
        this.notifications.success(`${updated.orderNumber} cancelled`);
      },
      error: (error: AppError) => {
        this.busy.set(false);
        this.notifications.error(error.message);
      },
    });
  }

  protected close(): void {
    this.dialogRef.close(this.changed);
  }

  private load(): void {
    this.service.order(this.data.orderId).subscribe({
      next: (order) => this.order.set(order),
      error: () => this.failed.set(true),
    });
  }
}
