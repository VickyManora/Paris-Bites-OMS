import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/services/auth.service';
import type { AppError } from '../../../../core/errors/app-error';
import { Permission } from '../../../../core/models/permission.model';
import { NotificationService } from '../../../../core/services/notification.service';
import { ConfirmDialogService } from '../../../../shared/components/confirm-dialog/confirm-dialog.service';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import { MATERIAL_CORE_IMPORTS } from '../../../../shared/material/material-imports';
import type { StockTransfer, TransferStockEffect } from '../../models/transfer.model';
import { TransferService } from '../../services/transfer.service';
import {
  RejectTransferDialogComponent,
  type RejectTransferDialogData,
} from '../reject-transfer-dialog/reject-transfer-dialog.component';

export interface TransferDetailDialogData {
  readonly transfer: StockTransfer;
}

/**
 * Transfer details, and where its decisions are taken.
 *
 * The available actions come from the server's `canApprove` / `canReject` / `canComplete`
 * flags **intersected with the user's permissions**. Deriving them from the status string here
 * would duplicate the state machine and drift from it; hiding actions the user cannot perform
 * avoids offering a button that returns 403.
 *
 * Closes with the updated transfer when anything changed, so the list can refresh.
 */
@Component({
  selector: 'pb-transfer-detail-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatDialogModule, SpinnerComponent, ...MATERIAL_CORE_IMPORTS],
  template: `
    <h2 mat-dialog-title class="flex flex-wrap items-center gap-2">
      <span>{{ transfer().reference }}</span>
      <span class="text-pb-caption rounded-full px-2.5 py-1" [class]="statusClass()">
        {{ transfer().statusLabel }}
      </span>
    </h2>

    <mat-dialog-content>
      <p class="text-pb-body flex items-center gap-2">
        {{ transfer().fromLocationLabel }}
        <mat-icon class="!h-5 !w-5 !text-xl text-on-surface-variant" aria-hidden="true">
          arrow_forward
        </mat-icon>
        {{ transfer().toLocationLabel }}
      </p>

      @if (transfer().isInTransit) {
        <!-- The one state where stock is at neither location; saying so avoids a
             "where did my stock go" question. -->
        <div
          class="mt-3 flex items-start gap-2 rounded-lg bg-surface-container px-3 py-2.5"
          role="note"
        >
          <mat-icon class="shrink-0 text-primary" aria-hidden="true">local_shipping</mat-icon>
          <p class="text-pb-caption text-on-surface-variant">
            Stock has left {{ transfer().fromLocationLabel }} and is in transit. Mark it received to
            add it to {{ transfer().toLocationLabel }}.
          </p>
        </div>
      }

      @if (transfer().notes) {
        <p class="text-pb-caption mt-3 italic text-on-surface-variant">"{{ transfer().notes }}"</p>
      }

      <!-- Lines -->
      <h3 class="text-pb-subtitle mt-5">Items ({{ transfer().lineCount }})</h3>
      <ul class="mt-2 flex list-none flex-col divide-y divide-outline-variant pl-0">
        @for (line of transfer().lines; track line.id) {
          <li class="flex items-start justify-between gap-3 py-2">
            <div class="min-w-0">
              <p class="text-pb-body truncate">{{ line.itemName }}</p>
              <p class="text-pb-caption text-on-surface-variant">{{ line.categoryLabel }}</p>
            </div>
            <span class="text-pb-body shrink-0 tabular-nums">{{ line.displayQuantity }}</span>
          </li>
        }
      </ul>

      <!-- What the last stock leg did, when this dialog performed it. -->
      @if (effects().length > 0) {
        <h3 class="text-pb-subtitle mt-5">Stock updated</h3>
        <ul class="mt-2 flex list-none flex-col gap-1 pl-0">
          @for (effect of effects(); track effect.itemId) {
            <li class="text-pb-caption tabular-nums text-on-surface-variant">
              {{ effect.itemName }}: {{ effect.quantityBefore }} → {{ effect.quantityAfter }}
            </li>
          }
        </ul>
      }

      <!-- Timeline -->
      <h3 class="text-pb-subtitle mt-5">Timeline</h3>
      <dl class="m-0 mt-2 flex flex-col gap-2">
        <div class="flex items-baseline justify-between gap-3">
          <dt class="text-pb-caption text-on-surface-variant">Requested</dt>
          <dd class="text-pb-caption m-0 text-right">
            {{ transfer().requestedAt | date: 'd MMM y, HH:mm' }}
            @if (transfer().requestedByName) {
              · {{ transfer().requestedByName }}
            }
          </dd>
        </div>

        @if (transfer().reviewedAt) {
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-pb-caption text-on-surface-variant">
              {{ transfer().status === 'REJECTED' ? 'Rejected' : 'Approved' }}
            </dt>
            <dd class="text-pb-caption m-0 text-right">
              {{ transfer().reviewedAt | date: 'd MMM y, HH:mm' }}
              @if (transfer().reviewedByName) {
                · {{ transfer().reviewedByName }}
              }
            </dd>
          </div>
        }

        @if (transfer().reviewNote) {
          <div class="rounded-lg bg-surface-container px-3 py-2">
            <p class="text-pb-caption">{{ transfer().reviewNote }}</p>
          </div>
        }

        @if (transfer().completedAt) {
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-pb-caption text-on-surface-variant">Received</dt>
            <dd class="text-pb-caption m-0 text-right">
              {{ transfer().completedAt | date: 'd MMM y, HH:mm' }}
              @if (transfer().completedByName) {
                · {{ transfer().completedByName }}
              }
            </dd>
          </div>
        }
      </dl>

      @if (busy()) {
        <pb-spinner size="sm" [label]="busyLabel()" [showLabel]="true" />
      }
    </mat-dialog-content>

    <mat-dialog-actions class="!flex-col-reverse !items-stretch gap-2 sm:!flex-row sm:!justify-end">
      <button matButton type="button" [disabled]="busy()" (click)="close()">Close</button>

      @if (showReject()) {
        <button
          matButton
          type="button"
          class="pb-text-error"
          [disabled]="busy()"
          (click)="reject()"
        >
          <mat-icon>block</mat-icon>
          Reject
        </button>
      }

      @if (showApprove()) {
        <button matButton="filled" type="button" [disabled]="busy()" (click)="approve()">
          <mat-icon>check</mat-icon>
          Approve &amp; dispatch
        </button>
      }

      @if (showComplete()) {
        <button matButton="filled" type="button" [disabled]="busy()" (click)="complete()">
          <mat-icon>inventory</mat-icon>
          Mark received
        </button>
      }
    </mat-dialog-actions>
  `,
})
export class TransferDetailDialogComponent {
  readonly dialogRef =
    inject<MatDialogRef<TransferDetailDialogComponent, StockTransfer | undefined>>(MatDialogRef);
  private readonly data = inject<TransferDetailDialogData>(MAT_DIALOG_DATA);
  private readonly service = inject(TransferService);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthService);

  protected readonly transfer = signal<StockTransfer>(this.data.transfer);
  protected readonly effects = signal<readonly TransferStockEffect[]>([]);
  protected readonly busy = signal(false);
  protected readonly busyLabel = signal('Working…');

  /** Whether anything changed, so the caller knows to refresh. */
  private changed = false;

  // Server capability AND user permission — either alone would offer the wrong buttons.
  protected readonly showApprove = computed(
    () => this.transfer().canApprove && this.auth.can(Permission.TRANSFER_APPROVE),
  );

  protected readonly showReject = computed(
    () => this.transfer().canReject && this.auth.can(Permission.TRANSFER_APPROVE),
  );

  protected readonly showComplete = computed(
    () => this.transfer().canComplete && this.auth.can(Permission.TRANSFER_COMPLETE),
  );

  /**
   * The four states, in the design system's semantic tones.
   *
   * These used to name theme roles, and on a rose palette that made approved, rejected and
   * completed three shades of pink — the one distinction a reader actually needs from this pill was
   * the one it could not draw. `COMPLETED` was `bg-primary`, which is worse than ambiguous: solid
   * brand on a status pill made a finished transfer the loudest thing in the dialog.
   */
  protected readonly statusClass = computed(() => {
    switch (this.transfer().status) {
      case 'PENDING':
        return 'pb-tone-neutral';
      case 'APPROVED':
        return 'pb-tone-info';
      case 'REJECTED':
        return 'pb-tone-danger';
      case 'COMPLETED':
        return 'pb-tone-success';
    }
  });

  protected close(): void {
    this.dialogRef.close(this.changed ? this.transfer() : undefined);
  }

  protected async approve(): Promise<void> {
    const current = this.transfer();

    // Approval moves real stock out of the warehouse, so it is confirmed rather than
    // one-click — the detail text states exactly what will happen.
    const confirmed = await this.confirm.ask({
      title: `Approve ${current.reference}?`,
      message: `This deducts the stock from ${current.fromLocationLabel} immediately. It is added to ${current.toLocationLabel} when marked received.`,
      detail: current.lines.map((line) => `${line.itemName} · ${line.displayQuantity}`).join('\n'),
      confirmLabel: 'Approve & dispatch',
      cancelLabel: 'Cancel',
      icon: 'check_circle',
    });

    if (!confirmed) {
      return;
    }

    await this.run('Approving…', async () => {
      const result = await firstValueFrom(this.service.approve(current.id));
      this.transfer.set(result.transfer);
      this.effects.set(result.effects);
      this.notifications.success(`${result.transfer.reference} approved — stock dispatched.`);
    });
  }

  protected async reject(): Promise<void> {
    const current = this.transfer();

    const reason = await firstValueFrom(
      this.dialog
        .open<RejectTransferDialogComponent, RejectTransferDialogData, string | undefined>(
          RejectTransferDialogComponent,
          {
            data: { reference: current.reference },
            width: '460px',
            maxWidth: 'calc(100vw - 2rem)',
          },
        )
        .afterClosed(),
    );

    if (reason === undefined) {
      return;
    }

    await this.run('Rejecting…', async () => {
      const updated = await firstValueFrom(this.service.reject(current.id, reason));
      this.transfer.set(updated);
      this.notifications.info(`${updated.reference} rejected.`);
    });
  }

  protected async complete(): Promise<void> {
    const current = this.transfer();

    await this.run('Recording receipt…', async () => {
      const result = await firstValueFrom(this.service.complete(current.id));
      this.transfer.set(result.transfer);
      this.effects.set(result.effects);
      this.notifications.success(
        `${result.transfer.reference} received — ${result.effects.length} item(s) added to ${result.transfer.toLocationLabel}.`,
      );
    });
  }

  /**
   * Runs one transition, keeping the dialog open on success so the user sees the new status
   * and what moved.
   *
   * On failure the transfer is refetched: the usual cause is that someone else already acted,
   * and re-reading replaces the stale action buttons with the true ones instead of leaving a
   * button that will fail again. `errorInterceptor` has already shown the message.
   */
  private async run(label: string, action: () => Promise<void>): Promise<void> {
    if (this.busy()) {
      return;
    }

    this.busy.set(true);
    this.busyLabel.set(label);

    try {
      await action();
      this.changed = true;
    } catch (error) {
      void (error as AppError);

      try {
        this.transfer.set(await firstValueFrom(this.service.getById(this.transfer().id)));
        this.changed = true;
      } catch {
        // The transfer is gone or unreachable; the error banner already said so.
      }
    } finally {
      this.busy.set(false);
    }
  }
}
