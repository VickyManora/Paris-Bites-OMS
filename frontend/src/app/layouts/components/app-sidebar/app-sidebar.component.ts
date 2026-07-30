import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/auth/services/auth.service';
import { Permission } from '../../../core/models/permission.model';
import { ROLE_LABELS } from '../../../core/models/role.model';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import type { PbIconName } from '../../../shared/components/icon/icon-registry';
import { MATERIAL_LAYOUT_IMPORTS } from '../../../shared/material/material-imports';
import { InitialsPipe } from '../../../shared/pipes/initials.pipe';

/** One entry in the navigation tree. */
export interface NavItem {
  readonly label: string;
  /**
   * A name from the icon registry, not a free string.
   *
   * Typed rather than `string` so a typo is a build error instead of a blank square in the rail —
   * which is exactly the failure the old Material names could produce, since an unknown ligature
   * renders as the literal text of its own name.
   */
  readonly icon: PbIconName;
  readonly route: string;
  /** Permission needed to see this item. Omit for "any authenticated user". */
  readonly permission?: Permission;
  /** Match the route exactly — needed for a parent path like `/dashboard`. */
  readonly exact?: boolean;
}

export interface NavSection {
  readonly title: string;
  readonly items: readonly NavItem[];
}

/**
 * Navigation declared as data and filtered by permission.
 *
 * Items are gated on the same permissions their routes require, so the menu never
 * offers a link that leads straight to the "access denied" page.
 *
 * **Exported** so the command palette can offer the same destinations under the same permissions.
 * A second list would drift: a route added to the sidebar and forgotten in the palette is a feature
 * users cannot find by the route they were taught to use.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', icon: 'dashboard', route: '/dashboard', exact: true }],
  },
  {
    title: 'Stock',
    items: [
      // Gated on the same permission the route requires, so the menu never offers a
      // link that leads straight to the "access denied" page.
      {
        label: 'Inventory',
        icon: 'inventory',
        route: '/inventory',
        permission: Permission.PRODUCT_READ,
      },
      {
        label: 'Transfers',
        icon: 'transfers',
        route: '/transfers',
        permission: Permission.TRANSFER_READ,
      },
      {
        label: 'Consumption',
        icon: 'consumption',
        route: '/consumption',
        permission: Permission.STOCK_READ,
      },
    ],
  },
  {
    // Buying is its own section rather than a third entry under Stock: purchases and
    // suppliers answer "what did we pay and to whom", which is a different question from
    // "what is on the shelf" — even though recording a bill is what puts it there.
    title: 'Buying',
    items: [
      {
        label: 'Purchases',
        icon: 'purchases',
        route: '/purchases',
        permission: Permission.PURCHASE_ORDER_READ,
      },
      {
        label: 'Suppliers',
        icon: 'suppliers',
        route: '/suppliers',
        permission: Permission.SUPPLIER_READ,
      },
    ],
  },
  {
    // Selling is its own section rather than a third entry under Buying: money in and
    // money out are different questions, and the daily figure is entered by a different
    // person at a different time from a supplier invoice.
    title: 'Selling',
    items: [
      // First in the section: it is the screen the counter opens every shift.
      {
        label: 'Point of sale',
        icon: 'pos',
        route: '/pos',
        permission: Permission.POS_OPERATE,
      },
      {
        // `payments` rather than a second `point_of_sale`: the two shared one icon, which made
        // the section read as one item duplicated. An icon that does not distinguish is worse
        // than no icon, because it is read as information.
        label: 'Daily sales',
        icon: 'sales',
        route: '/sales',
        permission: Permission.SALE_READ,
      },
    ],
  },
  {
    // Its own section: reports cut across stock and buying, and filing it under either
    // would hide half of what it covers.
    title: 'Analysis',
    items: [
      {
        label: 'Analytics',
        icon: 'analytics',
        route: '/analytics',
        permission: Permission.REPORT_VIEW_FINANCIAL,
      },
      {
        label: 'Reports',
        icon: 'reports',
        route: '/reports',
        permission: Permission.REPORT_VIEW,
      },
    ],
  },
  {
    title: 'Account',
    items: [
      // No permission: everyone has an inbox, and it is their own.
      { label: 'Notifications', icon: 'notifications', route: '/notifications' },
      { label: 'My profile', icon: 'profile', route: '/account/profile' },
      { label: 'Change password', icon: 'password', route: '/account/password' },
    ],
  },
];

/*
 * Sections to add as their features land, following the pattern above:
 *
 *   { label: 'Users',     icon: 'users',   route: '/users', permission: Permission.USER_READ },
 *   { label: 'Audit log', icon: 'history', route: '/audit', permission: Permission.AUDIT_READ },
 *
 * Both names would need registering in `icon-registry.ts` first — `icon` is typed to that registry,
 * so adding the item without the icon is a build error rather than a blank square.
 *
 * Both are admin-only, so a Store Manager will not see the section at all —
 * `visibleSections` drops sections that end up empty.
 */

