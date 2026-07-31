import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { CommandPaletteService } from '../../../core/services/command-palette.service';
import { ThemeService } from '../../../core/services/theme.service';
import { BreadcrumbsComponent } from '../../../shared/components/breadcrumbs/breadcrumbs.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SearchBoxComponent } from '../../../shared/components/search-box/search-box.component';
import { MATERIAL_LAYOUT_IMPORTS } from '../../../shared/material/material-imports';
import { AppNotificationBellComponent } from '../app-notification-bell/app-notification-bell.component';
import { AppQuickActionsComponent } from '../app-quick-actions/app-quick-actions.component';
import { AppUserMenuComponent } from '../app-user-menu/app-user-menu.component';

/**
 * Application top bar: navigation toggle, page title, global search, quick actions, theme,
 * notifications and the account menu.
 *
 * ## Page title, not brand
 *
 * The bar used to lead with "Paris Bites" at every breakpoint. On a signed-in screen that is the one
 * piece of information the user already has — they know which product they are in; what they cannot
 * always tell is which screen. So the title slot shows **where you are**, taken from the breadcrumb
 * trail, with the trail itself beneath it on wide screens. The brand lives in the sidebar, where it
 * is not competing with anything.
 *
 * ## Responsive strategy, by breakpoint
 *
 * - **Mobile** — hamburger opens the sidebar drawer; the title is the only text; search collapses to
 *   an icon that reveals a full-width row beneath the bar, because a usable field and the other
 *   controls cannot share 360px. Quick actions hide: the sidebar is one tap away and holds the same
 *   destinations.
 * - **Tablet** — inline search returns at a reduced width; the breadcrumb trail stays hidden, since
 *   the title alone answers "where am I" and the trail would wrap.
 * - **Desktop** — title with its trail, full search, and every control inline.
 *
 * The theme toggle is here as well as in the account menu: dark mode is used often enough that
 * burying it two clicks deep is the wrong trade.
 *
 * ## Elevation on scroll
 *
 * At rest the bar is separated from the page by a hairline border and nothing else. Once the content
 * beneath has scrolled it gains a shadow, which is the only honest way to say "there is more above
 * this" — a border alone is ambiguous between a bar sitting on the page and a bar the page has run
 * under. It is deliberately not a blur: the bar is a *sibling* of the scroll container rather than an
 * overlay on it, so there is nothing behind the glass to see, and `backdrop-filter` would cost a
 * compositor layer to render an expensive no-op.
 */
