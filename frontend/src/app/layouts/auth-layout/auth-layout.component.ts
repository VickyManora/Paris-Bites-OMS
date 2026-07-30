import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Shell for unauthenticated pages (sign in, password reset).
 *
 * Separate from `MainLayoutComponent` because these pages must not render the
 * sidebar or account menu — both of which read authenticated state that does not
 * exist yet.
 */
@Component({
  selector: 'pb-auth-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `
    <div class="flex min-h-dvh flex-col items-center justify-center bg-surface-container p-4">
      <div class="w-full max-w-md">
        <div class="mb-8 text-center">
          <h1 class="text-pb-heading text-primary">Paris Bites</h1>
          <p class="text-pb-body mt-1 text-on-surface-variant">Inventory Management</p>
        </div>

        <div class="rounded-2xl border border-outline-variant bg-surface p-6 shadow-sm sm:p-8">
          <router-outlet />
        </div>
      </div>
    </div>
  `,
})
export class AuthLayoutComponent {}
