import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import type { AppError } from '../../../../core/errors/app-error';
import { Permission } from '../../../../core/models/permission.model';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import { MATERIAL_CORE_IMPORTS } from '../../../../shared/material/material-imports';
import type { ConsumptionEntry, ConsumptionRevision } from '../../models/consumption.model';
import { ConsumptionService } from '../../services/consumption.service';
import {
  VoidConsumptionDialogComponent,
  type VoidConsumptionDialogData,
} from '../void-consumption-dialog/void-consumption-dialog.component';

export interface ConsumptionDetailDialogData {
  readonly entry: ConsumptionEntry;
}

export type ConsumptionDetailResult = { readonly action: 'edit' } | { readonly action: 'voided' };

/**
 * One consumption sheet, with what it used and how it has changed.
 *
 * The revision timeline is the point of this screen. An editable stock movement is only
 * trustworthy if the edits are visible, so "recorded 2.1 kg, corrected to 1.2 kg by
 * Priya, because the chocolate was recounted" has to be readable here — not inferred from
 * the item's history one ingredient at a time.
 */
@Component({
  selector: 'pb-consumption-detail-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatDialogModule, HasPermissionDirective, ...MATERIAL_CORE_IMPORTS],
  template: `
    <h2 mat-dialog-title class="!flex !flex-wrap !items-center !gap-2">
      <span>Consumption {{ entry().entryDate }}</span>
      <span class="pb-badge pb-badge-pill pb-tone-neutral">{{ entry().locationLabel }}</span>
      @if (entry().isVoided) {
        <span class="pb-badge pb-badge-pill pb-tone-danger">Voided</span>
      } @else if (entry().isEdited) {
        <span class="pb-badge pb-badge-pill pb-tone-neutral">Edited</span>
      }
    </h2>

    <mat-dialog-content>
      <div class="flex flex-col gap-4">
        @if (entry().isVoided) {
          <!-- A void is a reversal that already succeeded, so this is informational, not an error:
               'info' keeps 'role=status' and stops the panel competing with the record it explains. -->
          <div
            class="pb-tone-info flex items-start gap-2 rounded-lg border px-3 py-2.5"
            role="status"
          >
            <mat-icon class="!h-5 !w-5 !text-xl" aria-hidden="true">undo</mat-icon>
            <span class="text-pb-caption">
              Voided by {{ entry().voidedByName ?? 'someone' }} — {{ entry().voidReason }}. The
              stock has been returned.
            </span>
          </div>
        }

        <dl class="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt class="text-pb-caption text-on-surface-variant">Recorded by</dt>
            <dd class="text-pb-body">{{ entry().recordedByName ?? 'System' }}</dd>
          </div>
          <div>
            <dt class="text-pb-caption text-on-surface-variant">Recorded on</dt>
            <dd class="text-pb-body">{{ entry().createdAt | date: 'medium' }}</dd>
          </div>
        </dl>

        @if (entry().notes; as notes) {
          <p class="rounded-lg bg-surface-container px-3 py-2 text-pb-caption">{{ notes }}</p>
        }

        <section>
          <h3 class="mb-2 text-pb-subtitle">
            {{ entry().lineCount }} {{ entry().lineCount === 1 ? 'item' : 'items' }} used
          </h3>

          <div class="overflow-x-auto">
            <table class="w-full border-collapse text-left text-pb-caption">
              <thead>
                <tr class="border-b border-outline-variant text-on-surface-variant">
                  <th class="py-2 pr-3 font-medium">Item</th>
                  <th class="py-2 text-right font-medium">Used</th>
                </tr>
              </thead>
              <tbody>
                @for (line of entry().lines; track line.id) {
                  <tr class="border-b border-outline-variant/50">
                    <td class="py-2 pr-3">
                      <div>{{ line.itemName }}</div>
                      @if (line.notes) {
                        <div class="text-on-surface-variant text-pb-caption">{{ line.notes }}</div>
                      }
                    </td>
                    <td class="py-2 text-right font-medium tabular-nums">
                      {{ line.displayQuantity }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <!-- The audit trail. -->
        <section>
          <h3 class="mb-2 text-pb-subtitle">History</h3>

          <ol class="flex flex-col gap-3">
            @for (revision of entry().revisions; track revision.id) {
              <li class="flex gap-3">
                <div
                  class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  [class]="markerClass(revision)"
                >
                  <mat-icon class="!h-5 !w-5 !text-xl" aria-hidden="true">
                    {{ icon(revision) }}
                  </mat-icon>
                </div>

                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-baseline gap-x-2">
                    <span class="font-medium text-pb-body">{{ revision.actionLabel }}</span>
                    <span class="text-on-surface-variant text-pb-caption">
                      revision {{ revision.revision }} · {{ revision.actorName ?? 'System' }} ·
                      {{ revision.createdAt | date: 'medium' }}
                    </span>
                  </div>

                  @if (revision.note) {
                    <p class="text-pb-caption">"{{ revision.note }}"</p>
                  }

                  <!-- An edit is shown as what moved, not as the end state: "2.1 → 1.2"
                       is the fact someone reading an audit trail is looking for. -->
                  @for (change of revision.snapshot.changedItems ?? []; track change.itemId) {
                    <p class="text-on-surface-variant text-pb-caption">
                      {{ change.itemName }}:
                      <span class="tabular-nums">{{ change.consumedBefore }}</span>
                      →
                      <span class="tabular-nums">{{ change.consumedAfter }}</span>
                      @if (change.consumedAfter === 0) {
                        (removed)
                      }
                    </p>
                  }

                  @for (returned of revision.snapshot.returnedItems ?? []; track returned.itemId) {
                    <p class="text-on-surface-variant text-pb-caption">
                      Returned {{ returned.quantity }} to {{ returned.itemName }}
                    </p>
                  }

                  @if (revision.action === 'CREATED') {
                    <p class="text-on-surface-variant text-pb-caption">
                      {{ (revision.snapshot.lines ?? []).length }} item(s) deducted from stock
                    </p>
                  }
                </div>
              </li>
            }
          </ol>
        </section>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions
      class="!flex-col-reverse !items-stretch gap-2 sm:!flex-row sm:!justify-between"
    >
      <span>
        @if (!entry().isVoided) {
          <button
            matButton
            type="button"
            class="!text-error"
            *pbHasPermission="voidPermission"
            [disabled]="voiding()"
            (click)="voidEntry()"
          >
            <mat-icon>undo</mat-icon>
            {{ voiding() ? 'Voiding…' : 'Void' }}
          </button>
        }
      </span>

      <span class="flex flex-col-reverse gap-2 sm:flex-row">
        <button matButton type="button" (click)="dialogRef.close()">Close</button>
        @if (!entry().isVoided) {
          <button
            matButton="filled"
            type="button"
            *pbHasPermission="editPermission"
            (click)="dialogRef.close({ action: 'edit' })"
          >
            <mat-icon>edit</mat-icon>
            Edit
          </button>
        }
      </span>
    </mat-dialog-actions>
  `,
})
export class ConsumptionDetailDialogComponent {
  readonly dialogRef =
    inject<MatDialogRef<ConsumptionDetailDialogComponent, ConsumptionDetailResult | undefined>>(
      MatDialogRef,
    );
  private readonly data = inject<ConsumptionDetailDialogData>(MAT_DIALOG_DATA);
  private readonly service = inject(ConsumptionService);
  private readonly dialog = inject(MatDialog);