/**
 * Sidebar navigation.
 *
 * Two visual modes: full width, and a 72px icon rail when `collapsed`. The rail
 * keeps navigation reachable on a laptop while giving the content area back most of
 * the width — which matters for wide tables.
 *
 * In rail mode each link keeps a tooltip and an `aria-label`, because an icon with
 * no accessible name is unusable with a screen reader.
 *
 * ## Three regions, in the order the eye needs them
 *
 * **Brand, then navigation, then identity.** The bar at the top of the page deliberately shows the
 * page title rather than the product name, on the reasoning that a signed-in user knows which
 * product they are in — which leaves the brand needing a home, and this is it. It used to be
 * nowhere: the sidebar opened with the user's avatar, so the app never said its own name on any
 * authenticated screen.
 *
 * Identity moved to the footer in the same change. It is reference information — "which account is
 * this" — and reference information belongs where it is findable rather than where it is first.
 * Putting it at the bottom also lets it absorb Sign out, which was a full-width row of its own
 * directly beneath it, saying the same thing twice in two shapes.
 *
 * The identity block stays in the sidebar at all, despite the account menu in the topbar, because it
 * is the only place the current account is stated *at rest*. The topbar shows initials in a circle,
 * which is an avatar you have to already know how to read; the footer spells out a name and a role
 * without anyone having to open a menu to find them. That matters most on a shared terminal, which is
 * what a shop's back-office machine is.
 *
 * (An earlier version of this note justified it by saying the mobile drawer covers the topbar. It does
 * not: the topbar is a sibling *above* `mat-sidenav-container`, so the account button stays visible
 * with the drawer open. The reason above is the one that survives looking at it.)
 *
 * ## Two things the shell had to fix
 *
 * Tailwind's preflight is deliberately not loaded (see `tailwind.css`), which means a bare `<a>`
 * keeps the browser's underline and a bare `<button>` keeps its grey chrome. Every nav link was
 * rendering underlined and Sign out was rendering as a grey box — visible in any screenshot, and
 * invisible in review because the class list looked complete. Both resets are now explicit.
 *
 * ## The active state
 *
 * Three signals at once: a tinted pill, an accent bar on the leading edge, and a heavier icon
 * stroke. See `.pb-nav-active` in `styles.scss` for why that redundancy is deliberate rather than
 * indecisive.
 *
 * The third signal used to be Material Symbols' `FILL` axis, which is gone with the move to Lucide —
 * an outline set has no filled twin. **The stroke weight replaces it**, bound from
 * `routerLinkActive`'s own `isActive` rather than driven by CSS, because a stroke width is an
 * attribute on the SVG rather than a property CSS can reach. That turns out to be the better
 * mechanism anyway: it is one expression next to the icon instead of a rule in a global stylesheet
 * reaching into a component's DOM.
 *
 * ## Hover
 *
 * Three things move, all of them small: the pill fills, the leading indicator previews itself at
 * 40%, and the icon shifts 1px toward the label. The nudge is what makes the row feel like a
 * physical target — it is below the threshold of being *seen* moving and above the threshold of
 * being felt, which is the whole trick.
 */