@Component({
  selector: 'pb-app-topbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AppNotificationBellComponent,
    AppQuickActionsComponent,
    AppUserMenuComponent,
    BreadcrumbsComponent,
    IconComponent,
    SearchBoxComponent,
    ...MATERIAL_LAYOUT_IMPORTS,
  ],
  host: {
    class: 'block',
    /*
     * `/` focuses this field, the convention from Linear, GitHub and Vercel.
     *
     * ⌘K deliberately does **not** land here any more. It used to, and it was the wrong target: this
     * searches *data*, while ⌘K in every tool that popularised it searches *the application*. The two
     * were conflated, so there was no keyboard route to Reports while the shortcut users arrive with
     * did something they did not expect. ⌘K now opens the command palette — see
     * `MainLayoutComponent`, which owns it because the palette outlives any one bar.
     *
     * Bound on the host rather than on the field, because the point of a shortcut is that it works
     * while focus is anywhere on the page. `focusSearch` ignores it while the user is already
     * typing — otherwise `/` would be swallowed out of every note and search term on the page.
     */
    '(document:keydown./)': 'focusSearch($event)',
  },
  template: `
    <!--
      'relative z-10' so the scroll shadow paints *over* the content below rather than being covered
      by it: both are children of the same flex column, and without a stacking order the later
      sibling wins.
    -->
    <header
      class="relative z-10 flex h-16 items-center gap-pb-3 border-b border-pb-border bg-pb-surface px-pb-2 transition-shadow duration-pb-base ease-pb-out motion-reduce:transition-none sm:px-pb-3"
      [class.shadow-pb-sm]="scrolled()"
    >
      <!--
        The nav toggle.

        The glyph names the panel's state: closed-edge when the sidebar is expanded, plain when it
        is a rail. The old pair was Material's 'menu' / 'menu_open' — a hamburger, which says "there
        is a menu" and nothing about which way pressing it goes.

        **On mobile it is always the plain panel**, because 'sidebarCollapsed' is about the desktop
        rail and is hard-coded false there — binding the glyph to it would have drawn "expanded" over
        a drawer that is shut. The drawer's own state is not threaded up here, and it does not need
        to be: on a phone the button is a menu opener, and 'aria-expanded' below stays honest by
        being false in that mode.
      -->
      <button
        type="button"
        [class]="iconButtonClass"
        [attr.aria-label]="isMobile() ? 'Open navigation' : 'Toggle navigation width'"
        [attr.aria-expanded]="!isMobile() && !sidebarCollapsed()"
        [matTooltip]="isMobile() ? 'Menu' : 'Toggle navigation'"
        (click)="menuToggle.emit()"
      >
        <pb-icon [name]="isMobile() || sidebarCollapsed() ? 'menu' : 'menuClose'" [size]="18" />
      </button>

      <!--
        Where you are.

        Two lines on a wide screen — title plus trail — and one on anything narrower. The trail is
        the redundant half, so it is what goes.

        The trail is 'dense' here. Its links carry a 44px minimum height on a page, for a thumb; two
        lines of that plus an 18px title is 66px of content in a 64px bar, which is what was pushing
        the trail against the border and clipping its descenders.
      -->
      <div class="min-w-0 flex-1">
        <h1 class="m-0 truncate text-pb-title text-pb-text">{{ pageTitle() }}</h1>
        @if (!isMobile() && !isCompact() && hasTrail()) {
          <pb-breadcrumbs class="block" [dense]="true" />
        }
      </div>

      @if (!isMobile()) {
        <pb-search-box
          #search
          variant="bar"
          class="w-56 shrink-0 lg:w-80"
          label="Search"
          placeholder="Search products, suppliers…"
          [shortcutHint]="searchShortcut"
          (searchChange)="searchChange.emit($event)"
        />
      } @else {
        <button
          type="button"
          [class]="iconButtonClass"
          aria-label="Search"
          [attr.aria-expanded]="mobileSearchOpen()"
          (click)="searchToggle.emit()"
        >
          <pb-icon [name]="mobileSearchOpen() ? 'close' : 'search'" [size]="18" />
        </button>
      }

      <!--
        The action cluster, as one group.

        Tighter internal spacing than the bar's own gap, which is what makes these read as a set of
        related controls rather than five buttons drifting toward the corner. The hairline before
        them does the same job at the group's edge.
      -->
      <div class="flex shrink-0 items-center gap-pb-1">
        @if (!isMobile()) {
          <!--
            The command palette, given a visible control.

            ⌘K has been bound since the palette landed and was **discoverable only by trying it** —
            the one hint in the bar said '/', which focuses the data search, so the shortcut users
            arrive with from Linear and Stripe was invisible to anyone who did not already know it.
            A keyboard shortcut nobody can see is a feature only its author uses.

            Rendered as the chord itself rather than as an icon with a tooltip: the point is to teach
            the keys, and a label that *is* the keys does that without being opened. Clicking it
            opens the palette too, so it is a control and not just a legend.
          -->
          <button
            type="button"
            [class]="paletteButtonClass"
            aria-label="Open command palette"
            matTooltip="Commands and pages"
            (click)="palette.open()"
          >
            <pb-icon name="command" [size]="14" />
            <span class="text-pb-caption font-medium tabular-nums">K</span>
          </button>

          <!-- Inside the same condition as quick actions: on mobile the separator would be dividing
               the search icon from the bell, which are not two groups. -->
          <div class="mx-pb-1 h-6 w-px bg-pb-border" aria-hidden="true"></div>

          <!-- Hidden on mobile: every destination in here is also in the sidebar, which is one tap
               away, and the bar has no room to spare at 360px. -->
          <pb-app-quick-actions />
        }

        <button
          type="button"
          [class]="iconButtonClass"
          [attr.aria-label]="theme.isDark() ? 'Switch to light theme' : 'Switch to dark theme'"
          [matTooltip]="theme.isDark() ? 'Light theme' : 'Dark theme'"
          (click)="theme.toggle()"
        >
          <!--
            The sun and moon are stacked in the same grid cell and cross-faded, rather than one
            glyph being swapped for the other.

            This is the one control whose entire job is to change how everything looks, and an
            instant swap makes the theme change read as a repaint rather than as something you did.
            Two elements is what gives the transition something to interpolate: a single element
            with a bound name has nothing to fade *from*, which is why the previous version's
            'transition-transform' animated nothing at all.

            Each rotates as it goes, in opposite directions, so the pair reads as one object turning
            over rather than as two icons taking turns.
          -->
          <span class="grid place-items-center">
            <pb-icon
              name="themeLight"
              [size]="18"
              [class]="themeGlyphClass"
              [class.opacity-0]="!theme.isDark()"
              [class.-rotate-90]="!theme.isDark()"
            />
            <pb-icon
              name="themeDark"
              [size]="18"
              [class]="themeGlyphClass"
              [class.opacity-0]="theme.isDark()"
              [class.rotate-90]="theme.isDark()"
            />
          </span>
        </button>

        <!-- Kept at every breakpoint, unlike search. An approval waiting on you is not
             something to hide on a phone — the cart is exactly where a phone is used. -->
        <pb-app-notification-bell />

        <!-- Set slightly apart from the tools beside it: the account is not another action, it is
             whose session this is. -->
        <pb-app-user-menu class="ml-pb-1" />
      </div>
    </header>

    <!-- Mobile search row, revealed beneath the bar so the field gets full width. -->
    @if (isMobile() && mobileSearchOpen()) {
      <div class="pb-fade-in border-b border-pb-border bg-pb-surface px-pb-3 py-pb-2">
        <pb-search-box
          #search
          variant="bar"
          label="Search"
          placeholder="Search products, suppliers…"
          (searchChange)="searchChange.emit($event)"
        />
      </div>
    }
  `,
})
export class AppTopbarComponent {
  protected readonly theme = inject(ThemeService);
  protected readonly palette = inject(CommandPaletteService);
  private readonly breadcrumbs = inject(BreadcrumbService);

