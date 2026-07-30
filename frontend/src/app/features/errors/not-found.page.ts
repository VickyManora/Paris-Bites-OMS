import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AppRoutes } from '../../core/constants/app.constants';
import { MATERIAL_CORE_IMPORTS } from '../../shared/material/material-imports';

/** 404 page for the router's wildcard route. */
@Component({
  selector: 'pb-not-found-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ...MATERIAL_CORE_IMPORTS],
  template: `
    <div class="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <mat-icon class="!h-16 !w-16 !text-6xl text-on-surface-variant" aria-hidden="true">
        explore_off
      </mat-icon>

      <h1 class="text-pb-heading">Page not found</h1>
      <p class="text-pb-body max-w-prose text-on-surface-variant">
        The page you are looking for does not exist or may have been moved.
      </p>

      <a matButton="filled" [routerLink]="dashboardRoute">Back to dashboard</a>
    </div>
  `,
})
export class NotFoundPage {
  protected readonly dashboardRoute = AppRoutes.dashboard;
}
