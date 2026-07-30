import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../core/auth/services/auth.service';
import type { AppError } from '../../core/errors/app-error';
import { Role } from '../../core/models/role.model';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { PageHeaderComponent } from '../../shared/components/page-header/page-header.component';
import { MATERIAL_CORE_IMPORTS } from '../../shared/material/material-imports';
import { AdminDashboardComponent } from './components/admin-dashboard/admin-dashboard.component';
import { ManagerDashboardComponent } from './components/manager-dashboard/manager-dashboard.component';
import type { Dashboard } from './models/dashboard.model';
import { DashboardService } from './services/dashboard.service';
import { ErrorStateComponent } from '../../shared/components/error-state/error-state.component';
import { DashboardSkeletonComponent } from './components/dashboard-skeleton/dashboard-skeleton.component';

/**
 * The dashboard shell.
 *
 * Loads once and hands the payload to whichever layout the role calls for. **The server
 * decides what is in that payload** — an admin's valuation and spend are absent from a
 * Store Manager's response rather than sent and hidden, because a number that reaches the
 * browser has been disclosed whatever the template does with it. The `role` on the
 * response, not the client's own token, chooses the layout, so the two cannot disagree.
 */
@Component({
  selector: 'pb-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DashboardSkeletonComponent,
    ErrorStateComponent,
    IconComponent,
    PageHeaderComponent,
    AdminDashboardComponent,
    ManagerDashboardComponent,
    ...MATERIAL_CORE_IMPORTS,
  ],
  template: `
    <pb-page-header title="Dashboard" [subtitle]="subtitle()">
      <button
        slot="actions"
        matButton="outlined"
        type="button"
        [disabled]="loading()"
        (click)="load()"
      >
        <!-- Spins while a refresh is in flight, which is the only feedback the button gives on a
             fast connection — the label changes too, but a word swapping is easy to miss. -->
        <pb-icon name="refresh" [size]="16" class="mr-pb-1" [class.animate-spin]="loading()" />
        {{ loading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </pb-page-header>

    @if (loading() && data() === null) {
      <!-- A placeholder in the shape of the result, so arrival is a fill rather than a reflow. -->
      <pb-dashboard-skeleton />
    } @else if (error(); as failure) {
      <!--
        'text-on-error-container' was being used here without the container it names, so the message
        rendered as low-contrast pink text on a plain card. This is the shared error state instead,
        which owns the illustration, the tone and the retry.
      -->
      <pb-error-state
        title="Could not load the dashboard"
        [message]="failure.message"
        hint="Your figures are safe — this is only the view."
        (retry)="load()"
      />
    } @else if (data(); as dashboard) {
      @if (dashboard.role === adminRole) {
        <pb-admin-dashboard [data]="dashboard" />
      } @else {
        <pb-manager-dashboard [data]="dashboard" />
      }
    }
  `,
})
export class DashboardPage {
  private readonly service = inject(DashboardService);
  private readonly auth = inject(AuthService);

  protected readonly adminRole = Role.ADMIN;

  protected readonly data = signal<Dashboard | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<AppError | null>(null);

  protected readonly subtitle = computed(() => {
    const name = this.auth.user()?.firstName;
    const greeting = name === undefined ? 'Welcome back' : `Welcome back, ${name}`;
    const dashboard = this.data();

    return dashboard === null ? greeting : `${greeting} — figures for ${dashboard.forDate}`;
  });

  constructor() {
    this.load();
  }

  /**
   * Reloads without clearing what is on screen.
   *
   * The previous payload stays until the new one lands, so a refresh does not blank the
   * page and reflow every card — the spinner only takes over on the very first load.
   */
  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.service.load().subscribe({
      next: (dashboard) => {
        this.data.set(dashboard);
        this.loading.set(false);
      },
      error: (failure: AppError) => {
        this.error.set(failure);
        this.loading.set(false);
      },
    });
  }
}
