import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { NotificationStore } from '../../../core/notifications/services/notification-store.service';
import { deepLinkFor } from '../../../core/notifications/models/entity-links';
import {
  SEVERITY_TONE_CLASSES,
  type AppNotification,
} from '../../../core/notifications/models/notification.model';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { iconForServerName, type PbIconName } from '../../../shared/components/icon/icon-registry';
import { SpinnerComponent } from '../../../shared/components/spinner/spinner.component';
import { MATERIAL_LAYOUT_IMPORTS } from '../../../shared/material/material-imports';
import { RelativeTimePipe } from '../../../shared/pipes/relative-time.pipe';

/**
 * Notification bell: an unread badge, and a panel of the newest few.
 *
 * Reads `NotificationStore`, which owns the polling and is root-provided — the bell is
 * mounted once in the topbar and never unmounts while signed in.
 *
 * Interaction model, and why:
 *
 * - **Opening the panel does not mark anything read.** Bulk-clearing on open makes the
 *   badge useless: a glance at a busy inbox would silently discard everything the user
 *   had not got to. Reading is per-item, or an explicit "Mark all read".
 * - **Clicking an entry marks it read and navigates** to what it is about. That is the
 *   one gesture where "I have dealt with this" is unambiguous.
 * - **Unread entries carry a dot and a heavier title**, so the distinction survives
 *   without colour — the panel is already colour-coded by severity, and stacking two
 *   meanings on one channel fails for anyone who cannot separate them.
 *
 * The panel's own geometry — width, height ceiling, full-bleed rows, sticky header and footer — is in
 * `.pb-notification-menu` in `styles.scss`, because a menu renders in an overlay at the document root
 * where a component's scoped styles cannot reach it. It previously used `::ng-deep` for that, which
 * worked only by leaking globally, i.e. by being the deprecated spelling of the same thing.
 */
