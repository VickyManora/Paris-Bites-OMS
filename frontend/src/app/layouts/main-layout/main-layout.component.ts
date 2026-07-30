import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injector,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { LiveAnnouncer } from '@angular/cdk/a11y';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatSidenavContainer } from '@angular/material/sidenav';
import { Router, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { BreadcrumbService } from '../../core/services/breadcrumb.service';
import { StorageKeys } from '../../core/constants/storage-keys';
import { StorageService } from '../../core/services/storage.service';
import { MATERIAL_LAYOUT_IMPORTS } from '../../shared/material/material-imports';
import { MatDialog } from '@angular/material/dialog';
import { CommandPaletteService } from '../../core/services/command-palette.service';
import { AppCommandPaletteComponent } from '../components/app-command-palette/app-command-palette.component';
import { AppShortcutsHelpComponent } from '../components/app-shortcuts-help/app-shortcuts-help.component';
import { AppSidebarComponent } from '../components/app-sidebar/app-sidebar.component';
import { AppTopbarComponent } from '../components/app-topbar/app-topbar.component';

/**
 * Shell for authenticated pages.
 *
 * Owns all responsive layout decisions so no page has to think about them:
 *
 * | Viewport | Sidebar | Toggle does |
 * |---|---|---|
 * | `< 600px` | `over` drawer, closed, with backdrop | opens/closes the drawer |
 * | `>= 600px` | `side`, full width or 72px icon rail | switches between the two |
 *
 * The rail is the *initial* default below 1280px, because a 256px sidebar on a
 * 768px screen leaves too little for a data table — but it is only a default. The
 * toggle always works, at every size; forcing the rail below some width would make
 * the button appear broken on a tablet.
 *
 * The collapse preference is persisted; the mobile drawer state is not — a drawer
 * that reopened itself on every page load would be a nuisance.
 */
@Component({
  selector: 'pb-main-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    AppCommandPaletteComponent,
    AppSidebarComponent,
    AppTopbarComponent,
    ...MATERIAL_LAYOUT_IMPORTS,
  ],
  host: {
    /*
     * The app's global keyboard layer.
     *
     * Owned here rather than in the topbar because these outlive any one bar: the palette is a
     * document-level overlay and the help sheet is a dialog. `/` stays with the topbar, because it
     * targets a field that bar owns.
     *
     * Both handlers ignore the key while the user is typing — see `isTypingInto`. Without that, `?`
     * would be swallowed out of every note and discount reason in the app, which is the same bug the
     * topbar's `/` handler had to fix.
     *
     * Kept in step with `AppShortcutsHelpComponent`, which is the list users read.
     */
    '(document:keydown.meta.k)': 'onCommandKey($event)',
    '(document:keydown.control.k)': 'onCommandKey($event)',
    '(document:keydown)': 'onGlobalKey($event)',
  },
  template: `
    <!--
      Skip link, and the app had none.

      The shell puts a sidebar of fifteen nav links, a search box and five topbar controls ahead of
      the page content in the tab order. Without this, reaching the first thing on the page from the
      keyboard costs roughly twenty-five presses **on every navigation** — which is the difference
      between an app someone can use with a keyboard and one they technically can.

      Visually hidden until focused rather than always visible: it is furniture for the people who
      need it and noise for everyone else. 'sr-only' alone would leave it unreachable-looking when
      focused, so the focus state restores it to the flow at the top-left, over the topbar.
    -->
    <a
      href="#pb-main"
      class="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-pb-3 focus-visible:top-pb-3 focus-visible:z-50 focus-visible:rounded-pb-md focus-visible:bg-pb-primary focus-visible:px-pb-3 focus-visible:py-pb-2 focus-visible:text-pb-body focus-visible:font-semibold focus-visible:text-pb-on-primary focus-visible:no-underline focus-visible:shadow-pb-lg"
      (click)="focusMain($event)"
    >
      Skip to main content
    </a>

    <div class="flex h-dvh flex-col overflow-hidden">
      <pb-app-topbar
        class="shrink-0"
        [isMobile]="isMobile()"
        [isCompact]="isCompact()"
        [sidebarCollapsed]="railMode()"
        [mobileSearchOpen]="mobileSearchOpen()"
        [scrolled]="contentScrolled()"
        (menuToggle)="toggleSidebar()"
        (searchToggle)="toggleMobileSearch()"
        (searchChange)="onSearch($event)"
      />

      <mat-sidenav-container class="min-h-0 flex-1" [hasBackdrop]="isMobile()">
        <mat-sidenav
          [mode]="isMobile() ? 'over' : 'side'"
          [opened]="sidenavOpen()"
          [class]="sidenavWidthClass()"
          [attr.aria-label]="'Main navigation'"
          (closedStart)="drawerOpen.set(false)"
        >
          <pb-app-sidebar
            [collapsed]="railMode()"
            [canCollapse]="!isMobile()"
            (navigate)="onSidebarNavigate()"
            (collapseToggle)="toggleSidebar()"
          />
        </mat-sidenav>

        <!--
          This element is the app's scroll container: 'MatSidenavContent' is the thing with
          'overflow: auto', so its own scroll event is the only one that fires. Listening on the
          window here would never hear anything, because the document itself does not scroll.
        -->
        <mat-sidenav-content (scroll)="onContentScroll($event)">
          <!-- Gutters live here so every page inherits consistent spacing, and
               'max-w-7xl' stops content stretching to absurd line lengths on an
               ultrawide display. Padding grows with the viewport: 16px is right on a phone and
               mean on a 27" display, where the content otherwise starts at the very edge of a
               very large surface. -->
          <!--
            'pb-page-in' keyed on the route, so it replays on every navigation.

            The key is the mechanism: an animation on a stable element fires once, at first paint. Keying
            the wrapper on the URL makes Angular replace the node, which restarts it — a 200ms fade and
            8px rise, which is enough to say "this is a different page" and short enough not to be in the
            way of reading it. Opacity and transform only, so it composites on the GPU and costs no
            layout.
          -->
          <!--
            'tabindex="-1"' so the skip link and the route-change handler can move focus here.

            Without it, 'focus()' on a <main> is a no-op: the element is not focusable by default, so
            focus stays wherever it was — which for a route change means the nav link you just
            pressed, on a page that has since been replaced.
          -->
          <main
            #main
            id="pb-main"
            tabindex="-1"
            class="mx-auto w-full max-w-7xl p-pb-3 outline-none sm:p-pb-4 lg:p-pb-5"
          >
            @if (routeKey(); as key) {
              <div class="pb-page-in" [attr.data-route]="key">
                <router-outlet />
              </div>
            }
          </main>
        </mat-sidenav-content>
      </mat-sidenav-container>
    </div>

    <!-- Mounted once, at the layout root: a document-level overlay should not be a child of the
         scrolling content it covers. -->
    <pb-app-command-palette />
  `,
})
export class MainLayoutComponent {
  private readonly breakpoints = inject(BreakpointObserver);
  private readonly storage = inject(StorageService);
  private readonly router = inject(Router);
  private readonly palette = inject(CommandPaletteService);
  private readonly dialog = inject(MatDialog);
  private readonly announcer = inject(LiveAnnouncer);
  private readonly breadcrumbs = inject(BreadcrumbService);
  private readonly injector = inject(Injector);

