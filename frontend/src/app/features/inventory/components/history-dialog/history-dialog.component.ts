import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { DEFAULT_PAGE_SIZE } from '../../../../core/constants/app.constants';
import type { PaginationMeta } from '../../../../core/models/api-response.model';
import type { AppError } from '../../../../core/errors/app-error';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import {
  PaginatorComponent,
  type PageRequest,
} from '../../../../shared/components/paginator/paginator.component';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import { MATERIAL_CORE_IMPORTS } from '../../../../shared/material/material-imports';
import {
  INVENTORY_CATEGORY_LABELS,
  INVENTORY_LOCATION_LABELS,
  INVENTORY_UNIT_LABELS,
  type InventoryHistoryEntry,
  type InventoryItem,
} from '../../models/inventory.model';
import { InventoryService } from '../../services/inventory.service';
import { InlineAlertComponent } from '../../../../shared/components/inline-alert/inline-alert.component';

export interface HistoryDialogData {
  readonly item: InventoryItem;
}

/** Field names as a user would read them, for the change list. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: 'Name',
  category: 'Category',
  unit: 'Unit',
  location: 'Location',
  minimumQuantity: 'Minimum quantity',
  purchasePrice: 'Purchase price',
  supplierId: 'Supplier',
  lowStockAlertEnabled: 'Low-stock alert',
  batchNumber: 'Batch number',
  expiryDate: 'Expiry date',
  status: 'Status',
  notes: 'Notes',
};

/**
 * Change history for one item, newest first.
 *
 * Rendered as a timeline rather than a table: entries are heterogeneous — a quantity
 * change, a rename, a status flip — and forcing them into shared columns would leave most
 * cells empty.
 *
 * Enum values are translated back to labels, because "SUGAR_AND_SWEETENERS" in an audit
 * trail is not something anyone should have to decode.
 */
@Component({
  selector: 'pb-history-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    InlineAlertComponent,
    DatePipe,
    MatDialogModule,
    EmptyStateComponent,
    PaginatorComponent,
    SpinnerComponent,
    ...MATERIAL_CORE_IMPORTS,
  ],
  template: `
    <h2 mat-dialog-title>History</h2>

    <mat-dialog-content class="!max-h-[70vh]">
      <p class="text-pb-body">
        <strong>{{ item.name }}</strong>
        <span class="text-on-surface-variant"> · {{ item.locationLabel }}</span>
      </p>

      @if (loading()) {
        <pb-spinner size="md" label="Loading history…" />
      } @else if (error(); as failure) {
        <pb-inline-alert class="mt-4" [message]="failure.message" />
      } @else if (entries().length === 0) {
        <pb-empty-state icon="history" title="No history yet" message="Changes will appear here." />
      } @else {
        <ol class="mt-4 flex list-none flex-col gap-0 pl-0">
          @for (entry of entries(); track entry.id) {
            <!-- The connecting line is drawn on the marker column and suppressed on the
                 last item, so the timeline does not trail off past the final entry. -->
            <li class="flex gap-3">
              <div class="flex flex-col items-center">
                <span
                  class="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                  [class]="markerClass(entry)"
                >
                  <mat-icon class="!h-4 !w-4 !text-base" aria-hidden="true">
                    {{ icon(entry) }}
                  </mat-icon>
                </span>
                @if (!$last) {
                  <span class="w-px flex-1 bg-outline-variant"></span>
                }
              </div>

              <div class="min-w-0 flex-1 pb-4">
                <div class="flex flex-wrap items-baseline gap-x-2">
                  <p class="text-pb-body font-medium">{{ entry.actionLabel }}</p>
                  @if (entry.delta !== null) {
                    <span class="text-pb-caption tabular-nums" [class]="deltaClass(entry)">
                      {{ entry.delta > 0 ? '+' : '' }}{{ entry.delta }} {{ item.unitAbbreviation }}
                    </span>
                  }
                </div>

                @if (entry.quantityBefore !== null && entry.quantityAfter !== null) {
                  <p class="text-pb-caption text-on-surface-variant tabular-nums">
                    {{ entry.quantityBefore }} → {{ entry.quantityAfter }}
                    {{ item.unitAbbreviation }}
                  </p>
                } @else if (entry.quantityAfter !== null) {
                  <p class="text-pb-caption text-on-surface-variant tabular-nums">
                    Opening quantity {{ entry.quantityAfter }} {{ item.unitAbbreviation }}
                  </p>
                }

                @if (entry.changes) {
                  <ul class="mt-1 flex list-none flex-col gap-0.5 pl-0">
                    @for (change of changeList(entry); track change.field) {
                      <li class="text-pb-caption text-on-surface-variant">
                        {{ change.field }}:
                        <span class="line-through">{{ change.from }}</span>
                        →
                        <span class="text-on-surface">{{ change.to }}</span>
                      </li>
                    }
                  </ul>
                }

                @if (entry.note) {
                  <p class="text-pb-caption mt-1 italic text-on-surface-variant">
                    "{{ entry.note }}"
                  </p>
                }

                <p class="text-pb-caption mt-1 text-on-surface-variant">
                  {{ entry.createdAt | date: 'd MMM y, HH:mm' }}
                  @if (entry.actorName) {
                    · {{ entry.actorName }}
                  }
                </p>
              </div>
            </li>
          }
        </ol>

        @if (pagination().totalPages > 1) {
          <pb-paginator
            [pagination]="pagination()"
            [hidePageSize]="true"
            (pageChange)="onPageChange($event)"
          />
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button matButton type="button" (click)="dialogRef.close()">Close</button>
    </mat-dialog-actions>
  `,
})
export class HistoryDialogComponent {
  readonly dialogRef = inject<MatDialogRef<HistoryDialogComponent>>(MatDialogRef);
  private readonly data = inject<HistoryDialogData>(MAT_DIALOG_DATA);
  private readonly service = inject(InventoryService);