@Component({
  selector: 'pb-app-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    SpinnerComponent,
    RelativeTimePipe,
    RouterLink,
    ...MATERIAL_LAYOUT_IMPORTS,
  ],
  host: {
    class: 'block',
  },
  template: `
    <!--
      The bell, with the count as its own element rather than Material's 'matBadge'.

      'matBadge' renders a filled disc in a theme colour, positioned from the host's box — which put
      it half outside a 40px button and painted it in the palette's 'warn', i.e. the same red as a
      validation error. An unread count is not an error.

      This is a pill in the interaction pink, clamped to the button's corner and readable at two
      digits. It also lets the number carry 'tabular-nums', so a badge going 9 → 10 grows once
      instead of jittering.
    -->
    <button
      type="button"
      [class]="triggerClass"
      [matMenuTriggerFor]="menu"
      [attr.aria-label]="store.badgeDescription()"
      matTooltip="Notifications"
      (menuOpened)="onOpened()"
    >
      <pb-icon name="notifications" [size]="18" />

      <!--
        'hidden' rather than an @if so the element is not recreated on every count change — a fresh
        node would restart the pop animation each time the number moved.
      -->
      <span
        class="pb-pop absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-pb-full bg-pb-badge px-1 text-[10px] font-semibold leading-none text-pb-on-badge tabular-nums"
        [class.hidden]="!store.hasUnread()"
        aria-hidden="true"
      >
        {{ store.badgeLabel() }}
      </span>
    </button>

    <!-- Both classes: 'pb-shell-menu' for the radius, border and hairline elevation every dropdown in
         the shell shares, and 'pb-notification-menu' for what makes this one a list. The panel used to
         carry only the second and was the one dropdown with Material's default chrome. -->
    <mat-menu #menu="matMenu" class="pb-shell-menu pb-notification-menu">
      <!-- Header sits outside the item list: it is not navigable, and letting arrow keys
           land on it would make the panel awkward to work through from the keyboard.
           Sticky, so "Mark all read" stays reachable once ten entries are scrolling past it. -->
      <div
        class="pb-menu-sticky-header flex items-center justify-between gap-pb-2 border-b border-outline-variant px-pb-3 py-pb-2"
        (click)="$event.stopPropagation()"
        (keydown)="$event.stopPropagation()"
        tabindex="-1"
      >
        <div class="flex min-w-0 items-center gap-pb-2">
          <span class="text-pb-subtitle font-semibold text-on-surface">Notifications</span>

          @if (store.hasUnread()) {
            <!-- The count in words rather than only on the bell's badge: the badge is what made you
                 open the panel, and it is now hidden behind it. -->
            <span class="pb-badge pb-badge-pill pb-tone-info">{{ store.badgeLabel() }}</span>
          }
        </div>

        @if (store.hasUnread()) {
          <button matButton type="button" class="!min-w-0 shrink-0" (click)="store.markAllRead()">
            Mark all read
          </button>
        }
      </div>

      @if (store.loading() && store.items().length === 0) {
        <div class="flex justify-center px-pb-3 py-pb-6">
          <pb-spinner diameter="28" label="Loading notifications" />
        </div>
      } @else if (store.error() !== null) {
        <div class="px-pb-3 py-pb-5 text-center">
          <pb-icon name="offline" [size]="28" class="mx-auto text-pb-danger-fg" />
          <p class="mt-pb-2 text-pb-body text-on-surface">Could not load notifications.</p>
          <button matButton type="button" class="mt-pb-1" (click)="store.loadFeed()">
            Try again
          </button>
        </div>
      } @else if (store.isEmpty()) {
        <div class="px-pb-3 py-pb-6 text-center">
          <!-- The icon sits in a tile like the entries would, so an empty panel keeps the shape of a
               full one rather than looking like a different screen. -->
          <span class="pb-icon-tile pb-tone-neutral mx-auto !h-10 !w-10" aria-hidden="true">
            <pb-icon name="notificationsOff" [size]="18" />
          </span>
          <p class="mt-pb-2 text-pb-body text-on-surface">You are all caught up.</p>
          <p class="mt-0.5 text-pb-caption text-on-surface-variant">
            New approvals and stock alerts will appear here.
          </p>
        </div>
      } @else {
        @for (notification of store.items(); track notification.id) {
          <button
            mat-menu-item
            type="button"
            class="group !relative !h-auto !py-pb-2"
            (click)="onSelect(notification)"
          >
            <!--
              Unread rail on the leading edge, rather than tinting the whole row.

              The row fill was 'surface-container-high', which is also very close to what Material
              paints an item on hover — so an unread entry looked hovered, and hovering a read one
              looked unread. A 2px bar cannot be confused with a state layer.
            -->
            @if (!notification.isRead) {
              <span
                class="absolute inset-y-1 left-0 w-0.5 rounded-r-pb-sm bg-pb-dot"
                aria-hidden="true"
              ></span>
            }

            <div class="flex items-start gap-pb-3">
              <span [class]="tileClass(notification)" aria-hidden="true">
                <pb-icon [name]="iconFor(notification)" [size]="16" />
              </span>

              <!-- 'min-w-0' lets the flex child shrink, which is what allows the text
                   below to wrap instead of forcing the menu wider. -->
              <div class="min-w-0 flex-1">
                <p
                  class="m-0 whitespace-normal break-words text-pb-body text-on-surface"
                  [class.font-semibold]="!notification.isRead"
                >
                  {{ notification.title }}
                </p>
                <p
                  class="m-0 mt-0.5 whitespace-normal break-words text-pb-caption text-on-surface-variant"
                >
                  {{ notification.body }}
                </p>
                <p class="m-0 mt-pb-1 text-pb-overline uppercase text-on-surface-variant">
                  {{ notification.createdAt | pbRelativeTime }}
                </p>
              </div>

              @if (!notification.isRead) {
                <!-- Redundant with the weight and the rail, on purpose: weight alone is easy to miss
                     when every entry is one line, and the rail is at the panel's edge rather than in
                     the row you are reading. -->
                <span
                  class="mt-1.5 h-2 w-2 shrink-0 rounded-pb-full bg-pb-dot"
                  aria-label="Unread"
                ></span>
              }
            </div>
          </button>
        }
      }

      <!--
        Always shown, including when the panel is empty. The bell holds the newest ten;
        without a way through to the rest, everything older is unreachable from the UI,
        and an empty panel is exactly when someone goes looking for what they missed.

        Sticky like the header, for the same reason: it is the way out of a list that scrolls.
      -->
      <!--
        Centring this took two properties, not one.

        Material wraps projected content in a full-width '.mat-mdc-menu-item-text' flex child, so
        '!justify-center' on the row centres that wrapper — which is already the full width, and
        therefore changes nothing visible. 'block w-full text-center' on the label is what actually
        centres the text *inside* the wrapper.
      -->
      <a
        mat-menu-item
        routerLink="/notifications"
        class="pb-menu-sticky-footer !border-t !border-outline-variant"
      >
        <span class="block w-full text-center text-pb-body font-medium text-pb-link">
          View all notifications
        </span>
      </a>
    </mat-menu>
  `,
})
export class AppNotificationBellComponent {
  protected readonly store = inject(NotificationStore);
  private readonly router = inject(Router);

  /**
   * `relative` is load-bearing: the unread pill is absolutely positioned against this button, and
   * without a positioned ancestor it would anchor to the page instead of the bell.
   */
  protected readonly triggerClass =
    'relative grid h-10 w-10 shrink-0 cursor-pointer appearance-none place-items-center rounded-pb-lg border-0 bg-transparent p-0 text-pb-text-secondary transition-colors duration-pb-fast ease-pb-out hover:bg-pb-hover-surface hover:text-pb-text motion-reduce:transition-none';

  /** Refetch on open — this is the moment the user is actually looking at it. */
  protected onOpened(): void {
    this.store.loadFeed();
  }

  /**
   * Translates the server's Material icon name into this app's vocabulary.
   *
   * `notification.icon` is part of the API payload — the server derives it from the type so every
   * client draws the same thing — so the mapping happens here rather than by changing what is sent.
   * An unrecognised name falls back to the bell rather than rendering nothing.
   */
  protected iconFor(notification: AppNotification): PbIconName {
    return iconForServerName(notification.icon);
  }

  /** Tile geometry plus the severity's tone, which supplies its surface, border and icon colour. */
  protected tileClass(notification: AppNotification): string {
    return `pb-icon-tile ${SEVERITY_TONE_CLASSES[notification.severity]}`;
  }

  /**
   * Marks read, then navigates to whatever the notification is about.
   *
   * Marking first so the badge clears even if there is nowhere to go — a notification
   * whose target was deleted must still be dismissible, or it pins the badge forever.
   */
  protected onSelect(notification: AppNotification): void {
    this.store.markRead(notification);

    const link = deepLinkFor(notification.entityType, notification.entityId);

    if (link === null) {
      return;
    }

    void this.router.navigate([...link.commands], { queryParams: link.queryParams });
  }
}
