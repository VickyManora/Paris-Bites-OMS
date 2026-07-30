import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppRoutes } from '../../core/constants/app.constants';
import { MATERIAL_CORE_IMPORTS } from '../../shared/material/material-imports';

/**
 * 403 page, shown when `roleGuard` denies a route or the API returns 403.
 *
 * Distinct from the 404 page on purpose: "you cannot see this" and "this does not
 * exist" call for different next steps from the user.
 */
@Component({
  selector: 'pb-forbidden-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ...MATERIAL_CORE_IMPORTS],
  template: `
    <div class="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <mat-icon class="!h-16 !w-16 !text-6xl text-error" aria-hidden="true">lock</mat-icon>

      <h1 class="text-pb-heading">Access denied</h1>
      <p class="text-pb-body max-w-prose text-on-surface-variant">
        Your account does not have permission to view this page. Contact an administrator if you
        believe this is a mistake.
      </p>

      <a matButton="filled" [routerLink]="dashboardRoute">Back to dashboard</a>
    </div>
  `,
})
export class ForbiddenPage {
  protected readonly dashboardRoute = AppRoutes.dashboard;
}
