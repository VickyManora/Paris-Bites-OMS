import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AppRoutes } from '../../constants/app.constants';
import { AuthService } from '../services/auth.service';

/**
 * Blocks unauthenticated access.
 *
 * Functional guard rather than a class: it composes with `inject()`, needs no
 * `providedIn`, and tree-shakes when unused.
 *
 * The attempted URL is preserved as `returnUrl` so the user lands where they were
 * headed after signing in, instead of on a generic dashboard.
 *
 * ## The session may still be arriving, and that is not the same as absent
 *
 * The app no longer waits for `/auth/refresh` before it paints — on a sleeping API that meant a
 * blank screen for the length of a cold start, about a minute. So this guard can now run *while*
 * the session is being restored, and the old "no user in memory yet, go to the login page" reading
 * would send a signed-in cashier to a form whose submit button needs the same sleeping API.
 *
 * When this browser is known to have had a session (`hadSession` — a flag, not a credential) and
 * the restore is still in flight, the route is allowed through. Two things make that safe:
 *
 * - **The server decides, not this function.** Every request carries a token the server issued and
 *   is authorised there. A guard that admits optimistically changes what is *rendered*, never what
 *   is *returned* — a page opened this way without a valid session shows empty state and 401s,
 *   which is the same outcome as any session that expires mid-shift.
 * - **It is self-correcting.** `restoreSession` clears the hint when the refresh fails, and the
 *   error interceptor bounces to the login page on a 401. The optimism lasts exactly as long as the
 *   uncertainty does.
 *
 * What it buys is the point of the change: the counter opens on the order screen, with the cached
 * menu already on it, instead of on a login form nobody can submit yet.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isSignedInOrRestoring()) {
    return true;
  }

  return router.createUrlTree([AppRoutes.login], {
    queryParams: { returnUrl: state.url },
  });
};
