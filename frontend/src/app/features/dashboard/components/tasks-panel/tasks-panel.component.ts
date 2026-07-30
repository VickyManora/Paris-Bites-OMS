import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import type { PbIconName } from '../../../../shared/components/icon/icon-registry';
import type { DashboardTask } from '../../models/dashboard.model';

/**
 * Today's work, derived from live state.
 *
 * Every row is a link, because a count the user cannot act on is a nag rather than a task.
 * An empty list genuinely means nothing needs doing — the server omits zero-count entries
 * rather than sending "0 items out of stock", which would train people to ignore the panel.
 */
@Component({
  selector: 'pb-tasks-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, CardComponent, EmptyStateComponent, IconComponent],
  template: `
    <pb-card dense title="Today's tasks" icon="checklist">
      @if (tasks().length === 0) {
        <pb-empty-state
          icon="task_alt"
          title="Nothing needs attention"
          message="Stock levels are healthy and nothing is waiting on you."
        />
      } @else {
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          @for (task of tasks(); track task.key) {
            <li>
              <!--
                'no-underline' and an explicit colour are load-bearing, not decoration. Tailwind's
                preflight is deliberately not loaded (see 'tailwind.css'), so these rows were rendering
                as underlined browser-default links — seven of them stacked, which read as a list of
                hyperlinks rather than as a checklist.
              -->
              <a
                [routerLink]="routePath(task)"
                [queryParams]="routeParams(task)"
                class="group flex items-center gap-pb-3 rounded-pb-lg border border-pb-border px-pb-3 py-pb-3 text-pb-text no-underline transition-[background-color,border-color] duration-pb-fast ease-pb-out hover:border-pb-border-strong hover:bg-pb-hover-surface motion-reduce:transition-none"
              >
                <span
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-pb-md border"
                  [class]="badgeClass(task)"
                >
                  <pb-icon [name]="icon(task)" [size]="18" />
                </span>

                <span class="min-w-0 flex-1 text-pb-body">{{ task.label }}</span>

                <!-- The count is the actionable part, so it reads as a figure rather than
                     as part of the sentence. -->
                <span class="font-semibold tabular-nums text-pb-subtitle">{{ task.count }}</span>
                <!-- Slides a pixel on hover, which is the only thing that says the row is a link
                     rather than a summary. -->
                <pb-icon
                  name="expand"
                  [size]="16"
                  class="text-pb-text-muted transition-transform duration-pb-fast ease-pb-out group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
              </a>
            </li>
          }
        </ul>
      }
    </pb-card>
  `,
})
export class TasksPanelComponent {
  readonly tasks = input.required<readonly DashboardTask[]>();

  /** The task's route carries its own filter, e.g. `/inventory?needsRestocking=true`. */
  protected routePath(task: DashboardTask): string {
    return task.route.split('?')[0] ?? task.route;
  }

  protected routeParams(task: DashboardTask): Record<string, string> {
    const query = task.route.split('?')[1];

    if (query === undefined) {
      return {};
    }

    return Object.fromEntries(new URLSearchParams(query).entries());
  }

  protected icon(task: DashboardTask): PbIconName {
    switch (task.severity) {
      case 'critical':
        return 'critical';
      case 'warning':
        return 'warning';
      default:
        return 'info';
    }
  }

  /**
   * Severity in semantic tones.
   *
   * `error-container` and `tertiary-container` are both pink on a rose palette, so critical and
   * warning tasks were indistinguishable — in a panel whose entire job is telling you what to do
   * first. Red against amber restores the ranking, and the icon already differs so the order does
   * not rest on colour alone.
   */
  protected badgeClass(task: DashboardTask): string {
    switch (task.severity) {
      case 'critical':
        return 'pb-tone-danger';
      case 'warning':
        return 'pb-tone-warning';
      default:
        return 'pb-tone-neutral';
    }
  }
}