@Component({
  selector: 'pb-app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, IconComponent, InitialsPipe, ...MATERIAL_LAYOUT_IMPORTS],
  host: {
    // 'group' so the collapse control can appear on hover of the whole panel rather than
    // permanently occupying the brand row — see the note on `collapseButtonClass`.
    class: 'group/sidebar flex h-full flex-col bg-pb-surface',
  },
  template: `
    <!--
      Brand.

      Sized to match the topbar's own 'h-16' so the two share a baseline and the border under them
      reads as one continuous line across the width of the app, rather than a step.

      The border is deliberately *not* full-bleed in expanded mode — it is inset by the same gutter
      the nav pills use, so the sidebar reads as one column of aligned content rather than as three
      stacked boxes. That inset is most of what separates a Linear-style panel from a framed one.
    -->
    <div
      class="flex h-16 shrink-0 items-center gap-pb-3"
      [class]="collapsed() ? 'justify-center px-pb-2' : 'px-pb-3'"
    >
      @if (collapsed()) {
        <!--
          In the rail the mark doubles as the expand control: it is the one target up here, it is
          where a pointer already goes, and the swap to a chevron on hover says so. The tooltip and
          'aria-label' carry the same meaning for anyone not hovering — the visual swap is an
          affordance, not the only announcement.

          Both children are stacked in the same cell rather than swapped with an @if, so the
          cross-fade has something to fade between and neither reflows the row.
        -->
        <button
          type="button"
          class="group relative grid h-10 w-10 cursor-pointer place-items-center rounded-pb-lg border-0 bg-transparent p-0 transition-colors duration-pb-fast ease-pb-out hover:bg-pb-hover-surface"
          matTooltip="Expand navigation"
          matTooltipPosition="right"
          aria-label="Expand navigation"
          [attr.aria-expanded]="false"
          (click)="collapseToggle.emit()"
        >
          <span
            class="pb-brand-mark h-8 w-8 transition-opacity duration-pb-fast ease-pb-out group-hover:opacity-0 group-focus-visible:opacity-0"
            aria-hidden="true"
          >
            PB
          </span>
          <pb-icon
            name="expand"
            [size]="18"
            class="!absolute text-pb-text-secondary opacity-0 transition-opacity duration-pb-fast ease-pb-out group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </button>
      } @else {
        <!-- Home is the conventional destination for a wordmark, and the one every user tries. -->
        <a
          routerLink="/dashboard"
          class="group flex min-w-0 flex-1 items-center gap-pb-2 rounded-pb-lg py-1 no-underline"
          aria-label="Paris Bites — go to dashboard"
          (click)="navigate.emit()"
        >
          <span
            class="pb-brand-mark h-8 w-8 transition-transform duration-pb-base ease-pb-spring group-hover:scale-105 motion-reduce:transition-none"
            aria-hidden="true"
          >
            PB
          </span>
          <span class="pb-slide-in-x min-w-0">
            <span class="block truncate text-pb-subtitle font-semibold text-pb-text">
              Paris Bites
            </span>
            <span class="block truncate text-pb-overline uppercase text-pb-text-muted">
              Operations
            </span>
          </span>
        </a>

        @if (canCollapse()) {
          <!--
            Appears on hover of the panel rather than sitting there permanently.

            The collapse control is used once a session at most, and a button parked beside the
            wordmark competes with it every time the eye passes. 'group-hover' on the host makes it
            available the moment the pointer is anywhere in the sidebar, and 'focus-visible' keeps it
            reachable from the keyboard — where 'opacity-0' alone would have left a focusable
            invisible control, which is worse than a visible one.
          -->
          <button
            type="button"
            [class]="collapseButtonClass"
            matTooltip="Collapse navigation"
            matTooltipPosition="right"
            aria-label="Collapse navigation"
            [attr.aria-expanded]="true"
            (click)="collapseToggle.emit()"
          >
            <pb-icon name="collapse" [size]="18" />
          </button>
        }
      }
    </div>

    <nav
      class="pb-scroll-thin flex-1 overflow-y-auto overflow-x-hidden px-pb-2 pb-pb-3"
      aria-label="Main navigation"
    >
      @for (section of visibleSections(); track section.title; let firstSection = $first) {
        <!-- 'mt-pb-4' between sections against 'mt-0.5' between items: the gap that separates groups
             has to be several times the gap inside one, or the grouping is not read as grouping. -->
        <div class="mt-pb-4 first:mt-pb-1">
          @if (collapsed()) {
            <!-- A rule instead of a heading: a truncated label is worse than none, and the grouping
                 is still conveyed visually.

                 Skipped for the first section, which has nothing above it to be separated from. -->
            @if (!firstSection) {
              <div class="mx-pb-3 my-pb-3 h-px bg-pb-border-subtle" aria-hidden="true"></div>
            }
          } @else {
            <p
              class="pb-slide-in-x m-0 px-pb-3 pb-pb-2 text-pb-overline uppercase text-pb-text-muted"
            >
              {{ section.title }}
            </p>
          }

          @for (item of section.items; track item.route) {
            <a
              [routerLink]="item.route"
              routerLinkActive="pb-nav-active"
              #rla="routerLinkActive"
              [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
              [class]="linkClass()"
              [matTooltip]="collapsed() ? item.label : ''"
              matTooltipPosition="right"
              [attr.aria-label]="collapsed() ? item.label : null"
              (click)="navigate.emit()"
            >
              <!--
                The active indicator, on the leading edge.

                It previews itself at 40% under the pointer and commits to full length and opacity
                when the item is current, so hovering along the list feels like the marker tracking
                the cursor and settling where you land. Inside the link so it inherits the pill's
                rounding, and aria-hidden because routerLinkActive already announces the state.
              -->
              <span
                class="pb-nav-indicator absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-pb-sm bg-pb-primary opacity-0 transition-[opacity,height] duration-pb-fast ease-pb-out group-hover:opacity-40 motion-reduce:transition-none"
                aria-hidden="true"
              ></span>

              <!--
                Weight carries the active state, since an outline icon set has no filled twin —
                see the note on the class. The 1px nudge on hover is the row's only movement.
              -->
              <pb-icon
                class="pb-nav-icon text-pb-text-secondary transition-[color,transform] duration-pb-fast ease-pb-out group-hover:translate-x-px motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                [name]="item.icon"
                [size]="18"
                [strokeWidth]="rla.isActive ? 2.25 : 1.75"
              />

              @if (!collapsed()) {
                <span class="pb-slide-in-x truncate text-pb-body">{{ item.label }}</span>
              }
            </a>
          }
        </div>
      }
    </nav>

    <!--
      Identity and sign out, as one block.

      Sign out sits *inside* the identity row rather than under it, because it acts on the account
      named beside it — putting them together is what makes that relationship visible, and it
      reclaims a whole row at the bottom of the panel.
    -->
    <div class="shrink-0 p-pb-2">
      <div class="mb-pb-2 h-px bg-pb-border-subtle" aria-hidden="true"></div>

      @if (auth.user(); as user) {
        @if (collapsed()) {
          <div class="flex flex-col items-center gap-pb-1">
            <span
              class="pb-avatar h-8 w-8"
              [matTooltip]="user.fullName + ' · ' + roleLabels[user.role]"
              matTooltipPosition="right"
              [attr.aria-label]="'Signed in as ' + user.fullName"
            >
              {{ user.fullName | pbInitials }}
            </span>

            <button
              type="button"
              [class]="signOutClass"
              matTooltip="Sign out"
              matTooltipPosition="right"
              aria-label="Sign out"
              (click)="auth.logout()"
            >
              <pb-icon name="signOut" [size]="18" />
            </button>
          </div>
        } @else {
          <!--
            The row is itself hoverable, which is new: it is the only place the signed-in account is
            stated at rest, and giving it a hover state is what says the block is a thing rather than
            a caption. It does not navigate — the tint is an affordance for the sign-out control
            inside it, which is the only target in the row.
          -->
          <div
            class="group flex items-center gap-pb-3 rounded-pb-lg px-pb-2 py-pb-2 transition-colors duration-pb-fast ease-pb-out hover:bg-pb-hover-surface motion-reduce:transition-none"
          >
            <span class="pb-avatar h-9 w-9" aria-hidden="true">
              {{ user.fullName | pbInitials }}
            </span>

            <div class="pb-slide-in-x min-w-0 flex-1">
              <p class="m-0 truncate text-pb-subtitle text-pb-text">{{ user.fullName }}</p>
              <p class="m-0 truncate text-pb-caption text-pb-text-secondary">
                {{ roleLabels[user.role] }}
              </p>
            </div>

            <button
              type="button"
              [class]="signOutClass"
              matTooltip="Sign out"
              matTooltipPosition="right"
              aria-label="Sign out"
              (click)="auth.logout()"
            >
              <pb-icon name="signOut" [size]="18" />
            </button>
          </div>
        }
      }
    </div>
  `,
})
export class AppSidebarComponent {
  protected readonly auth = inject(AuthService);

