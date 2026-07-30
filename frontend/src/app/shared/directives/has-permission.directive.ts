import { Directive, effect, inject, input, TemplateRef, ViewContainerRef } from '@angular/core';
import { AuthService } from '../../core/auth/services/auth.service';
import type { Permission } from '../../core/models/permission.model';

/**
 * Renders content only when the user holds the required permission(s).
 *
 * ```html
 * <button *pbHasPermission="'stock:adjust'">Adjust stock</button>
 * <button *pbHasPermission="['user:create', 'user:manage-roles']">Invite user</button>
 * <a *pbHasPermission="['product:delete', 'stock:write-off']; mode: 'any'">Danger zone</a>
 * ```
 *
 * Default `mode` is `all`, because the common case is a single permission and
 * requiring everything listed is the safer reading of an ambiguous declaration.
 *
 * This hides UI, it does not protect data — the bundle ships to the browser, so
 * the API authorises every action independently.
 */
@Directive({
  selector: '[pbHasPermission]',
})
export class HasPermissionDirective {
  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly auth = inject(AuthService);

  readonly pbHasPermission = input.required<Permission | readonly Permission[]>();
  readonly pbHasPermissionMode = input<'all' | 'any'>('all');

  private rendered: boolean | null = null;

  constructor() {
    // Re-evaluates when the signed-in user changes, so the UI follows a role
    // change without a reload.
    effect(() => {
      const required = this.pbHasPermission();
      const permissions = Array.isArray(required) ? required : [required as Permission];

      const permitted =
        this.auth.isAuthenticated() &&
        (this.pbHasPermissionMode() === 'any'
          ? this.auth.canAny(permissions)
          : this.auth.canAll(permissions));

      this.render(permitted);
    });
  }

  private render(permitted: boolean): void {
    // Guarded so an unrelated signal change does not tear down and rebuild the
    // view, which would reset component state and steal focus.
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
