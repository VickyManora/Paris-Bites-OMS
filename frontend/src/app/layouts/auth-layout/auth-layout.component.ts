import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Shell for unauthenticated pages (sign in, password reset).
 *
 * Separate from `MainLayoutComponent` because these pages must not render the
 * sidebar or account menu — both of which read authenticated state that does not
 * exist yet.
 *
 * This is the only screen dressed in the customer-facing brand: the cream-to-pink wash, the gold
 * serif wordmark and the Playfair/Poppins pairing all come from `auth-theme.css`, keyed off the
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
          <p class="pb-auth-eyebrow m-0 text-[0.6875rem]">Chocolaterie &amp; Desserts</p>
          <!--
            Sized in rem with a clamp rather than a Tailwind text utility: this is the one piece of
            display type in the app, and it needs to shrink on a narrow phone without wrapping
            mid-wordmark.
          -->
          <h1
            class="pb-auth-wordmark m-0 mt-1.5 text-[clamp(2.25rem,10vw,2.875rem)] leading-tight"
          >
            Paris Bites
          </h1>
          <p class="m-0 mt-2 text-sm">Operations &amp; inventory console</p>
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