  /**
   * The current URL, used only as an animation key.
   *
   * Query parameters are stripped: a debounced search writes `?search=` on every keystroke, and keying
   * the wrapper on the full URL would tear down and re-animate the page on each one — an animation
   * firing forty times while someone types is worse than none.
   */
  protected readonly routeKey = toSignal(
    this.router.events.pipe(map(() => this.router.url.split('?')[0] ?? '/')),
    { initialValue: this.router.url.split('?')[0] ?? '/' },
  );

  /**
   * Needed to recompute the content offset when the rail toggles — see the
   * `afterRenderEffect` in the constructor.
   */
  private readonly sidenavContainer = viewChild.required(MatSidenavContainer);

  /** The page region, so a route change and the skip link can both move focus into it. */
  private readonly main = viewChild<ElementRef<HTMLElement>>('main');

  /**
   * Breakpoints are observed as one query each and bridged into signals with
   * `toSignal`, so the template reads them synchronously with no `async` pipe and
   * no manual unsubscribe.
   */
  protected readonly isMobile = toSignal(
    this.breakpoints.observe(Breakpoints.XSmall).pipe(map((state) => state.matches)),
    { initialValue: false },
  );

  /**
   * Tablet and narrow-laptop widths, where the shell is the desktop one but has less to spend.
   *
   * Used by the topbar to drop the breadcrumb trail while keeping the page title and inline search.
   * Previously there were only two states — mobile and everything else — so a 900px window rendered
   * a full trail alongside a full search field and the two fought for the same row.
   */
  protected readonly isCompact = toSignal(
    this.breakpoints.observe('(max-width: 1279.98px)').pipe(map((state) => state.matches)),
    { initialValue: window.matchMedia('(max-width: 1279.98px)').matches },
  );

