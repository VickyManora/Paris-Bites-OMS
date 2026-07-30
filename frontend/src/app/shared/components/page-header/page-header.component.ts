import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MATERIAL_CORE_IMPORTS } from '../../material/material-imports';
import { BreadcrumbsComponent } from '../breadcrumbs/breadcrumbs.component';

/**
 * Page title block with optional breadcrumbs and an action slot.
 *
 * Every feature page uses this, so heading level, spacing and the title/action
 * relationship stay consistent instead of each page re-inventing them.
 *
 * Stacks vertically below `sm` and becomes a row from `sm` up: on a phone, a title
 * and a "New product" button side by side leaves neither enough width.
 */
@Component({
  selector: 'pb-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BreadcrumbsComponent, ...MATERIAL_CORE_IMPORTS],
  host: {
    class: 'block',
  },
  template: `
    <!--
      No bottom rule.

      The header used to be underlined across the page, which on a screen whose content is already a
      bordered card drew two horizontal lines 24px apart. Space separates the title from what follows
      it perfectly well, and dropping the rule is most of what makes the page read as Notion rather
      than as a document with a masthead.
    -->
    <header class="pb-pb-4">
      @if (showBreadcrumbs()) {
        <pb-breadcrumbs class="mb-2 block" />
      }

      <div class="flex flex-col gap-pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="min-w-0">
          <h1 class="truncate text-pb-heading text-pb-text">{{ title() }}</h1>
          @if (subtitle()) {
            <p class="mt-pb-1 text-pb-body text-pb-text-secondary">{{ subtitle() }}</p>
          }
        </div>

        <!-- Actions are projected, so the header owns layout and never behaviour.
             'shrink-0' keeps buttons at their natural width while the title
             truncates instead. -->
        <div class="flex shrink-0 flex-wrap items-center gap-pb-2">
          <ng-content select="[slot=actions]" />
        </div>
      </div>
    </header>
  `,
})
export class PageHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  /** Off by default: the topbar already shows the trail on wide screens. */
  readonly showBreadcrumbs = input<boolean>(false);
}