  readonly collapsed = input<boolean>(false);

  /**
   * Whether to offer the collapse control at all.
   *
   * False on mobile, where the sidebar is an over-drawer: there is no rail state to collapse *to*,
   * and a chevron that half-closed a drawer would be a control with no meaning.
   */
  readonly canCollapse = input<boolean>(true);

  /** Emitted when a link is followed, so a mobile drawer can close itself. */
  readonly navigate = output<void>();

  /**
   * Request to switch between rail and full width.
   *
   * The sidebar asks rather than decides: the collapse preference is persisted by the layout, which
   * also owns the content-margin recalculation that has to follow it.
   */
  readonly collapseToggle = output<void>();

  protected readonly roleLabels = ROLE_LABELS;

  /**
   * Built as a string because Tailwind variants cannot be `[class.x]` keys.
   *
   * `no-underline` is load-bearing, not decoration: Tailwind's preflight is not loaded, so without
   * it every one of these links renders underlined.
   *
   * `min-h-10` rather than a fixed height, so a label that has to wrap grows the pill instead of
   * spilling out of it — the row is 40px for every label currently in the list, and stays correct
   * for one that is not.
   */
  protected readonly linkClass = computed(() => {
    const base =
      'group relative mt-0.5 flex min-h-10 w-full items-center gap-pb-3 rounded-pb-lg px-pb-3 py-2 text-left text-pb-body text-pb-text-secondary no-underline transition-[background-color,color] duration-pb-fast ease-pb-out hover:bg-pb-hover-surface hover:text-pb-text motion-reduce:transition-none';
    return this.collapsed() ? `${base} justify-center` : base;
  });

