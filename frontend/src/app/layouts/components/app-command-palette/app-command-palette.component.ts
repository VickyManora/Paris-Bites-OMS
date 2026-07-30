import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth/services/auth.service';
import { Permission } from '../../../core/models/permission.model';
import { CommandPaletteService } from '../../../core/services/command-palette.service';
import { TablePreferencesService } from '../../../shared/components/data-table/table-preferences.service';
import { ThemeService } from '../../../core/services/theme.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import type { PbIconName } from '../../../shared/components/icon/icon-registry';
import { MATERIAL_LAYOUT_IMPORTS } from '../../../shared/material/material-imports';
import { NAV_SECTIONS } from '../app-sidebar/app-sidebar.component';

/** One thing the palette can do. `run` is what happens; `group` is only for display. */
interface Command {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly icon: PbIconName;
  /** Extra words that should match this command without appearing in its label. */
  readonly keywords?: string;
  readonly run: () => void;
}

/**
 * ⌘K / Ctrl-K — go anywhere, do anything, without leaving the keyboard.
 *
 * ## Why this and not a bigger search box
 *
 * ⌘K used to focus the topbar's product search, which is a different job: that searches *data*, and
 * this searches *the application*. Conflating them meant there was no way to reach Reports from the
 * keyboard, while the shortcut users bring from Linear and Stripe did something they did not expect.
 * `/` still focuses the data search, so both are available and neither is overloaded.
 *
 * ## The command list is derived, not registered
 *
 * Destinations come from `NAV_SECTIONS` — the same array the sidebar renders — filtered through the
 * same `auth.can()` checks. A registry would be a second list to keep in step, and the failure mode is
 * silent: a route added to the sidebar and forgotten here is a feature users cannot find by the means
 * they were taught.
 *
 * Permission filtering matters for more than tidiness. Offering a Store Manager a palette entry for
 * Analytics would send them to the access-denied page from a control that looked like it was for them.
 *
 * ## Matching
 *
 * Substring, with a scoring pass that puts prefix matches above word-start matches above anything
 * else. Deliberately not a fuzzy library: the corpus is roughly twenty short labels, so subsequence
 * matching adds a dependency and a class of surprising result ("sales" matching "Suppliers") for no
 * measurable gain at this size.
 *
 * ## Keyboard contract
 *
 * Arrow keys move, Enter runs, Escape closes, and the list wraps at both ends — a palette that stops
 * at the last item makes reaching the bottom entry from the top a held keypress. `aria-activedescendant`
 * carries the selection rather than moving focus, so the input keeps it and typing never breaks.
 */
