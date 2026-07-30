import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  type ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import {
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withRouterConfig,
} from '@angular/router';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MAT_ICON_DEFAULT_OPTIONS } from '@angular/material/icon';
import { MAT_SNACK_BAR_DEFAULT_OPTIONS } from '@angular/material/snack-bar';
import { provideServiceWorker } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { AuthService } from './core/auth/services/auth.service';
import { HTTP_INTERCEPTORS_CHAIN } from './core/http/interceptors/index';
import { ThemeService } from './core/services/theme.service';

/**
 * Root application providers.
 *
 * This is the composition root of the frontend: the one file that decides which
 * implementations back the app's abstractions.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    /**
     * Zoneless change detection. Signals notify Angular directly, so zone.js is
     * not needed — which removes its monkey-patching of every async API and the
     * over-broad change detection that comes with it.
     */
    provideZonelessChangeDetection(),

    /** Surfaces uncaught errors and rejections through Angular's ErrorHandler. */
    provideBrowserGlobalErrorListeners(),

    provideRouter(
      routes,
      // Binds route params and query params straight to component inputs, so
      // pages declare `readonly id = input.required<string>()` instead of
      // subscribing to an ActivatedRoute.
      withComponentInputBinding(),
      withInMemoryScrolling({
        scrollPositionRestoration: 'enabled',
        anchorScrolling: 'enabled',
      }),
      // A navigation to the current URL should refetch data rather than no-op —
      // this is what makes a "refresh" link work.
      withRouterConfig({ onSameUrlNavigation: 'reload' }),
    ),

    provideHttpClient(
      // `fetch` rather than XHR: better streaming support and no XHR polyfill.
      withFetch(),
      withInterceptors([...HTTP_INTERCEPTORS_CHAIN]),
    ),

    /** Loaded lazily so animation code stays out of the initial bundle. */
    provideAnimationsAsync(),

    /*
     * Service worker — what makes the app installable and gives it a native-feeling cold start.
     *
     * Scope is deliberately narrow: `ngsw-config.json` precaches the **app shell** (JS, CSS,
     * index) and lazily caches static media. It declares **no `dataGroups`**, so no API response
     * is ever served from cache. That distinction is the whole design — a POS that shows a
     * cached menu or a cached day's takings while offline would be lying about the state of the
     * business, and a stale price is a wrong charge.
     *
     * Offline *order capture* is therefore not implemented, only made reachable: queuing writes
     * needs an outbox and a replay story, and the idempotency key that order placement already
     * sends is the piece that would make that replay safe.
     *
     * Development is excluded so `ng serve` never serves stale code — a cached shell during
     * development wastes an afternoon before anyone suspects the service worker. `registerWhenStable`
     * keeps registration off the critical path, and the 30s fallback covers a page that never
     * reaches stability.
     */
    provideServiceWorker('ngsw-worker.js', {
      enabled: environment.production,
      registrationStrategy: 'registerWhenStable:30000',
    }),

    /**
     * Restores the session before the first route resolves.
     *
     * Without this, guards would run against empty auth state on a page reload
     * and bounce an authenticated user to the login screen.
     */
    provideAppInitializer(() => {
      const auth = inject(AuthService);
      // Instantiate eagerly so the theme is applied before first paint,
      // avoiding a flash of the wrong colour scheme.
      inject(ThemeService);

      return firstValueFrom(auth.restoreSession());
    }),

    /** App-wide Material defaults, so no component repeats them. */
    {
      /*
       * `mat-icon` defaults to the `material-icons` class, which expects the legacy
       * *Material Icons* font. This app loads *Material Symbols* — the current,
       * actively maintained set — so without this override every icon renders as its
       * raw ligature text ("search", "menu") in the body font.
       *
       * `material-symbols-outlined` is the class Google's own stylesheet defines, so
       * the font family, 24px size and `liga` feature all come from the vendor CSS.
       */
      provide: MAT_ICON_DEFAULT_OPTIONS,
      useValue: { fontSet: 'material-symbols-outlined' },
    },
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline', subscriptSizing: 'dynamic' },
    },
    {
      provide: MAT_SNACK_BAR_DEFAULT_OPTIONS,
      useValue: { horizontalPosition: 'center', verticalPosition: 'bottom', duration: 4000 },
    },
  ],
};
