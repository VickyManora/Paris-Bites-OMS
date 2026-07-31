import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Shell for unauthenticated pages (sign in, password reset).
 *
 * Separate from `MainLayoutComponent` because these pages must not render the
 * sidebar or account menu — both of which read authenticated state that does not
 * exist yet.
 *
 * This is the only screen dressed in the customer-facing brand: the cream-to-pink wash, the real
 * gold lockup and the Playfair/Poppins pairing all come from `auth-theme.css`, keyed off the
 * `pb-auth-theme` class on the root element here. Past sign-in the app returns to the neutral
 * design system, where density and legibility matter more than atmosphere.
 */
@Component({
  selector: 'pb-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `
    <div class="pb-auth-theme flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div class="w-full max-w-md">
        <div class="mb-8 text-center">
          <!--
            The real lockup, which already contains the wordmark and 'Chocolaterie & Desserts', so
            neither is typeset again here.

            'width'/'height' are the asset's own pixels — they only need to agree in ratio with the
            rendered size for the browser to reserve the right space, which stops the card jumping
            down the page as the image arrives. Displayed at roughly a third of that, so it stays
            crisp on a 3x phone screen.

            Not lazy-loaded on purpose: it is the largest thing above the fold, and 'lazy' would
            delay the one image that should arrive first.
          -->
          <h1 class="m-0">
            <img
              src="brand/paris-bites-logo.webp"
              alt="Paris Bites — Chocolaterie &amp; Desserts"
              width="720"
              height="469"
              decoding="async"
              fetchpriority="high"
              class="mx-auto block h-auto w-[min(17.5rem,78vw)]"
            />
          </h1>
          <p class="m-0 mt-4 text-sm">Operations &amp; inventory console</p>
        </div>

        <div class="pb-auth-card p-6 sm:p-8">
          <router-outlet />
        </div>

        <p class="mt-6 text-center text-xs opacity-70">
          Staff access only. Every sign-in is recorded.
        </p>
      </div>
    </div>
  `,
})
export class AuthLayoutComponent {}
