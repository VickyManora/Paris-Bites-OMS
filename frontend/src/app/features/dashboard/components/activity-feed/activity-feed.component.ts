import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import type { PbIconName } from '../../../../shared/components/icon/icon-registry';
import { RelativeTimePipe } from '../../../../shared/pipes/relative-time.pipe';
import type { RecentActivity } from '../../models/dashboard.model';

/**
 * The last few stock movements, across every item.
 *
 * Shows *what* moved as well as how much: "Consumed" on its own is a line nobody can act
 * on, which is why the API joins the item name onto the history entry.
 */
@Component({
  selector: 'pb-activity-feed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CardComponent, EmptyStateComponent, IconComponent, RelativeTimePipe],
  template: `
    <pb-card dense title="Recent activity" icon="history" subtitle="Latest stock movements">
      @if (entries().length === 0) {
        <pb-empty-state
          icon="history"
          title="No activity yet"
          message="Stock movements appear here as they happen."
        />
      } @else {
        <ul class="m-0 flex list-none flex-col gap-3 p-0">
          @for (entry of entries(); track entry.id) {
            <li class="flex gap-3">
              <span
                class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-pb-md border"
                [class]="markerClass(entry)"
              >
                <pb-icon [name]="icon(entry)" [size]="15" />
              </span>

              <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-baseline gap-x-2">
                  <span class="font-medium text-pb-body">{{ entry.itemName }}</span>
                  <span class="text-pb-caption text-pb-text-secondary">
                    {{ entry.actionLabel }} · {{ entry.createdAt | pbRelativeTime }}
                  </span>
                </span>

                @if (entry.delta !== null) {
                  <span class="block text-pb-caption">
                    <span class="tabular-nums" [class]="deltaClass(entry)">
                      {{ entry.delta > 0 ? '+' : '' }}{{ entry.delta }}
                    </span>
                    <span class="text-pb-text-muted">
                      · {{ entry.quantityBefore }} → {{ entry.quantityAfter }}
                    </span>
                  </span>
                }

                @if (entry.actorName) {
                  <span class="block text-pb-caption text-pb-text-muted">
                    by {{ entry.actorName }}
                  </span>
                }
              </span>
            </li>
          }
        </ul>
      }
    </pb-card>
  `,
})
export class ActivityFeedComponent {
  readonly entries = input.required<readonly RecentActivity[]>();

  protected icon(entry: RecentActivity): PbIconName {
    switch (entry.action) {
      case 'PURCHASED':
        return 'purchases';
      case 'CONSUMED':
      case 'RECIPE_CONSUMED':
        return 'consumption';
      case 'TRANSFER_IN':
        return 'movedIn';
      case 'TRANSFER_OUT':
        return 'movedOut';
      case 'CREATED':
        return 'created';
      case 'DELETED':
        return 'deleted';
      default:
        return 'adjusted';
    }
  }

  /**
   * The marker now agrees with the figure beside it.
   *
   * These were `secondary-container` for a rise and `tertiary-container` for a fall — two pinks on
   * this palette — while `deltaClass` directly below rendered the same rise in green and the same
   * fall in red. One row therefore made two contradictory claims about direction. Both now come
   * from the semantic set.
   */
  protected markerClass(entry: RecentActivity): string {
    if (entry.delta !== null && entry.delta > 0) {
      return 'pb-tone-success';
    }
    if (entry.delta !== null && entry.delta < 0) {
      return 'pb-tone-danger';
    }
    return 'pb-tone-neutral';
  }

  protected deltaClass(entry: RecentActivity): string {
    if (entry.delta === null || entry.delta === 0) {
      return 'text-on-surface-variant';
    }
    return entry.delta > 0 ? 'text-pb-success-fg' : 'text-pb-danger-fg';
  }
}