  /**
   * The collapse control, revealed by hovering the panel.
   *
   * It is used at most once a session, and a button parked permanently beside the wordmark competes
   * with the brand every time the eye crosses the top of the sidebar. Fading it in on
   * `group-hover/sidebar` keeps it available wherever the pointer already is.
   *
   * `focus-visible:opacity-100` is not optional: without it, tabbing through the shell would land on
   * a control that is fully transparent, which is strictly worse than one that is always visible.
   * The named group (`/sidebar`) rather than a bare `group` because the nav links below are
   * themselves groups, and an unnamed `group-hover` binds to the nearest one.
   */
  protected readonly collapseButtonClass =
    'grid h-8 w-8 shrink-0 cursor-pointer appearance-none place-items-center rounded-pb-md border-0 bg-transparent p-0 text-pb-text-secondary opacity-0 transition-[opacity,background-color,color] duration-pb-fast ease-pb-out hover:bg-pb-hover-surface hover:text-pb-text focus-visible:opacity-100 group-hover/sidebar:opacity-100 motion-reduce:transition-none';

  /**
   * Sign out, which is a `<button>` and therefore needs the chrome reset too — again because
   * preflight is absent, so it was rendering as a grey system button.
   *
   * Icon-only in both modes now that it sits inside the identity row: the row already names the
   * account, and "Sign out" spelled out beside that name was the widest thing in the footer for the
   * least information in it. The tooltip and `aria-label` carry the label.
   *
   * Hover tints toward danger rather than the neutral used by navigation: this is the one control in
   * here that ends the session, and it should not feel like moving between pages.
   */
  protected readonly signOutClass =
    'grid h-9 w-9 shrink-0 cursor-pointer appearance-none place-items-center rounded-pb-md border-0 bg-transparent p-0 text-pb-text-secondary transition-colors duration-pb-fast ease-pb-out hover:bg-pb-danger-surface hover:text-pb-danger-fg motion-reduce:transition-none';

  /**
   * Sections the current user may see. Sections left empty are dropped, so a
   * heading never appears with nothing beneath it.
   */
  protected readonly visibleSections = computed<readonly NavSection[]>(() => {
    if (!this.auth.isAuthenticated()) {
      return [];
    }

    return NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) => item.permission === undefined || this.auth.can(item.permission),
      ),
    })).filter((section) => section.items.length > 0);
  });
}
