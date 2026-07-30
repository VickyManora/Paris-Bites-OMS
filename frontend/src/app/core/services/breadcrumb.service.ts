import { inject, Injectable, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, type ActivatedRouteSnapshot, type Route } from '@angular/router';
import { filter, map, startWith } from 'rxjs';

export interface Breadcrumb {
  readonly label: string;
  /** Absolute URL, or null for the final (current) crumb, which is not a link. */
  readonly url: string | null;
}

/** Shape a route uses to contribute a crumb. */
export interface BreadcrumbRouteData {
  /**
   * Static label, or a function of the route's own resolved data — the latter is
   * what lets a detail page show "Chocolate Éclair" instead of an id.
   */
  readonly breadcrumb?: string | ((data: Record<string, unknown>) => string);
}

/**
 * Type-checked helper for declaring a crumb on a route.
 *
 * Returns `NonNullable<Route['data']>` rather than `Route['data']`: the latter
 * includes `undefined`, which `exactOptionalPropertyTypes` refuses to assign to the
 * optional `data` property.
 */
export function withBreadcrumb(
  breadcrumb: NonNullable<BreadcrumbRouteData['breadcrumb']>,
): NonNullable<Route['data']> {
  return { breadcrumb };
}

/**
 * Derives the breadcrumb trail from the active route tree.
 *
 * Routes declare their own label via `data.breadcrumb`, so the trail is a
 * consequence of the route configuration rather than something each page has to
 * remember to set. A page that forgets simply contributes no crumb, which
 * degrades gracefully instead of showing a wrong path.
 */
@Injectable({ providedIn: 'root' })
export class BreadcrumbService {
  private readonly router = inject(Router);

  /**
   * `startWith` emits for the current URL too: without it the trail would be
   * empty until the first navigation *after* the service is created, so a
   * hard-loaded page would show nothing.
   */
  readonly breadcrumbs: Signal<readonly Breadcrumb[]> = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      startWith(null),
      map(() => this.build(this.router.routerState.snapshot.root)),
    ),
    { initialValue: [] },
  );

  /**
   * Walks the snapshot tree accumulating URL segments, collecting a crumb
   * wherever a route declares one.
   *
   * Segments accumulate across *every* route, including layout routes with an
   * empty path and no label, so a child's URL stays correct even when its
   * ancestors contribute no crumb of their own.
   */
  private build(root: ActivatedRouteSnapshot): readonly Breadcrumb[] {
    const crumbs: Breadcrumb[] = [];
    let url = '';
    let node: ActivatedRouteSnapshot | null = root;

    while (node !== null) {
      const segment = node.url.map((part) => part.path).join('/');

      if (segment.length > 0) {
        url += `/${segment}`;
      }

      const label = this.labelOf(node);

      if (label !== null) {
        crumbs.push({ label, url });
      }

      node = node.firstChild;
    }

    // The last crumb is where the user already is, so it is plain text rather
    // than a link to the current page.
    return crumbs.map((crumb, index) =>
      index === crumbs.length - 1 ? { ...crumb, url: null } : crumb,
    );
  }

  private labelOf(snapshot: ActivatedRouteSnapshot): string | null {
    const declared = (snapshot.data as BreadcrumbRouteData).breadcrumb;

    if (declared === undefined) {
      return null;
    }

    if (typeof declared === 'function') {
      // `Data` is already an index signature, so it satisfies the callback's
      // parameter type without a cast.
      return declared(snapshot.data);
    }

    return declared;
  }
}
