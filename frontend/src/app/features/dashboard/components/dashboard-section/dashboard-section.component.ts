import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import type { PbIconName } from '../../../../shared/components/icon/icon-registry';

/**
 * A titled band of the dashboard.
 *
 * The dashboard's problem was never that any one card was wrong — it was that twenty of them
 * arrived at the same size with the same border and no stated relationship, so the page read as an
 * inventory of everything the API could return. Grouping is what turns that into a document: a
 * heading says what the next few figures are *about*, and the space above the heading says the
 * previous subject has ended.
 *
 * The rule this component exists to enforce is that the gap **between** sections is much larger than
 * any gap inside one. That single ratio does most of the work of making a dense screen readable, and
 * it is the first thing to drift when every section spells out its own margins.
 *
 * The heading is an `<h2>`: the page title in the topbar is the `<h1>`, so these are its children and
 * a screen reader can jump between them. Purely decorative icons are hidden from that outline.
 */
@Component({
  selector: 'pb-dashboard-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: {
    // 'block' so the host itself is the spacing element; callers set no margins of their own.
    class: 'block',
  },
  template: `
    <section>
      @if (title()) {
        <!--
          The heading sits in a tinted tile beside its title rather than as a loose glyph.

          At 20px an outline icon next to 18px text is two marks of similar weight competing on one
          baseline; the tile gives the section a fixed optical anchor down the left edge of the page,
          so five headings read as a spine rather than as five sentences that happen to start with a
          picture.
        -->
        <div class="mb-pb-4 flex items-center gap-pb-3">
          @if (icon(); as name) {
            <span
              class="grid h-8 w-8 shrink-0 place-items-center rounded-pb-md border border-pb-border bg-pb-surface text-pb-text-secondary"
              aria-hidden="true"
            >
              <pb-icon [name]="name" [size]="16" />
            </span>
          }

          <h2 class="m-0 shrink-0 text-pb-title text-pb-text">
            {{ title() }}
          </h2>

          @if (hint()) {
            <!--
              The caveat that belongs to the whole section, on the heading's own baseline.

              Sitting it beside the title rather than under it keeps the heading one line tall, which
              matters when there are five of these down the page — and a qualifier on the same line
              reads as part of the heading rather than as the section's first sentence.
            -->
            <p class="m-0 min-w-0 flex-1 truncate text-pb-caption text-pb-text-muted">
              {{ hint() }}
            </p>
          }
        </div>
      }

      <ng-content />
    </section>
  `,
})
export class DashboardSectionComponent {
  readonly title = input<string>('');
  readonly icon = input<PbIconName | null>(null);
  /** A qualifier for the whole section, e.g. what the figures below deliberately exclude. */
  readonly hint = input<string>('');
}