  /**
   * Persisted collapse preference.
   *
   * The fallback is viewport-dependent, so a first-time visitor on a tablet starts
   * with the rail and one on a large display starts expanded — without ever
   * overriding a choice they have actually made.
   */
  private readonly collapsePreference = signal(
    this.storage.get<boolean>(StorageKeys.sidebarCollapsed, window.innerWidth < 1280),
  );

  /** Mobile drawer visibility. Not persisted. */
  protected readonly drawerOpen = signal(false);
  protected readonly mobileSearchOpen = signal(false);

  /**
   * Whether the content area has scrolled away from the top, which raises the topbar's shadow.
   *
   * A boolean rather than the offset: the bar has two states, and storing the pixel value would
   * write a signal on every scroll frame and re-run the topbar's change detection each time for a
   * number nothing reads. `onContentScroll` only sets this when the answer actually flips.
   */
  protected readonly contentScrolled = signal(false);

  /**
   * Rail mode applies only on desktop: on mobile the drawer is full width, where an
   * icon rail would be a strange half-open state.
   */
  protected readonly railMode = computed(() =>
    this.isMobile() ? false : this.collapsePreference(),
  );

  protected readonly sidenavOpen = computed(() => (this.isMobile() ? this.drawerOpen() : true));

  /**
   * Explicit pixel width rather than a scale step, so 72px is guaranteed.
   *
   * The width transition is what makes collapsing read as one movement instead of a jump. It is
   * paired with `updateContentMargins()` in the constructor, which re-measures the content offset —
   * without that the content would snap to its new margin while the drawer was still sliding.
   *
   * `motion-reduce:transition-none` because a 240px width animation is exactly the kind of motion
   * someone with vestibular sensitivity turns off.
   */
  protected readonly sidenavWidthClass = computed(() => {
    const base =
      '!border-r-0 transition-[width] duration-pb-base ease-pb-in-out motion-reduce:transition-none';
    return this.railMode() ? `${base} !w-[72px]` : `${base} !w-64`;
  });

  constructor() {
    /*
     * Announce the new page, and move focus into it.
     *
     * A single-page app changes the whole screen without telling anyone: the browser's own
     * navigation announcement does not fire, focus stays on the link that was pressed — which no
     * longer exists — and a screen-reader user is left on a page they were not told they had
     * reached. Both halves are needed and they fix different things:
     *
     * - **The announcement** says where you are. `LiveAnnouncer` writes to a polite live region, so
     *   it queues behind whatever is currently being read rather than interrupting it.
     * - **Moving focus to `<main>`** decides where the next Tab goes. Without it, tabbing after a
     *   navigation resumes from the middle of the sidebar; with it, the next stop is the first
     *   control on the page you just opened.
     *
     * Skipped on the very first load, where the browser has already announced the document and
     * stealing focus would fight the user's own starting position.
     *
     * The title comes from `BreadcrumbService`, the same source the topbar's heading uses, so the
     * spoken name and the visible one cannot disagree.
     */
    let firstNavigation = true;

    effect(() => {
      this.routeKey();

      if (firstNavigation) {
        firstNavigation = false;
        return;
      }

      const trail = this.breadcrumbs.breadcrumbs();
      const title = trail.length > 0 ? (trail[trail.length - 1]?.label ?? 'Page') : 'Page';

      void this.announcer.announce(`${title} page loaded`, 'polite');

      /*
       * After render, because the outgoing page is still mounted when the route signal fires —
       * focusing then would land on an element about to be destroyed, and the browser would move
       * focus back to <body> a frame later.
       */
      afterNextRender(
        () => {
          this.main()?.nativeElement.focus({ preventScroll: true });
        },
        { injector: this.injector },
      );
    });

    /*
     * Recompute the content offset when the rail toggles.
     *
     * `MatSidenavContainer` sets the content's `margin-left` from the drawer's
     * measured width, but only recalculates on open/close — not when the drawer's
     * width changes via CSS. Without this the content keeps a 256px margin while the
     * rail is 72px wide, leaving 184px of dead space.
     *
     * `afterRenderEffect` rather than `effect`, because the new width must already be
     * in the DOM for the measurement to be right.
     */
    afterRenderEffect(() => {
      this.railMode();
      this.sidenavContainer().updateContentMargins();
    });

    effect(() => {
      this.storage.set(StorageKeys.sidebarCollapsed, this.collapsePreference());
    });

    // Leaving mobile with the drawer open would otherwise pin the sidebar open
    // in `side` mode with no way to tell it was the drawer's state.
    effect(() => {
      if (!this.isMobile() && this.drawerOpen()) {
        this.drawerOpen.set(false);
      }
    });

    // The mobile-only search row must not linger after a rotate or resize.
    effect(() => {
      if (!this.isMobile() && this.mobileSearchOpen()) {
        this.mobileSearchOpen.set(false);
      }
    });
  }