@Component({
  selector: 'pb-app-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, ...MATERIAL_LAYOUT_IMPORTS],
  host: {
    class: 'contents',
  },
  template: `
    @if (palette.isOpen()) {
      <!--
        'fixed inset-0' with the panel near the top rather than centred: a palette that grows downward
        from a fixed position does not move the input as results filter, and the input is where the
        eye already is.
      -->
      <div class="fixed inset-0 z-50 flex items-start justify-center p-pb-3 pt-[10vh]">
        <!--
          The scrim is a button for the same reason the POS sheet's is: a div with a click handler is
          unreachable by keyboard, and a tabindex would put an unlabelled full-screen control in the
          tab order. Hidden from assistive tech — Escape is the keyboard path.
        -->
        <button
          type="button"
          tabindex="-1"
          aria-hidden="true"
          class="absolute inset-0 w-full cursor-default appearance-none border-0 bg-pb-scrim backdrop-blur-sm"
          (click)="palette.close()"
        ></button>

        <div
          class="pb-fade-in relative flex w-full max-w-xl flex-col overflow-hidden rounded-pb-xl border border-pb-border bg-pb-surface shadow-pb-lg"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <div class="flex items-center gap-pb-2 border-b border-pb-border px-pb-3">
            <pb-icon name="search" [size]="18" class="text-pb-text-secondary" />

            <!--
              'role="combobox"' with 'aria-activedescendant': the highlighted row is announced without
              focus ever leaving this input, which is what lets the user keep typing while arrowing.
            -->
            <input
              #queryInput
              type="text"
              class="min-w-0 flex-1 appearance-none border-0 bg-transparent py-pb-3 text-pb-body text-on-surface outline-none placeholder:text-on-surface-variant"
              placeholder="Search pages and actions…"
              autocomplete="off"
              spellcheck="false"
              role="combobox"
              aria-expanded="true"
              aria-controls="pb-palette-list"
              [attr.aria-activedescendant]="activeId()"
              [value]="query()"
              (input)="onQuery($any($event.target).value)"
              (keydown)="onKeydown($event)"
            />

            <kbd class="pb-kbd shrink-0" aria-hidden="true">esc</kbd>
          </div>

          @if (results().length === 0) {
            <div class="px-pb-4 py-pb-6 text-center">
              <span class="pb-icon-tile pb-tone-neutral mx-auto !h-10 !w-10" aria-hidden="true">
                <pb-icon name="searchEmpty" [size]="18" />
              </span>
              <p class="m-0 mt-pb-2 text-pb-body text-on-surface">Nothing matches that.</p>
              <p class="m-0 text-pb-caption text-on-surface-variant">
                Try a page name, or “theme”, “rows”, “sign out”.
              </p>
            </div>
          } @else {
            <ul
              id="pb-palette-list"
              role="listbox"
              aria-label="Commands"
              class="pb-scroll-thin m-0 max-h-80 list-none overflow-y-auto p-pb-2"
            >
              @for (command of results(); track command.id; let index = $index) {
                <!-- The group heading is repeated only when it changes, so the list reads as sections
                     without a second data structure to build them from. -->
                @if (index === 0 || results()[index - 1]!.group !== command.group) {
                  <li
                    class="px-pb-2 pb-pb-1 pt-pb-2 text-pb-overline uppercase text-on-surface-variant"
                    aria-hidden="true"
                  >
                    {{ command.group }}
                  </li>
                }

                <!--
                  eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus
                  --
                  An option row is deliberately **not** focusable and carries no key handler, which is
                  what the ARIA combobox pattern requires: focus stays on the input and
                  'aria-activedescendant' names the active row, so typing is never interrupted. Giving
                  each row a tabindex and its own keydown would put twenty stops between the input and
                  the list and break the pattern the screen-reader contract depends on. The keyboard path
                  is the input's own handler — arrows, Enter, Escape — which is tested.
                -->
                <li
                  [id]="'pb-palette-option-' + index"
                  role="option"
                  [attr.aria-selected]="index === selected()"
                  [class]="rowClass(index)"
                  (click)="run(command)"
                  (mouseenter)="selected.set(index)"
                >
                  <pb-icon [name]="command.icon" [size]="18" class="text-pb-text-secondary" />
                  <span class="min-w-0 flex-1 truncate">{{ command.label }}</span>
                  @if (index === selected()) {
                    <kbd class="pb-kbd shrink-0" aria-hidden="true">↵</kbd>
                  }
                </li>
              }
            </ul>
          }

          <div
            class="flex items-center gap-pb-3 border-t border-pb-border px-pb-3 py-pb-2 text-pb-caption text-pb-text-secondary"
          >
            <span class="flex items-center gap-1">
              <kbd class="pb-kbd" aria-hidden="true">↑</kbd>
              <kbd class="pb-kbd" aria-hidden="true">↓</kbd>
              to move
            </span>
            <span class="flex items-center gap-1">
              <kbd class="pb-kbd" aria-hidden="true">↵</kbd>
              to run
            </span>
            <span class="ml-auto flex items-center gap-1">
              <kbd class="pb-kbd" aria-hidden="true">?</kbd>
              shortcuts
            </span>
          </div>
        </div>
      </div>
    }
  `,
})
export class AppCommandPaletteComponent {
  protected readonly palette = inject(CommandPaletteService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly theme = inject(ThemeService);
  private readonly tables = inject(TablePreferencesService);

  private readonly queryInput = viewChild<ElementRef<HTMLInputElement>>('queryInput');

  protected readonly query = signal('');
  protected readonly selected = signal(0);

  /**
   * Everything the palette can do, in the order it should read when nothing is typed.
   *
   * Actions come first: someone who opened the palette with a specific verb in mind is served before
   * someone browsing, and the destinations below are also reachable from the sidebar.
   */
  private readonly commands = computed<readonly Command[]>(() => {
    const actions: Command[] = [
      {
        id: 'action-theme',
        label: this.theme.isDark() ? 'Switch to light theme' : 'Switch to dark theme',
        group: 'Actions',
        icon: this.theme.isDark() ? 'themeLight' : 'themeDark',
        keywords: 'theme dark light appearance',
        run: () => {
          this.theme.toggle();
        },
      },
      {
        id: 'action-density',
        label: this.tables.density() === 'compact' ? 'Use comfortable rows' : 'Use compact rows',
        group: 'Actions',
        icon: this.tables.density() === 'compact' ? 'densityComfortable' : 'densityCompact',
        keywords: 'density rows table compact comfortable spacing',
        run: () => {
          this.tables.toggleDensity();
        },
      },
    ];

    if (this.auth.can(Permission.POS_OPERATE)) {
      actions.unshift({
        id: 'action-new-order',
        label: 'New counter order',
        group: 'Actions',
        icon: 'pos',
        keywords: 'pos till sell order',
        run: () => {
          void this.router.navigate(['/pos/new']);
        },
      });
    }

    if (this.auth.can(Permission.PURCHASE_ORDER_CREATE)) {
      actions.push({
        id: 'action-record-purchase',
        label: 'Record a purchase',
        group: 'Actions',
        icon: 'purchases',
        keywords: 'invoice bill supplier buy',
        run: () => {
          void this.router.navigate(['/purchases/record']);
        },
      });
    }

    const destinations = NAV_SECTIONS.flatMap((section) =>
      section.items
        .filter((item) => item.permission === undefined || this.auth.can(item.permission))
        .map<Command>((item) => ({
          id: `nav-${item.route}`,
          label: item.label,
          group: 'Go to',
          icon: item.icon,
          keywords: section.title,
          run: () => {
            void this.router.navigate([item.route]);
          },
        })),
    );

    return [
      ...actions,
      ...destinations,
      {
        id: 'action-sign-out',
        label: 'Sign out',
        group: 'Session',
        icon: 'signOut',
        keywords: 'logout leave exit',
        run: () => {
          this.auth.logout();
        },
      },
    ];
  });

  protected readonly results = computed<readonly Command[]>(() => {
    const term = this.query().trim().toLowerCase();

    if (term.length === 0) {
      return this.commands();
    }

    /*
     * Score, then keep a stable order within each score.
     *
     * A label that *starts* with the term is almost always what was meant, so it outranks a match at a
     * later word boundary, which outranks a match anywhere — including one that only hit a keyword.
     * `sort` is stable in every engine this runs on, so equal scores keep the declaration order above.
     */
    const scored = this.commands()
      .map((command) => ({ command, score: this.score(command, term) }))
      .filter((entry) => entry.score > 0);

    scored.sort((a, b) => b.score - a.score);

    return scored.map((entry) => entry.command);
  });

  protected readonly activeId = computed(() =>
    this.results().length === 0 ? null : `pb-palette-option-${String(this.selected())}`,
  );

  constructor() {
    /*
     * Reset and focus on open.
     *
     * A palette that reopens holding the last query is a palette you have to clear before using —
     * and the commonest reason to reopen it is that the last search was wrong.
     *
     * The input is created by the `@if` in the same change-detection pass, so focusing needs to wait
     * for it to exist. `afterNextRender` would only fire once; this effect re-runs on every open.
     */
    effect(() => {
      if (!this.palette.isOpen()) {
        return;
      }

      this.query.set('');
      this.selected.set(0);

      requestAnimationFrame(() => {
        this.queryInput()?.nativeElement.focus();
      });
    });
  }

  protected onQuery(value: string): void {
    this.query.set(value);
    // Back to the top: the previous index almost never means the same thing against a new list, and
    // leaving it can point past the end.
    this.selected.set(0);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.results().length;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (count > 0) {
          this.selected.update((index) => (index + 1) % count);
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (count > 0) {
          this.selected.update((index) => (index - 1 + count) % count);
        }
        break;
      case 'Enter': {
        event.preventDefault();
        const command = this.results()[this.selected()];
        if (command !== undefined) {
          this.run(command);
        }
        break;
      }
      case 'Escape':
        event.preventDefault();
        this.palette.close();
        break;
      default:
        break;
    }
  }

  protected run(command: Command): void {
    // Closed first, so a command that navigates does not animate the palette out over a new page.
    this.palette.close();
    command.run();
  }

  protected rowClass(index: number): string {
    const base =
      'flex cursor-pointer items-center gap-pb-3 rounded-pb-md px-pb-2 py-pb-2 text-pb-body transition-colors duration-pb-instant ease-pb-in-out';

    return index === this.selected()
      ? `${base} bg-pb-neutral-surface text-on-surface`
      : `${base} text-on-surface`;
  }

  private score(command: Command, term: string): number {
    const label = command.label.toLowerCase();

    if (label.startsWith(term)) {
      return 100;
    }
    if (label.includes(` ${term}`)) {
      return 60;
    }
    if (label.includes(term)) {
      return 40;
    }
    if ((command.keywords ?? '').toLowerCase().includes(term)) {
      return 20;
    }

    return 0;
  }
}
