import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/services/auth.service';
import { Permission } from '../../../core/models/permission.model';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import type { PbIconName } from '../../../shared/components/icon/icon-registry';
import { MATERIAL_LAYOUT_IMPORTS } from '../../../shared/material/material-imports';

/** One shortcut. Strictly a route — see the note on the class. */
interface QuickAction {
  readonly label: string;
  readonly hint: string;
  readonly icon: PbIconName;
  readonly route: string;
  readonly permission: Permission;
}

/**
 * The handful of things someone signs in to *do*, one click from anywhere.
 *
 * **These only navigate.** Every entry is a `routerLink` to a screen that already exists; nothing
 * here creates, submits or mutates anything. That boundary is deliberate — a shell that starts
 * performing actions is a shell that owns business rules, and those belong to the feature that
 * validates them. Taking an order still happens on the order screen, with its pricing, its discount
 * ceiling and its idempotency key intact.
 *
 * Gated on the same permissions the destination routes require, so the menu never offers a shortcut
 * that lands on the access-denied page. A Store Manager sees a shorter list; if they can reach none
 * of them, the button hides itself rather than opening an empty menu.
 */
@Component({
  selector: 'pb-app-quick-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, ...MATERIAL_LAYOUT_IMPORTS],
  host: {
    class: 'block',
  },
  template: `
    @if (actions().length > 0) {
      <!--
        A plus in a bordered square rather than a filled disc.

        Filled, it was the heaviest mark in the bar — a solid shape beside four outlined ones, which
        made "create something" look like the primary action of every screen. The square reads as a
        button affordance at the same weight as its neighbours, and its border tracks the button's
        own hover so the two move together instead of the square staying static inside a tinting
        pill.
      -->
      <button
        type="button"
        [matMenuTriggerFor]="menu"
        aria-label="Quick actions"
        matTooltip="Quick actions"
        [class]="triggerClass"
      >
        <span
          class="grid h-6 w-6 place-items-center rounded-pb-sm border border-pb-border transition-colors duration-pb-fast ease-pb-out group-hover:border-pb-border-strong motion-reduce:transition-none"
        >
          <pb-icon name="add" [size]="14" />
        </span>
      </button>

      <mat-menu #menu="matMenu" class="pb-shell-menu">
        <p
          class="m-0 px-pb-3 pb-pb-1 pt-pb-2 text-pb-overline uppercase text-pb-text-secondary"
          aria-hidden="true"
        >
          Quick actions
        </p>

        @for (action of actions(); track action.route) {
          <a mat-menu-item [routerLink]="action.route">
            <pb-icon [name]="action.icon" [size]="18" class="mr-pb-2 text-pb-text-secondary" />
            <span class="text-pb-body">{{ action.label }}</span>
            <!-- Which part of the business the destination belongs to, not a keyboard shortcut — so
                 plain muted text rather than the 'pb-kbd' chrome the search hint uses. -->
            <span class="ml-auto pl-pb-4 text-pb-caption text-pb-text-secondary">
              {{ action.hint }}
            </span>
          </a>
        }
      </mat-menu>
    }
  `,
})
export class AppQuickActionsComponent {
  private readonly auth = inject(AuthService);

  /** `group` so the inner square can respond to the button's own hover. */
  protected readonly triggerClass =
    'group grid h-11 w-11 shrink-0 cursor-pointer appearance-none place-items-center rounded-pb-lg border-0 bg-transparent p-0 text-pb-text-secondary transition-colors duration-pb-fast ease-pb-out hover:bg-pb-hover-surface hover:text-pb-text motion-reduce:transition-none';

  /*
   * Ordered to match the sidebar: selling, then stock, then buying.
   *
   * The list is the same for everyone and filtered per user, so the order has to read sensibly
   * after filtering as well as before. For a Store Manager the first three survive and the last
   * two disappear, leaving exactly the three things that role does in a shift.
   */
  private static readonly ALL: readonly QuickAction[] = [
    {
      label: 'New order',
      hint: 'Counter',
      icon: 'pos',
      route: '/pos/new',
      permission: Permission.POS_OPERATE,
    },
    {
      /*
       * Gated on `STOCK_ADJUST` rather than `STOCK_READ`.
       *
       * The destination is the consumption list, which only needs read — but this entry offers to
       * *record*, and the endpoint behind that requires `STOCK_ADJUST`. Gating on read would put
       * "Record consumption" in front of someone who could open the screen and then fail at the
       * save, which is the access-denied page arriving one step later than it should.
       */
      label: 'Record consumption',
      hint: 'Stock',
      icon: 'consumption',
      route: '/consumption',
      permission: Permission.STOCK_ADJUST,
    },
    {
      label: 'New transfer',
      hint: 'Stock',
      icon: 'transfers',
      route: '/transfers',
      permission: Permission.TRANSFER_CREATE,
    },
    {
      label: 'Record purchase',
      hint: 'Invoice',
      icon: 'purchases',
      route: '/purchases/record',
      permission: Permission.PURCHASE_ORDER_CREATE,
    },
    {
      label: 'Daily sales',
      hint: 'Takings',
      icon: 'sales',
      route: '/sales',
      permission: Permission.SALE_RECORD,
    },
  ];

  protected readonly actions = computed(() =>
    this.auth.isAuthenticated()
      ? AppQuickActionsComponent.ALL.filter((a) => this.auth.can(a.permission))
      : [],
  );
}