  protected toggleSidebar(): void {
    if (this.isMobile()) {
      this.drawerOpen.update((open) => !open);
      return;
    }

    this.collapsePreference.update((collapsed) => !collapsed);
  }

  /**
   * ⌘K / Ctrl-K toggles the command palette.
   *
   * Toggle rather than open, so the same chord that summoned it dismisses it — which is what every
   * tool this borrows from does, and what a user who pressed it by accident will try.
   *
   * `preventDefault` unconditionally: ⌘K is "open location" in Safari and focuses the address bar in
   * Chrome, either of which takes the user out of the app entirely.
   */
  protected onCommandKey(event: Event): void {
    event.preventDefault();
    this.palette.toggle();
  }

  /**
   * `?` opens the keyboard reference.
   *
   * Matched on the produced **character**, not on a chord. `keydown.shift./` was the obvious binding
   * and it never fired once: Angular's key plugin compares `event.key`, and Shift plus `/` produces
   * `event.key === '?'` — so the binding was asking for a `/` the browser never reports. Reading the
   * character also makes it work on layouts where `?` needs a different physical chord.
   *
   * This is the one place a broad `keydown` listener is justified: it returns immediately for every
   * other key, and the alternative is a binding that silently does nothing.
   *
   * Ignored while typing, and only opened once: pressing `?` with the sheet already up should do
   * nothing rather than stack a second copy.
   */
  protected onGlobalKey(event: Event): void {
    if (!(event instanceof KeyboardEvent) || event.key !== '?') {
      return;
    }
    if (this.isTypingInto(event.target)) {
      return;
    }
    if (
      this.dialog.openDialogs.some(
        (ref) => ref.componentInstance instanceof AppShortcutsHelpComponent,
      )
    ) {
      return;
    }

    event.preventDefault();
    this.dialog.open(AppShortcutsHelpComponent, {
      width: '520px',
      maxWidth: 'calc(100vw - 2rem)',
      autoFocus: 'dialog',
    });
  }

  /**
   * Whether a keystroke belongs to a field rather than to the app.
   *
   * `isContentEditable` covers rich-text areas that are neither input nor textarea. The palette's own
   * input is included by being an `input`, which is why ⌘K still toggles it closed from inside itself —
   * that handler deliberately does not consult this.
   */
  private isTypingInto(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  protected toggleMobileSearch(): void {
    this.mobileSearchOpen.update((open) => !open);
  }

  /**
   * Tracks whether the content has scrolled, for the topbar's shadow.
   *
   * The threshold is 4px rather than 0 so a trackpad's elastic overscroll — or a sub-pixel offset
   * left behind by a restored scroll position — does not flicker the shadow on and off at rest.
   *
   * Guarded on a change of state, so a fast scroll writes the signal once instead of on every one of
   * the sixty events it produces per second.
   */
  protected onContentScroll(event: Event): void {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const scrolled = target.scrollTop > 4;

    if (scrolled !== this.contentScrolled()) {
      this.contentScrolled.set(scrolled);
    }
  }

  /** Closes the drawer after navigation, so the destination is actually visible. */
  /**
   * Moves focus into the page, for the skip link.
   *
   * `preventDefault` and an explicit `focus()` rather than letting the fragment navigate: Angular's
   * router owns the URL, and a bare `href="#pb-main"` would push a fragment onto the route and
   * re-run the guards. This does the one thing the link is for.
   */
  protected focusMain(event: Event): void {
    event.preventDefault();
    this.main()?.nativeElement.focus();
  }

  protected onSidebarNavigate(): void {
    if (this.isMobile()) {
      this.drawerOpen.set(false);
    }
  }

  /**
   * Sends the topbar search to the inventory list.
   *
   * Inventory is the only searchable collection so far, so "global" search routes there
   * rather than sitting inert — a search box that does nothing is worse than no search
   * box. Passing the term as a query parameter also makes a filtered list linkable and
   * survivable across a reload.
   *
   * When more collections exist this should become a real cross-entity search page; until
   * then, routing to the one thing that can be searched is the honest behaviour.
   */
  protected onSearch(term: string): void {
    const search = term.trim();

    void this.router.navigate(['/inventory'], {
      queryParams: { search: search.length > 0 ? search : null },
      queryParamsHandling: 'merge',
    });

    if (this.isMobile()) {
      this.mobileSearchOpen.set(false);
    }
  }
}