  /**
   * The shell's icon button, as one string rather than `matIconButton`.
   *
   * These were Material icon buttons carrying `!h-10 !w-10` to undo a 48px default, which meant
   * every one of them shipped a ripple, a state layer and a focus indicator that the design system
   * then had to override. A plain button with the system's own hover and focus is smaller, matches
   * the sidebar's pills exactly, and has one place to change.
   *
   * The 40px box is the pointer target; the glyph inside is 18px. Both are deliberate — a 40px
   * target is comfortable with a mouse, and the toolbar is desktop-only except for the two controls
   * that stay at 40px on touch as well.
   */
  /**
   * 44px, not 40.
   *
   * These replaced Material's `matIconButton`, which quietly ships a 48px expanded hit area
   * underneath a 40px glyph — so a plain button at the same visual size is a 40px *target*, and the
   * shell regressed below the floor the rest of the app holds. Measured, not assumed: an audit of
   * the redesigned shell reported every one of them at 40px.
   *
   * 44px is the hard minimum rather than the 48px the POS uses, because the bar is 64px tall and
   * 48px of button in it leaves 8px of breathing room; the shell is also the one surface a mouse
   * uses as often as a thumb.
   */
  protected readonly iconButtonClass =
    'grid h-11 w-11 shrink-0 cursor-pointer appearance-none place-items-center rounded-pb-lg border-0 bg-transparent p-0 text-pb-text-secondary transition-colors duration-pb-fast ease-pb-out hover:bg-pb-hover-surface hover:text-pb-text motion-reduce:transition-none';

  /**
   * The ⌘K affordance: a pill that prints the chord it triggers.
   *
   * Wider than an icon button and deliberately so — it is a label, and a label has to be readable.
   * `tabular-nums` keeps the K from shifting when the icon beside it renders at a different
   * subpixel offset between themes.
   */
  protected readonly paletteButtonClass =
    'flex h-8 cursor-pointer appearance-none items-center gap-1 rounded-pb-md border border-pb-border bg-pb-surface-sunken px-pb-2 text-pb-text-secondary transition-colors duration-pb-fast ease-pb-out hover:border-pb-border-strong hover:bg-pb-hover-surface hover:text-pb-text motion-reduce:transition-none';

