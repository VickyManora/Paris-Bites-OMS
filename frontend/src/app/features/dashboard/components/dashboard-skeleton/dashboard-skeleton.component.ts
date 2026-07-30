import { ChangeDetectionStrategy, Component } from '@angular/core';
import { SkeletonComponent } from '../../../../shared/components/skeleton/skeleton.component';

/**
 * The dashboard's shape, drawn before its numbers arrive.
 *
 * ## Why this replaced a spinner
 *
 * The dashboard is the landing route, so this is the first thing anyone sees after signing in. It
 * used to be a centred `pb-spinner` on an otherwise empty page, which has two costs. The smaller one
 * is that a spinner says "wait" without saying what for. The larger one is layout: the spinner
 * occupies one line, so when the data lands the page grows from ~80px to ~2000px in a single frame
 * and everything the reader's eye had settled on jumps. A placeholder the same shape as the result
 * means the arrival is a fill, not a reflow.
 *
 * ## It mirrors the real bands, not a generic grid
 *
 * The proportions here are copied from `pb-admin-dashboard`: a hero at `lg:col-span-1` beside a
 * two-column tile grid, then a metric strip and a pair of chart cards per band. A placeholder whose
 * geometry disagrees with the content is worse than none — it promises one layout and delivers
 * another, which is the jump this exists to prevent.
 *
 * Only two bands are drawn. Below roughly 1400px the third is off-screen at first paint, and
 * skeletons for content nobody has scrolled to are just work.
 *
 * The whole thing is `aria-hidden` with a single live message instead: a screen reader wants
 * "loading your dashboard", not sixty empty boxes. `pb-skeleton` itself carries the reduced-motion
 * handling.
 */
@Component({
  selector: 'pb-dashboard-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SkeletonComponent],
  template: `
    <span class="sr-only" role="status">Loading your dashboard…</span>

    <div class="flex flex-col gap-pb-7" aria-hidden="true">
      <!--
        Hero band: the gold card beside three tiles, at the live layout's 2-of-5 / 3-of-5 split.

        The hero placeholder carries the *tinted* surface rather than a grey one. A skeleton's job is
        to hold the shape of what is coming, and the single warm card is the most recognisable thing
        about this page — a grey box in its place means the layout visibly changes colour on arrival,
        which is the flash the skeleton exists to prevent.
      -->
      <div class="grid gap-pb-4 lg:grid-cols-5">
        <div
          class="flex flex-col gap-pb-3 rounded-pb-xl border border-pb-accent-border bg-pb-accent-surface p-pb-4 lg:col-span-2 sm:p-pb-5"
        >
          <pb-skeleton variant="text" width="45%" />
          <pb-skeleton variant="heading" width="70%" height="3.25rem" />
          <pb-skeleton variant="text" width="55%" />
          <div class="mt-auto pt-pb-4">
            <pb-skeleton variant="button" width="11rem" />
          </div>
        </div>

        <div class="grid gap-pb-4 sm:grid-cols-3 lg:col-span-3">
          @for (tile of leadTiles; track tile) {
            <div
              class="flex flex-col gap-pb-3 rounded-pb-lg border border-pb-border bg-pb-surface p-pb-4"
            >
              <div class="flex items-start justify-between gap-pb-3">
                <pb-skeleton variant="text" width="6rem" />
                <pb-skeleton variant="block" width="2rem" height="2rem" />
              </div>
              <div class="mt-auto flex flex-col gap-pb-2">
                <pb-skeleton variant="heading" width="5.5rem" height="1.875rem" />
                <pb-skeleton variant="text" width="6rem" />
              </div>
            </div>
          }
        </div>
      </div>

      <!--
        Business health: four filled cards.

        Left neutral rather than tinted green/amber/red — a skeleton that guessed a tone would be
        telling the user something is wrong before anything has loaded, and it would be wrong most of
        the time. The *shape* is the promise; the colour is the answer, and the answer is not known
        yet.
      -->
      <div class="flex flex-col gap-pb-4">
        <div class="flex items-center gap-pb-3">
          <pb-skeleton variant="block" width="2rem" height="2rem" />
          <pb-skeleton variant="text" width="9rem" height="1.125rem" />
        </div>
        <div class="grid gap-pb-4 sm:grid-cols-2 xl:grid-cols-4">
          @for (tile of tiles; track tile) {
            <div
              class="flex flex-col gap-pb-3 rounded-pb-lg border border-pb-border bg-pb-surface-sunken p-pb-4"
            >
              <div class="flex items-start justify-between gap-pb-3">
                <pb-skeleton variant="text" width="6rem" />
                <pb-skeleton variant="block" width="1.75rem" height="1.75rem" />
              </div>
              <pb-skeleton variant="heading" width="4rem" height="1.875rem" />
              <pb-skeleton variant="text" width="7rem" />
            </div>
          }
        </div>
      </div>

      @for (band of bands; track band) {
        <div class="flex flex-col gap-pb-4">
          <!-- The band heading: tile, title, and the qualifier beside it. -->
          <div class="flex items-center gap-pb-3">
            <pb-skeleton variant="block" width="2rem" height="2rem" />
            <pb-skeleton variant="text" width="7rem" height="1.125rem" />
            <pb-skeleton variant="text" width="14rem" />
          </div>

          <!-- The metric strip: three cells divided by rules, as in pb-metric-strip. -->
          <div
            class="grid divide-pb-border-subtle rounded-pb-lg border border-pb-border bg-pb-surface sm:grid-cols-3 sm:divide-x"
          >
            @for (cell of cells; track cell) {
              <div class="flex flex-col gap-pb-2 p-pb-4">
                <pb-skeleton variant="text" width="6rem" />
                <pb-skeleton variant="heading" width="4.5rem" height="1.5rem" />
                <pb-skeleton variant="text" width="7rem" />
              </div>
            }
          </div>

          <!-- Two chart cards, the wider one first. -->
          <div class="grid gap-pb-4 lg:grid-cols-3">
            <div
              class="flex flex-col gap-pb-3 rounded-pb-lg border border-pb-border bg-pb-surface p-pb-4 lg:col-span-2"
            >
              <pb-skeleton variant="text" width="10rem" height="1.125rem" />
              <pb-skeleton variant="text" width="14rem" />
              <pb-skeleton variant="block" height="14rem" />
            </div>
            <div
              class="flex flex-col gap-pb-3 rounded-pb-lg border border-pb-border bg-pb-surface p-pb-4"
            >
              <pb-skeleton variant="text" width="8rem" height="1.125rem" />
              <pb-skeleton variant="text" width="10rem" />
              <pb-skeleton variant="block" height="14rem" />
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class DashboardSkeletonComponent {
  /** Track-by handles for the fixed repeats. The values are never read. */
  /** Three beside the hero, four in Business health — the counts differ, so the arrays do too. */
  protected readonly leadTiles = [0, 1, 2];
  protected readonly tiles = [0, 1, 2, 3];
  protected readonly bands = [0, 1];
  protected readonly cells = [0, 1, 2];
}
