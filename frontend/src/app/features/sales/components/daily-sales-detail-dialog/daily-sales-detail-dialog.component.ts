import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Permission } from '../../../../core/models/permission.model';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import { MATERIAL_CORE_IMPORTS } from '../../../../shared/material/material-imports';
import { RelativeTimePipe } from '../../../../shared/pipes/relative-time.pipe';
import { SALES_BUCKETS, type DailySalesEntry } from '../../models/daily-sales.model';
import { DailySalesService } from '../../services/daily-sales.service';
import { money } from '../../../../shared/utils/format.utils';

export interface DailySalesDetailDialogData {
  readonly entryId: string;
}

/**
 * One day, broken down, with how it has changed.
 *
 * Fetched fresh by id rather than handed the list's row: the list omits the revision
 * trail, and the trail is the reason this dialog exists. A day's revenue that was
 * corrected without the correction being visible is the failure this guards against.
 */
@Component({
  selector: 'pb-daily-sales-detail-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    SpinnerComponent,
    RelativeTimePipe,
    HasPermissionDirective,
    ...MATERIAL_CORE_IMPORTS,
  ],
  template: `
    @if (entry(); as day) {
      <h2 mat-dialog-title class="flex items-center gap-2">
        {{ formatDate(day.entryDate) }}
        @if (day.isEdited) {
          <span class="pb-badge pb-badge-pill pb-tone-info">corrected</span>
        }
      </h2>

      <mat-dialog-content>
        <div
          class="mb-4 flex items-baseline justify-between rounded-xl bg-surface-container-high px-4 py-3"
        >
          <span class="text-pb-subtitle">Day total</span>
          <span class="text-pb-heading tabular-nums">{{ format(day.totalAmount) }}</span>
        </div>

        <dl class="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
          @for (bucket of buckets; track bucket.key) {
            <dt class="text-pb-body flex items-center gap-2">
              <mat-icon class="!h-5 !w-5 !text-[20px] text-on-surface-variant">
                {{ bucket.icon }}
              </mat-icon>
              {{ bucket.label }}
            </dt>
            <dd class="text-pb-body m-0 text-right tabular-nums">
              {{ format(day.amounts[bucket.key] ?? 0) }}
            </dd>
          }
        </dl>

        <!-- The two splits the business actually reasons about, kept out of the bucket
             list so they read as conclusions rather than more inputs. -->
        <div class="mt-4 grid grid-cols-2 gap-3">
          <div class="rounded-xl border border-outline-variant p-3">
            <p class="text-pb-caption m-0 text-on-surface-variant">Cash / online</p>
            <p class="text-pb-body m-0 tabular-nums">
              {{ format(day.cashTotal) }} / {{ format(day.onlineTotal) }}
            </p>
          </div>
          <div class="rounded-xl border border-outline-variant p-3">
            <p class="text-pb-caption m-0 text-on-surface-variant">Own counter / platforms</p>
            <p class="text-pb-body m-0 tabular-nums">
              {{ format(day.walkInTotal) }} / {{ format(day.aggregatorTotal) }}
              @if (day.aggregatorSharePercent !== null) {
                <span class="text-on-surface-variant">({{ day.aggregatorSharePercent }}%)</span>
              }
            </p>
          </div>
        </div>

        @if (day.notes !== null && day.notes.length > 0) {
          <p class="text-pb-caption mt-4 rounded-xl bg-surface-container-low p-3">
            {{ day.notes }}
          </p>
        }

        <h3 class="text-pb-subtitle mb-2 mt-6">History</h3>
        <ul class="m-0 flex list-none flex-col gap-3 p-0">
          @for (revision of day.revisions; track revision.id) {
            <li class="border-l-2 border-outline-variant pl-3">
              <p class="text-pb-caption m-0">
                <span class="font-semibold">{{ revision.actionLabel }}</span>
                by {{ revision.actorName ?? 'someone since removed' }} ·
                {{ revision.createdAt | pbRelativeTime }}
              </p>
              <p class="text-pb-caption m-0 tabular-nums text-on-surface-variant">
                {{ format(revision.snapshot.totalAmount) }}
                @if (revision.snapshot.previousTotal !== undefined) {
                  <span>(was {{ format(revision.snapshot.previousTotal) }})</span>
                }
              </p>
              @if (revision.note !== null) {
                <p class="text-pb-caption m-0 italic text-on-surface-variant">
                  {{ revision.note }}
                </p>
              }
            </li>
          }
        </ul>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button matButton type="button" (click)="close()">Close</button>
        <button
          matButton="filled"
          type="button"
          *pbHasPermission="recordPermission"
          (click)="edit()"
        >
          <mat-icon>edit</mat-icon>
          Correct
        </button>
      </mat-dialog-actions>
    } @else if (failed()) {
      <mat-dialog-content>
        <p class="text-pb-body text-error">That day could not be loaded.</p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" (click)="close()">Close</button>
      </mat-dialog-actions>
    } @else {
      <mat-dialog-content>
        <div class="flex justify-center py-10">
          <pb-spinner size="lg" label="Loading the day…" />
        </div>
      </mat-dialog-content>
    }
  `,
})
export class DailySalesDetailDialogComponent {
  private readonly service = inject(DailySalesService);
  private readonly dialogRef =
    inject<MatDialogRef<DailySalesDetailDialogComponent, 'edit' | undefined>>(MatDialogRef);
  private readonly data = inject<DailySalesDetailDialogData>(MAT_DIALOG_DATA);

  protected readonly buckets = SALES_BUCKETS;
  protected readonly recordPermission = Permission.SALE_RECORD;
  protected readonly entry = signal<DailySalesEntry | null>(null);
  protected readonly failed = signal(false);

  constructor() {
    this.service.getById(this.data.entryId).subscribe({
      next: (entry) => this.entry.set(entry),
      error: () => this.failed.set(true),
    });
  }

  protected format(value: number): string {
    return money(value);
  }

  protected formatDate(date: string): string {
    return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  protected edit(): void {
    this.dialogRef.close('edit');
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
