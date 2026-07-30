import { ChangeDetectionStrategy, Component, inject, type OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { deepLinkFor } from '../../../../core/notifications/models/entity-links';
import {
  SEVERITY_CLASSES,
  type AppNotification,
} from '../../../../core/notifications/models/notification.model';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import {
  PaginatorComponent,
  type PageRequest,
} from '../../../../shared/components/paginator/paginator.component';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import { MATERIAL_CORE_IMPORTS } from '../../../../shared/material/material-imports';
import { RelativeTimePipe } from '../../../../shared/pipes/relative-time.pipe';
import { NotificationCenterStore } from '../../services/notification-center-store.service';

/**
 * The notification centre: the whole inbox, not just the newest ten.
 *
 * The bell answers "what happened while I was working". This answers "what happened last
 * week" — which the bell structurally cannot, because it holds a fixed ten and has no
 * paging. Without this page everything older than those ten is reachable only by API.
 *
 * Deliberately a list of rows rather than `pb-data-table`: a notification is a headline
 * and a sentence, not a record with columns, and forcing it into a table would produce a
 * "Body" column containing a paragraph. The rows stay legible on a phone for free.
 *
 * ## Access
 *
 * No permission guard, matching the API. An inbox is not shared, so the question is "is
 * this yours?" and no permission can express it — an admin holds every permission by
 * construction and still must not read a Store Manager's mail. Ownership is enforced
 * server-side from the token; this page simply shows whatever the caller's own inbox
 * returns.
 */
@Component({
  selector: 'pb-notification-center-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [NotificationCenterStore],
  imports: [
    PageHeaderComponent,
    CardComponent,
    EmptyStateComponent,
    PaginatorComponent,
    SpinnerComponent,
    RelativeTimePipe,
    MatButtonToggleModule,
    ...MATERIAL_CORE_IMPORTS,
  ],
  template: `
    <pb-page-header
      title="Notifications"
      [subtitle]="
        store.hasUnread() ? store.unreadCount() + ' unread' : 'Everything here has been read.'
      "
    >
      @if (store.hasUnread()) {
        <button slot="actions" matButton="filled" type="button" (click)="store.markAllRead()">
          <mat-icon>done_all</mat-icon>
          Mark all read
        </button>
      }
    </pb-page-header>

    <div class="mb-4">
      <mat-button-toggle-group
        [value]="store.unreadOnly() ? 'unread' : 'all'"
        (change)="store.setUnreadOnly($any($event).value === 'unread')"
        aria-label="Filter notifications"
      >
        <mat-button-toggle value="all">All</mat-button-toggle>
        <mat-button-toggle value="unread">
          Unread
          @if (store.hasUnread()) {
            <span class="ml-1">({{ store.unreadCount() }})</span>
          }
        </mat-button-toggle>
      </mat-button-toggle-group>
    </div>

    <pb-card padding="none">
      @if (store.loading() && store.items().length === 0) {
        <div class="flex justify-center py-12">
          <pb-spinner size="lg" label="Loading notifications…" />
        </div>
      } @else if (store.error() !== null) {
        <div class="px-4 py-10 text-center">
          <p class="text-pb-body text-error">Could not load your notifications.</p>
          <button matButton type="button" (click)="store.load()">Try again</button>
        </div>
      } @else if (store.isEmpty()) {
        <pb-empty-state
          [icon]="store.unreadOnly() ? 'mark_email_read' : 'notifications_off'"
          [title]="store.unreadOnly() ? 'Nothing unread' : 'No notifications yet'"
          [message]="
            store.unreadOnly()
              ? 'You have read everything. Switch to All to look back over the history.'
              : 'Transfer decisions, recorded purchases and stock alerts will appear here.'
          "
        />
      } @else {
        <!-- 'list-none' because this is a list of controls, not a bulleted list. -->
        <ul class="m-0 flex list-none flex-col p-0">
          @for (notification of store.items(); track notification.id) {
            <!--
              The unread tint sits on the <li>, not the <button>, so it cannot collide
              with the button's own hover background — two background utilities on one
              element resolve by stylesheet order, which is not something to rely on.
            -->
            <li
              class="border-b border-outline-variant last:border-b-0"
              [class.bg-surface-container-low]="!notification.isRead"
            >
              <!--
                Tailwind's preflight is not loaded (see styles.scss), so a bare <button>
                keeps the browser's default border, grey face and centred button font.
                These resets are what a preflight would otherwise have applied.
              -->
              <button
                type="button"
                class="flex w-full cursor-pointer appearance-none items-start gap-3 border-0 bg-transparent px-4 py-3.5 text-left font-[inherit] text-inherit hover:bg-surface-container"
                (click)="onSelect(notification)"
              >
                <mat-icon class="mt-0.5 shrink-0" [class]="severityClass(notification)">
                  {{ notification.icon }}
                </mat-icon>

                <!-- 'min-w-0' lets this shrink so long bodies wrap instead of
                     forcing the row wider than the card. -->
                <div class="min-w-0 flex-1">
                  <p class="text-pb-body break-words" [class.font-semibold]="!notification.isRead">
                    {{ notification.title }}
                  </p>
                  <p class="text-pb-caption mt-0.5 break-words text-on-surface-variant">
                    {{ notification.body }}
                  </p>
                  <p class="text-pb-caption mt-1.5 text-on-surface-variant">
                    {{ notification.createdAt | pbRelativeTime }}
                    @if (notification.actorName !== null) {
                      · {{ notification.actorName }}
                    }
                  </p>
                </div>

                <!-- Redundant with the heavier title on purpose: weight alone is easy to
                     miss when scanning, and colour alone fails for anyone who cannot
                     separate the two channels. -->
                @if (!notification.isRead) {
                  <span
                    class="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary"
                    aria-label="Unread"
                  ></span>
                }
              </button>
            </li>
          }
        </ul>

        <pb-paginator
          class="border-t border-outline-variant"
          [pagination]="store.pagination()"
          [disabled]="store.loading()"
          (pageChange)="onPage($event)"
        />
      }
    </pb-card>
  `,
})
export class NotificationCenterPage implements OnInit {
  protected readonly store = inject(NotificationCenterStore);
  private readonly router = inject(Router);

  ngOnInit(): void {
    this.store.load();
  }

  protected severityClass(notification: AppNotification): string {
    return SEVERITY_CLASSES[notification.severity];
  }

  /**
   * Marks read, then goes to whatever the notification is about.
   *
   * Marking happens first and unconditionally, so a notification whose target has since
   * been deleted is still dismissible — otherwise it would pin the badge permanently.
   */
  protected onSelect(notification: AppNotification): void {
    this.store.markRead(notification);

    const link = deepLinkFor(notification.entityType, notification.entityId);

    if (link !== null) {
      void this.router.navigate([...link.commands], { queryParams: link.queryParams });
    }
  }

  protected onPage(page: PageRequest): void {
    this.store.setPage(page.page, page.pageSize);
  }
}