  /**
   * One theme glyph, stacked with its twin in the same grid cell.
   *
   * `col-start-1 row-start-1` is what puts them on top of each other — the parent is a one-cell
   * grid, and without an explicit placement the second child would be given a second row.
   */
  protected readonly themeGlyphClass =
    'col-start-1 row-start-1 transition-[opacity,transform] duration-pb-base ease-pb-spring motion-reduce:transition-none';

  readonly isMobile = input<boolean>(false);
  /** True on a tablet, where the breadcrumb trail is dropped but inline search is kept. */
  readonly isCompact = input<boolean>(false);
  readonly sidebarCollapsed = input<boolean>(false);
  readonly mobileSearchOpen = input<boolean>(false);
  /** True once the page beneath has scrolled, which is what raises the bar's shadow. */
  readonly scrolled = input<boolean>(false);

  /**
   * The label on the search field's keyboard hint.
   *
   * Platform-branched because ⌘ on a Mac is Ctrl everywhere else, and a hint showing the wrong
   * modifier is worse than none — it teaches a shortcut that does not work. Both are bound, so the
   * hint names the one the user's own keyboard has.
   *
   * `userAgent` rather than the deprecated `navigator.platform`, and read once: a keyboard layout
   * does not change mid-session.
   */
  /**
   * The hint printed in the search field.
   *
   * Plain `/` now, because that is what focuses this field. It used to read ⌘K, which after the split
   * above would have been a hint pointing at the command palette printed inside the box it no longer
   * opens — the most misleading possible label.
   */
  protected readonly searchShortcut = '/';

  readonly menuToggle = output<void>();
  readonly searchToggle = output<void>();
  /** Renamed from `search` to avoid clashing with the native DOM event. */
  readonly searchChange = output<string>();

  private readonly search = viewChild<SearchBoxComponent>('search');

  /**
   * The current screen's name, from the last crumb in the trail.
   *
   * Derived rather than passed in, so a new route gets a title from the `withBreadcrumb` data it
   * already declares — there is no second place to register a page name and forget.
   */
  protected readonly pageTitle = computed(() => {
    const trail = this.breadcrumbs.breadcrumbs();
    return trail.length > 0 ? (trail[trail.length - 1]?.label ?? 'Paris Bites') : 'Paris Bites';
  });

  /**
   * Whether the trail says anything the title has not already said.
   *
   * The title *is* the last crumb, so a one-crumb trail renders the same word twice, one line apart, in
   * two sizes — which is how the Dashboard came to say "Dashboard" under "Dashboard". A trail earns its
   * line only when it shows an ancestor, e.g. "Account › Change password".
   */
  protected readonly hasTrail = computed(() => this.breadcrumbs.breadcrumbs().length > 1);

  /**
   * Moves focus to the search field, for `/` and for ⌘K / Ctrl-K.
   *
   * One handler for all three: they differ only in which key opened them, and the decision about
   * whether to honour the key is the same in every case.
   */
  protected focusSearch(event: Event): void {
    /*
     * Narrowed rather than declared as `KeyboardEvent`. Angular types a host listener's `$event` as
     * `Event`, and under `exactOptionalPropertyTypes` the assignment is rejected outright — so the
     * check is what gives access to `metaKey` below, not defensive padding.
     */
    if (!(event instanceof KeyboardEvent)) {
      return;
    }

    const target = event.target;

    /*
     * Ignore the shortcut while the user is typing.
     *
     * Without this, a slash typed into any field — a search box, a discount reason, a note — would
     * be swallowed and refocus the topbar instead. `isContentEditable` covers rich-text areas that
     * are neither input nor textarea.
     *
     * A chord is still exempt, so a future ⌘-something aimed here would not have to re-derive this;
     * bare `/` is the case that has to yield.
     */
    const isChord = event.metaKey || event.ctrlKey;

    if (!isChord && target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
        return;
      }
    }

    const box = this.search();

    if (box === undefined) {
      /*
       * Mobile: the field is not rendered until the row is opened, so open it.
       *
       * The default is still prevented — on a Mac ⌘K is Safari's "open location" and in Chrome it
       * focuses the address bar, either of which would take the user out of the app entirely.
       */
      if (isChord) {
        event.preventDefault();
      }

      this.searchToggle.emit();
      return;
    }

    event.preventDefault();
    box.focus();
  }
}