  protected readonly item = this.data.item;

  protected readonly entries = signal<readonly InventoryHistoryEntry[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<AppError | null>(null);
  protected readonly pagination = signal<PaginationMeta>({
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrevious: false,
  });

  constructor() {
    this.load(1, DEFAULT_PAGE_SIZE);
  }

  protected onPageChange(request: PageRequest): void {
    this.load(request.page, request.pageSize);
  }

  private load(page: number, pageSize: number): void {
    this.loading.set(true);
    this.error.set(null);

    this.service.history(this.item.id, page, pageSize).subscribe({
      next: (result) => {
        this.entries.set(result.items);
        this.pagination.set(result.pagination);
        this.loading.set(false);
      },
      error: (failure: AppError) => {
        this.error.set(failure);
        this.loading.set(false);
      },
    });
  }

  protected icon(entry: InventoryHistoryEntry): string {
    switch (entry.action) {
      case 'CREATED':
        return 'add_circle';
      case 'QUANTITY_ADJUSTED':
        return entry.delta !== null && entry.delta > 0 ? 'trending_up' : 'trending_down';
      case 'STATUS_CHANGED':
        return 'toggle_on';
      case 'DELETED':
        return 'delete';
      case 'RESTORED':
        return 'restore';
      case 'UPDATED':
        return 'edit';
      // Stock arriving and leaving are given directional icons rather than the generic
      // adjustment ones, because where the stock went is the first thing anyone reading
      // a timeline wants to know.
      case 'TRANSFER_OUT':
        return 'call_made';
      case 'TRANSFER_IN':
        return 'call_received';
      case 'PURCHASED':
        return 'receipt_long';
      case 'RECIPE_CONSUMED':
        return 'restaurant';
    }
  }

  /** Semantic tones: `error-container` and `secondary-container` are both pink here. */
  protected markerClass(entry: InventoryHistoryEntry): string {
    if (entry.action === 'DELETED') {
      return 'pb-tone-danger';
    }
    if (entry.action === 'CREATED') {
      return 'pb-tone-success';
    }
    return 'pb-tone-neutral';
  }

  protected deltaClass(entry: InventoryHistoryEntry): string {
    if (entry.delta === null || entry.delta === 0) {
      return 'text-on-surface-variant';
    }
    return entry.delta > 0 ? 'text-pb-success-fg' : 'text-pb-danger-fg';
  }

  /** Flattens the `changes` map into a displayable list with readable values. */
  protected changeList(
    entry: InventoryHistoryEntry,
  ): readonly { field: string; from: string; to: string }[] {
    if (entry.changes === null) {
      return [];
    }

    return Object.entries(entry.changes).map(([field, change]) => ({
      field: FIELD_LABELS[field] ?? field,
      from: this.readable(change.from),
      to: this.readable(change.to),
    }));
  }

  /** Translates stored enum values back to their labels; "—" for absent values. */
  private readable(value: string | number | null): string {
    if (value === null || value === '') {
      return '—';
    }

    if (typeof value === 'number') {
      return String(value);
    }

    return (
      INVENTORY_CATEGORY_LABELS[value as keyof typeof INVENTORY_CATEGORY_LABELS] ??
      INVENTORY_LOCATION_LABELS[value as keyof typeof INVENTORY_LOCATION_LABELS] ??
      INVENTORY_UNIT_LABELS[value as keyof typeof INVENTORY_UNIT_LABELS] ??
      value
    );
  }
}
