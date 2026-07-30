import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { MATERIAL_CORE_IMPORTS } from '../../material/material-imports';

/**
 * Breadcrumb trail for the current route.
 *
 * Rendered as an ordered list inside `<nav aria-label="Breadcrumb">`, which is the
 * structure screen readers announce as a breadcrumb; a row of divs would convey
 * nothing. Separators are decorative and `aria-hidden`, so they are not read out
 * between every item.
 *
 * On narrow screens only the last two crumbs are kept: a long trail would either
 * wrap onto three lines or force the topbar to scroll sideways.
 */
@Component({
  selector: 'pb-breadcrumbs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ...MATERIAL_CORE_IMPORTS],
  template: `
    @let trail = crumbs();

    @if (trail.length > 0) {
      <nav aria-label="Breadcrumb">
        <!--
          'm-0' is load-bearing. Tailwind's preflight is deliberately not loaded (see
          'tailwind.css'), so a bare 'ol' keeps the browser's default 16px block margin — top *and*
          bottom. That was adding 32px of invisible height to every trail in the app: in the topbar it
          made a 43px block measure 75px inside a 64px bar, which is what pushed the trail against the
          border and clipped its descenders. 'pl-0' next to it resets the list indent for the same
          reason.
        -->
        <ol class="m-0 flex list-none items-center gap-0.5 pl-0">
          @for (crumb of trail; track crumb.label; let first = $first) {
            <!-- Class list as a string: 'sm:flex' cannot be a '[class.x]' key. -->
            <li [class]="crumbClass(trail.length, $index)">
              @if (!first) {
                <!-- Lightened relative to the labels either side of it. A separator at the same
                     weight as the text competes with the words it is separating, which is what
                     makes a long trail read as one run-on string. -->
                <mat-icon class="!h-4 !w-4 shrink-0 !text-[14px] text-outline" aria-hidden="true">
                  chevron_right
                </mat-icon>
              }

              @if (crumb.url === null) {
                <!-- Current page: text, not a link, and marked as current. -->
                <span
                  class="truncate text-pb-caption font-medium text-on-surface"
                  aria-current="page"
                >
                  {{ crumb.label }}
                </span>
              } @else {
                <a [routerLink]="crumb.url" [class]="linkClass()">{{ crumb.label }}</a>
              }
            </li>
          }
        </ol>
      </nav>
    }
  `,
})
export class BreadcrumbsComponent {
  private readonly breadcrumbService = inject(BreadcrumbService);

  /** How many trailing crumbs stay visible on narrow screens. */
  readonly mobileVisibleCount = input<number>(2);

  /**
   * Drops the 44px touch target from the links.
   *
   * Set by the topbar, and only there. On a page the trail is the top of a scrollable column with
   * room to spare, and a 28px-tall crumb is a thing you aim at twice on a phone — so the default is
   * a full 44px target, which WCAG exempts links in a block of text from but which the app is better
   * for having.
   *
   * In the topbar that generosity does not fit: the bar is exactly 64px, and 44px of crumb under an
   * 18px title is 66px of content in it. The trail was overflowing its own row and clipping. Dense
   * mode is honest about the trade — the topbar trail is rendered on tablet and desktop only, where
   * the pointer is a mouse and 20px is an easy target.
   */
  readonly dense = input<boolean>(false);

  protected readonly crumbs = this.breadcrumbService.breadcrumbs;

  /**
   * Built as a string because Tailwind's `hover:` variants cannot be `[class.x]` binding keys.
   *
   * The hover is a colour change without an underline. An underline appearing on hover shifts
   * nothing, but in a trail of three links it makes the row flicker as the pointer crosses it, and
   * the colour alone is unambiguous against `text-on-surface-variant` at rest.
   */
  protected readonly linkClass = computed(() => {
    const base =
      'inline-flex items-center truncate text-pb-caption text-on-surface-variant no-underline transition-colors duration-pb-fast ease-pb-out hover:text-primary';
    return this.dense() ? base : `${base} min-h-11`;
  });

  /**
   * Crumbs outside the trailing window are hidden below `sm` and shown from `sm`
   * up, so the full trail is available on wider screens without ever wrapping the
   * topbar on a phone.
   */
  protected crumbClass(total: number, index: number): string {
    const withinMobileWindow = index >= total - this.mobileVisibleCount();

    return withinMobileWindow
      ? 'flex items-center gap-1 min-w-0'
      : 'hidden sm:flex items-center gap-1 min-w-0';
  }
}