  protected readonly editPermission = Permission.STOCK_ADJUST;
  /** Voiding returns a whole day's stock, so it sits behind the admin-only write-off gate. */
  protected readonly voidPermission = Permission.STOCK_WRITE_OFF;

  protected readonly entry = computed(() => this.data.entry);
  protected readonly voiding = signal(false);

  protected icon(revision: ConsumptionRevision): string {
    switch (revision.action) {
      case 'CREATED':
        return 'add_circle';
      case 'UPDATED':
        return 'edit';
      case 'VOIDED':
        return 'undo';
    }
  }

  /**
   * Semantic tones, not theme roles. On this app's rose palette `error-container` and
   * `secondary-container` are both pink, so a voided revision and a created one carried the same
   * colour — the timeline read as decoration rather than as history.
   */
  protected markerClass(revision: ConsumptionRevision): string {
    if (revision.action === 'VOIDED') {
      return 'pb-tone-danger';
    }
    if (revision.action === 'CREATED') {
      return 'pb-tone-success';
    }
    return 'pb-tone-neutral';
  }

  /**
   * Voiding asks for a reason before it will proceed.
   *
   * The server requires one, and prompting here means the requirement is met by a field
   * rather than by a rejected request the user has to interpret.
   */
  protected async voidEntry(): Promise<void> {
    const ref = this.dialog.open<
      VoidConsumptionDialogComponent,
      VoidConsumptionDialogData,
      string | undefined
    >(VoidConsumptionDialogComponent, {
      data: { entryDate: this.entry().entryDate, lineCount: this.entry().lineCount },
      width: '520px',
      maxWidth: 'calc(100vw - 2rem)',
    });

    const reason = await firstValueFrom(ref.afterClosed());

    if (reason === undefined) {
      return;
    }

    this.voiding.set(true);

    this.service.void(this.entry().id, { reason }).subscribe({
      next: () => this.dialogRef.close({ action: 'voided' }),
      error: (_error: AppError) => {
        // `errorInterceptor` has already shown the message; just re-enable the button.
        this.voiding.set(false);
      },
    });
  }
}
