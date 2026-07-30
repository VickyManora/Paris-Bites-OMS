import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { MATERIAL_CORE_IMPORTS } from '../../../../shared/material/material-imports';
import type { LowStockItem } from '../../models/dashboard.model';

/**
 * What to reorder, worst first.
 *
 * Out of stock ranks above merely low, then by how far below the threshold an item has
 * fallen — the order someone with a purchase order to write actually needs.
 */
@Component({
  selector: 'pb-low-stock-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    ...MATERIAL_CORE_IMPORTS,
  ],
  template: `
    <pb-card dense title="Needs restocking" icon="warning">
      @if (items().length === 0) {
        <pb-empty-state
          iconName="ok"
          title="Everything is stocked"
          message="No item is at or below its reorder level."
        />
      } @else {
        <ul class="m-0 flex list-none flex-col divide-y divide-pb-border-subtle p-0">
          @for (item of items(); track item.id) {
            <li class="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                [class]="item.isOutOfStock ? 'bg-pb-danger-base' : 'bg-pb-warning-base'"
                aria-hidden="true"
              ></span>

              <span class="min-w-0 flex-1 truncate text-pb-body">{{ item.name }}</span>

              <span class="shrink-0 text-right">
                <span
                  class="block tabular-nums text-pb-caption"
                  [class.text-pb-danger-fg]="item.isOutOfStock"
                >
                  {{ item.currentQuantity }} {{ item.unitAbbreviation }}
                </span>
                <!-- The threshold is shown beside the level, because "2 kg" only means
                     something next to the number it fell below. -->
                <span class="block text-pb-caption text-pb-text-muted">
                  min {{ item.minimumQuantity }}
                </span>
              </span>
            </li>
          }
        </ul>

        <div class="mt-3">
          <a matButton [routerLink]="['/inventory']" [queryParams]="{ needsRestocking: 'true' }">
            View all
            <pb-icon name="forward" [size]="16" iconPositionEnd class="ml-pb-1" />
          </a>
        </div>
      }
    </pb-card>
  `,
})
export class LowStockPanelComponent {
  readonly items = input.required<readonly LowStockItem[]>();
}
