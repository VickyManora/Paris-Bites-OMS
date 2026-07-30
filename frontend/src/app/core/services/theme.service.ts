import { computed, effect, inject, Injectable, signal, type Signal } from '@angular/core';
import { StorageKeys } from '../constants/storage-keys';
import { StorageService } from './storage.service';

export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Light/dark theming, persisted across sessions.
 *
 * Signals rather than a `BehaviorSubject`: the resolved theme is a pure
 * derivation of the stored preference and the OS setting, which is exactly what
 * `computed` expresses. Templates read it without a subscription or `async` pipe.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storage = inject(StorageService);

  private readonly systemPrefersDark = signal(this.readSystemPreference());
  private readonly mode = signal<ThemeMode>(
    this.storage.get<ThemeMode>(StorageKeys.theme, 'system'),
  );

  readonly currentMode: Signal<ThemeMode> = this.mode.asReadonly();

  /** The theme actually applied, after resolving `system`. */
  readonly isDark: Signal<boolean> = computed(() => {
    const mode = this.mode();
    return mode === 'system' ? this.systemPrefersDark() : mode === 'dark';
  });

  constructor() {
    this.watchSystemPreference();

    // Keep the DOM and storage in sync with state, in one place, so no caller
    // has to remember to do both.
    effect(() => {
      const dark = this.isDark();
      document.documentElement.classList.toggle('dark', dark);
      // Drives Material 3 `light-dark()` colour resolution and native controls.
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      this.syncBrowserChrome(dark);
    });

    effect(() => {
      this.storage.set(StorageKeys.theme, this.mode());
    });
  }

  setMode(mode: ThemeMode): void {
    this.mode.set(mode);
  }

  /** Toggles to the opposite of what is currently *shown*, leaving `system`. */
  toggle(): void {
    this.mode.set(this.isDark() ? 'light' : 'dark');
  }

  /**
   * Points the `theme-color` meta at the surface the app is actually painting.
   *
   * This is the colour a mobile browser tints its own chrome with, and on an installed PWA it is the
   * status bar. `index.html` ships `#ffffff` and describes it as "set by ThemeService before first
   * paint" — which was not true of any version of this service, so an installed app in dark mode had
   * a white status bar above a near-black page.
   *
   * The value is read back from the live `--mat-sys-surface` token rather than hardcoded, so it stays
   * correct if the Material palette in `styles.scss` changes. The class and `colorScheme` are set
   * above in the same effect, so by the time this runs the token has already resolved to the right
   * side of its `light-dark()`.
   *
   * A missing tag is not created: the tag is in `index.html`, and silently inserting one here would
   * hide its removal rather than surface it.
   */
  private syncBrowserChrome(dark: boolean): void {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

    if (meta === null) {
      return;
    }

    const surface = getComputedStyle(document.documentElement)
      .getPropertyValue('--mat-sys-surface')
      .trim();

    meta.content = surface.length > 0 ? surface : dark ? '#171213' : '#fff8f8';
  }

  private readSystemPreference(): boolean {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  }

  private watchSystemPreference(): void {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');

    // Reacts while the app is open, so `system` mode follows an OS-level switch.
    query?.addEventListener('change', (event) => {
      this.systemPrefersDark.set(event.matches);
    });
  }
}
