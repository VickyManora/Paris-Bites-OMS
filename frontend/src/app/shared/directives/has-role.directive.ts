import { Directive, effect, inject, input, TemplateRef, ViewContainerRef } from '@angular/core';
import { AuthService } from '../../core/auth/services/auth.service';
import { hasAtLeastRole, type Role } from '../../core/models/role.model';

/**
 * Renders content only for the listed roles.
 *
 * ```html
 * <span *pbHasRole="['ADMIN']">Administrator tools</span>
 * <span *pbHasRole="[]; minimum: 'ADMIN'">At least admin</span>
 * ```
 *
 * Prefer `*pbHasPermission` for anything capability-based; this is for content
 * that is genuinely about *who* the user is rather than what they may do.
 */
@Directive({
  selector: '[pbHasRole]',
})
export class HasRoleDirective {
  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly auth = inject(AuthService);

  /** Roles allowed to see the content. Empty means "any authenticated user". */
  readonly pbHasRole = input.required<readonly Role[]>();

  /** Minimum privilege level, as an alternative to an explicit list. */
  readonly pbHasRoleMinimum = input<Role | undefined>(undefined);

  private rendered: boolean | null = null;

  constructor() {
    effect(() => {
      const currentRole = this.auth.role();
      const allowedRoles = this.pbHasRole();
      const minimum = this.pbHasRoleMinimum();

      const permitted =
        currentRole !== null &&
        (allowedRoles.length === 0 || allowedRoles.includes(currentRole)) &&
        (minimum === undefined || hasAtLeastRole(currentRole, minimum));

      this.render(permitted);
    });
  }

  private render(permitted: boolean): void {
    if (permitted === this.rendered) {
      return;
    }

    this.viewContainer.clear();

    if (permitted) {
      this.viewContainer.createEmbeddedView(this.templateRef);
    }

    this.rendered = permitted;
  }
}
