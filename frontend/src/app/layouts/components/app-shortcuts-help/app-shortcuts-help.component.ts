import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { DialogShellComponent } from '../../../shared/components/dialog-shell/dialog-shell.component';
import { MATERIAL_CORE_IMPORTS } from '../../../shared/material/material-imports';

/** One row of the reference. `keys` renders as separate `kbd` elements. */
interface Shortcut {
  readonly keys: readonly string[];
  readonly description: string;
}

interface ShortcutGroup {
  readonly title: string;
  readonly shortcuts: readonly Shortcut[];
}

/**
 * The keyboard reference, opened with `?`.
 *
 * ## Why a sheet rather than a documentation page
 *
 * A shortcut nobody knows about is a shortcut nobody uses, and the moment someone wants the list is the
 * moment they are already in the app with their hands on the keys. `?` is the convention for exactly
 * that — GitHub, Linear, Gmail — and it costs one keystroke from anywhere.
 *
 * The list is hand-maintained rather than derived from a registry, and that is a real trade: it can
 * drift from the handlers in `MainLayoutComponent` and `AppTopbarComponent`. A registry would fix that
 * and would mean routing every binding through an indirection for six entries. The honest mitigation is
 * that the bindings and this list are named in each other's comments, so changing one surfaces the
 * other in review.
 */
@Component({
  selector: 'pb-app-shortcuts-help',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, DialogShellComponent, ...MATERIAL_CORE_IMPORTS],
  template: `
    <pb-dialog-shell
      title="Keyboard shortcuts"
      subtitle="Everything below works from anywhere in the app"
      icon="keyboard"
    >
      <div class="flex flex-col gap-pb-4">
        @for (group of groups; track group.title) {
          <section>
            <h3 class="m-0 mb-pb-2 text-pb-overline uppercase text-on-surface-variant">
              {{ group.title }}
            </h3>

            <!--
              A description list: each row pairs a control with what it does, which is what 'dl' means.
              A table would imply a second dimension that is not there.
            -->
            <dl class="m-0 flex flex-col">
              @for (shortcut of group.shortcuts; track shortcut.description) {
                <div
                  class="flex items-center justify-between gap-pb-3 border-b border-outline-variant py-pb-2 last:border-b-0"
                >
                  <dt class="min-w-0 text-pb-body text-on-surface">{{ shortcut.description }}</dt>
                  <dd class="m-0 flex shrink-0 items-center gap-1">
                    @for (key of shortcut.keys; track key) {
                      <kbd class="pb-kbd">{{ key }}</kbd>
                    }
                  </dd>
                </div>
              }
            </dl>
          </section>
        }
      </div>

      <button slot="actions" matButton="filled" type="button" (click)="dialogRef.close()">
        Got it
      </button>
    </pb-dialog-shell>
  `,
})
export class AppShortcutsHelpComponent {
  readonly dialogRef = inject<MatDialogRef<AppShortcutsHelpComponent>>(MatDialogRef);

  /**
   * The modifier as this keyboard spells it.
   *
   * Read once from the user agent, the same way the topbar's search hint is: showing ⌘ to a Windows
   * user teaches a shortcut that does not work, which is worse than showing none.
   */
  private readonly mod = /mac|iphone|ipad|ipod/i.test(navigator.userAgent) ? '⌘' : 'Ctrl';

  protected readonly groups: readonly ShortcutGroup[] = [
    {
      title: 'Anywhere',
      shortcuts: [
        { keys: [this.mod, 'K'], description: 'Open the command palette' },
        { keys: ['/'], description: 'Search products and suppliers' },
        { keys: ['?'], description: 'Show this list' },
        { keys: ['Esc'], description: 'Close a dialog, sheet or palette' },
      ],
    },
    {
      title: 'In the command palette',
      shortcuts: [
        { keys: ['↑', '↓'], description: 'Move through the results' },
        { keys: ['↵'], description: 'Run the highlighted command' },
      ],
    },
    {
      title: 'In a list',
      shortcuts: [{ keys: ['Tab'], description: 'Move between filters, rows and the pager' }],
    },
  ];
}
