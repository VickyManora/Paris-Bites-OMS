import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../../core/auth/services/auth.service';
import { AppRoutes } from '../../../../core/constants/app.constants';
import { ROLE_LABELS } from '../../../../core/models/role.model';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import { MATERIAL_CORE_IMPORTS } from '../../../../shared/material/material-imports';
import { InitialsPipe } from '../../../../shared/pipes/initials.pipe';

/**
 * Read-only user profile.
 *
 * Editing is not implemented — that needs a `PATCH /auth/me` endpoint and is
 * business logic. The page shows what the API already returns, including the
 * permissions the role grants, which makes the access model visible to the user
 * rather than something they discover by hitting a 403.
 */
@Component({
  selector: 'pb-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    CardComponent,
    PageHeaderComponent,
    SpinnerComponent,
    InitialsPipe,
    ...MATERIAL_CORE_IMPORTS,
  ],
  template: `
    <div class="flex flex-col gap-6">
      <pb-page-header title="My profile" subtitle="Your account details and access level">
        <a slot="actions" matButton="outlined" [routerLink]="changePasswordRoute">
          <mat-icon>password</mat-icon>
          Change password
        </a>
      </pb-page-header>

      @if (auth.user(); as user) {
        <!-- Single column on mobile; identity beside details from 'lg' up. -->
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <pb-card class="lg:col-span-1">
            <div class="flex flex-col items-center gap-3 py-2 text-center">
              <span
                class="text-pb-heading flex h-20 w-20 items-center justify-center rounded-full bg-primary text-on-primary"
                aria-hidden="true"
              >
                {{ user.fullName | pbInitials }}
              </span>

              <div class="min-w-0">
                <p class="text-pb-title truncate">{{ user.fullName }}</p>
                <p class="text-pb-caption truncate text-on-surface-variant">{{ user.email }}</p>
              </div>

              <span class="pb-badge pb-badge-pill pb-tone-neutral">{{
                roleLabels[user.role]
              }}</span>
            </div>
          </pb-card>

          <pb-card title="Account details" icon="badge" class="lg:col-span-2">
            <!-- A description list, not a table: this is label/value pairs about a
                 single subject, which is exactly what <dl> means. -->
            <dl class="m-0 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
              @for (field of details(); track field.label) {
                <div class="min-w-0">
                  <dt class="text-pb-caption text-on-surface-variant">{{ field.label }}</dt>
                  <dd class="text-pb-body m-0 mt-0.5 truncate">{{ field.value }}</dd>
                </div>
              }
            </dl>
          </pb-card>

          <pb-card
            title="Permissions"
            [subtitle]="permissionCountLabel()"
            icon="key"
            class="lg:col-span-3"
          >
            <ul class="flex flex-wrap gap-2 pl-0 list-none">
              @for (permission of user.permissions; track permission) {
                <li
                  class="text-pb-caption rounded-full border border-outline-variant bg-surface-container px-2.5 py-1"
                >
                  {{ permission }}
                </li>
              }
            </ul>

            <p class="text-pb-caption mt-4 text-on-surface-variant">
              Permissions come from your role and are enforced by the API on every request. Contact
              an administrator if you need additional access.
            </p>
          </pb-card>
        </div>
      } @else {
        <!-- Only reachable in the moment between navigation and session restore. -->
        <pb-spinner size="lg" label="Loading your profile…" [showLabel]="true" />
      }
    </div>
  `,
})
export class ProfilePage {
  protected readonly auth = inject(AuthService);
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly changePasswordRoute = AppRoutes.changePassword;

  private readonly datePipe = new DatePipe('en-GB');

  protected readonly details = computed(() => {
    const user = this.auth.user();

    if (user === null) {
      return [];
    }

    return [
      { label: 'First name', value: user.firstName },
      { label: 'Last name', value: user.lastName },
      { label: 'Email', value: user.email },
      { label: 'Role', value: ROLE_LABELS[user.role] },
      { label: 'Status', value: user.status },
      {
        label: 'Last sign-in',
        value:
          user.lastLoginAt === null
            ? 'This is your first session'
            : (this.datePipe.transform(user.lastLoginAt, 'd MMM y, HH:mm') ?? '—'),
      },
    ];
  });

  protected readonly permissionCountLabel = computed(() => {
    const count = this.auth.user()?.permissions.length ?? 0;
    return `${count} granted by your role`;
  });
}
