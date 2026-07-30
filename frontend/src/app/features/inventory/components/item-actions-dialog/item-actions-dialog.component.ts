import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MATERIAL_CORE_IMPORTS } from '../../../../shared/material/material-imports';
import type { InventoryItem } from '../../models/inventory.model';

export type ItemAction = 'adjust' | 'edit' | 'history' | 'delete';

export interface ItemActionsDialogData {
  readonly item: InventoryItem;
  readonly canAdjust: boolean;
  readonly canEdit: boolean;
  readonly canDelete: boolean;
}

/**
 * Action sheet for one inventory row.
 *
 * The list uses a row tap to open this rather than per-row icon buttons: four actions do
 * not fit in a table row on a phone, and a row that does nothing when tapped reads as
 * broken. One affordance that works at every size beats two that each work at one.
 *
 * Only permitted actions are rendered — the caller passes the capability flags — so the
 * user is never offered something that would come back 403. The API re-checks regardless.
 */
@Component({
  selector: 'pb-item-actions-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...MATERIAL_CORE_IMPORTS],
  template: `
    <div class="p-2">
      <p class="text-pb-subtitle truncate px-3 pt-2">{{ data.item.name }}</p>
      <p class="text-pb-caption truncate px-3 pb-2 text-on-surface-variant">
        {{ data.item.displayQuantity }} · {{ data.item.locationLabel }}
      </p>

      <div class="flex flex-col gap-0.5">
        @if (data.canAdjust) {
          <button matButton class="!justify-start" type="button" (click)="close('adjust')">
            <mat-icon>swap_vert</mat-icon>
            Adjust quantity
          </button>
        }
        @if (data.canEdit) {
          <button matButton class="!justify-start" type="button" (click)="close('edit')">
            <mat-icon>edit</mat-icon>
            Edit details
          </button>
        }
        <button matButton class="!justify-start" type="button" (click)="close('history')">
          <mat-icon>history</mat-icon>
          View history
        </button>
        @if (data.canDelete) {
          <button
            matButton
            class="!justify-start pb-text-error"
            type="button"
            (click)="close('delete')"
          >
            <mat-icon>delete</mat-icon>
            Delete item
          </button>
        }
      </div>
    </div>
  `,
})
export class ItemActionsDialogComponent {
  private readonly dialogRef =
    inject<MatDialogRef<ItemActionsDialogComponent, ItemAction | undefined>>(MatDialogRef);
  protected readonly data = inject<ItemActionsDialogData>(MAT_DIALOG_DATA);

  protected close(action: ItemAction): void {
    this.dialogRef.close(action);
  }
}
