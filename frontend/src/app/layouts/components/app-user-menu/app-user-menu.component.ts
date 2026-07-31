import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/services/auth.service';
import { AppRoutes } from '../../../core/constants/app.constants';
import { ROLE_LABELS } from '../../../core/models/role.model';
import { ThemeService, type ThemeMode } from '../../../core/services/theme.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import type { PbIconName } from '../../../shared/components/icon/icon-registry';
import { MATERIAL_LAYOUT_IMPORTS } from '../../../shared/material/material-imports';
import { InitialsPipe } from '../../../shared/pipes/initials.pipe';

/** One appearance choice. `mode` is what gets written to `ThemeService`. */
interface ThemeChoice {
  readonly mode: ThemeMode;
  readonly label: string;
  readonly icon: PbIconName;
}

/**
 * Avatar button opening the account menu: identity, appearance, password, sign out.
 *
 * ## Appearance is three choices, not a toggle
 *
 * `ThemeService` has always held `light | dark | system`, but the only controls that existed called
 * `toggle()`, which flips between light and dark and *leaves* system for good. So a preference the
 * service persisted, followed live through `matchMedia`, and defaulted every new user to was
 * unreachable from the interface the moment anyone touched a theme control — and there was no way
 * back to it short of clearing storage.
 *
 * The three are separate `menuitemradio` items rather than the segmented control this would ideally
 * be. A segmented row is prettier and would be unreachable: `MatMenu` runs its arrow-key navigation
 * over `MatMenuItem` instances and closes on Tab, so plain buttons inside the panel can be clicked
 * and never focused. Three real menu items keyboard-navigate correctly and announce their own state.
 *
 * The topbar's one-press toggle stays for the common case — this menu is where you go to choose, not
 * where you go to flip.
 */
@Component({
  selector: 'pb-app-user-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent, InitialsPipe, ...MATERIAL_LAYOUT_IMPORTS],
  host: {
    class: 'block',
  },
  template: `
    <!--
      The avatar is the whole target, with a ring that appears on hover.

      It used to sit inside a Material icon button, which drew a 40px ripple around a 32px circle —
      two concentric round shapes, one of which flashed. The ring reads as "this opens something"
      without adding a second silhouette, and it is the same interaction pink the rest of the shell
      uses for hover.
    -->
    <button
      type="button"
      [class]="triggerClass"
      [matMenuTriggerFor]="menu"
      [attr.aria-label]="'Account menu for ' + auth.displayName()"
    >
      <span class="pb-avatar h-8 w-8">
        {{ auth.displayName() | pbInitials }}
      </span>
    </button>

    <mat-menu #menu="matMenu" class="pb-shell-menu">
      @if (auth.user(); as user) {
        <!-- Identity is a header, not a menu item: it is not actionable, and letting arrow keys
             land on it makes the menu awkward from the keyboard. -->
        <div class="flex items-center gap-pb-3 px-pb-3 pb-pb-2 pt-pb-3" tabindex="-1">
          <span class="pb-avatar h-9 w-9" aria-hidden="true">
            {{ user.fullName | pbInitials }}
          </span>
          <div class="min-w-0">
            <p class="m-0 truncate text-pb-subtitle text-on-surface">{{ user.fullName }}</p>
            <p class="m-0 truncate text-pb-caption text-pb-text-secondary">{{ user.email }}</p>
          </div>
        </div>

        <div class="px-pb-3 pb-pb-3" tabindex="-1">
          <span class="pb-badge pb-badge-pill pb-tone-info">{{ roleLabels[user.role] }}</span>
        </div>

        <div class="mb-pb-1 h-px bg-outline-variant" aria-hidden="true"></div>
      }

      <!--
        Group label. 'aria-hidden' with the group named on the wrapper instead, so the heading is
        announced once as the group's name rather than read as a fourth, unselectable option.
      -->
      <div role="group" aria-label="Appearance">
        <p
          class="m-0 px-pb-3 pb-pb-1 pt-pb-2 text-pb-overline uppercase text-pb-text-secondary"
          aria-hidden="true"
        >
          Appearance
        </p>

        @for (choice of themeChoices; track choice.mode) {
          <button
            mat-menu-item
            type="button"
            role="menuitemradio"
            [attr.aria-checked]="theme.currentMode() === choice.mode"
            (click)="theme.setMode(choice.mode)"
          >
            <pb-icon [name]="choice.icon" [size]="18" class="mr-pb-2 text-pb-text-secondary" />
            <span class="text-pb-body">{{ choice.label }}</span>

            <!--
              The tick is the visible half of 'aria-checked'. Rendered for the selected row only, and
              pushed to the trailing edge so the three labels stay left-aligned with each other —
              indenting the unselected two to make room would read as a hierarchy that is not there.
            -->
            @if (theme.currentMode() === choice.mode) {
              <pb-icon name="check" [size]="16" class="ml-auto text-pb-link" />
            }
          </button>
        }
      </div>

      <div class="my-pb-1 h-px bg-outline-variant" aria-hidden="true"></div>

      <a mat-menu-item [routerLink]="profileRoute">
        <pb-icon name="profile" [size]="18" class="mr-pb-2 text-pb-text-secondary" />
        <span class="text-pb-body">My profile</span>
      </a>

      <a mat-menu-item [routerLink]="changePasswordRoute">
        <pb-icon name="password" [size]="18" class="mr-pb-2 text-pb-text-secondary" />
        <span class="text-pb-body">Change password</span>
      </a>

      <div class="my-pb-1 h-px bg-outline-variant" aria-hidden="true"></div>

      <button mat-menu-item type="button" class="pb-menu-danger" (click)="auth.logout()">
        <pb-icon name="signOut" [size]="18" class="mr-pb-2" />
        <span class="text-pb-body">Sign out</span>
      </button>
    </mat-menu>
  `,
})
export class AppUserMenuComponent {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly changePasswordRoute = AppRoutes.changePassword;

  /** `rounded-pb-full` so the hover ring follows the avatar rather than boxing it. */
  protected readonly triggerClass =
    'grid h-11 w-11 shrink-0 cursor-pointer appearance-none place-items-center rounded-pb-full border-0 bg-transparent p-0 ring-2 ring-transparent transition-[box-shadow,transform] duration-pb-fast ease-pb-out hover:ring-pb-selected-border focus-visible:ring-pb-interactive motion-reduce:transition-none';
  protected readonly profileRoute = AppRoutes.profile;

  /**
   * `system` last, and named "System" rather than "Auto".
   *
   * Light and dark are the two an intentional user is choosing between; system is the deferral, so it
   * belongs after them. "System" says *whose* setting is being followed, which "Auto" does not — and
   * a user who has just discovered their app went dark at sunset needs to know it was the OS.
   */
  protected readonly themeChoices: readonly ThemeChoice[] = [
    { mode: 'light', label: 'Light', icon: 'themeLight' },
    { mode: 'dark', label: 'Dark', icon: 'themeDark' },
    { mode: 'system', label: 'System', icon: 'themeSystem' },
  ];
}
