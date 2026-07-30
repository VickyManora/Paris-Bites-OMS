import type { Routes } from '@angular/router';
import { authGuard } from './core/auth/guards/auth.guard';
import { guestGuard } from './core/auth/guards/guest.guard';
import { permissionGuard, withAccess } from './core/auth/guards/permission.guard';
import { Permission } from './core/models/permission.model';

/**
 * Root route table.
 *
 * Every feature is lazy loaded, so a page the user never visits costs them
 * nothing. Layouts are parent routes rather than part of each page, which keeps
 * the sidebar mounted across navigations instead of rebuilding it each time.
 *
 * Guards compose left to right: `authGuard` first (it owns the unauthenticated
 * redirect and preserves the return URL), then any permission guard a child adds.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard',
  },

  /** Unauthenticated area. */
  {
    path: 'auth',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./layouts/auth-layout/auth-layout.component').then((m) => m.AuthLayoutComponent),
    loadChildren: () => import('./features/auth/auth.routes').then((m) => m.authRoutes),
  },

  /** Authenticated area. */
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./layouts/main-layout/main-layout.component').then((m) => m.MainLayoutComponent),
    children: [
      {
        path: 'dashboard',
        loadChildren: () =>
          import('./features/dashboard/dashboard.routes').then((m) => m.dashboardRoutes),
      },
      {
        path: 'account',
        loadChildren: () =>
          import('./features/account/account.routes').then((m) => m.accountRoutes),
      },
      {
        path: 'inventory',
        // Gated on the parent so every child inherits it. The API enforces the same
        // permission per endpoint — this only decides what the UI offers.
        canActivate: [permissionGuard],
        data: withAccess({ permissions: [Permission.PRODUCT_READ] }),
        loadChildren: () =>
          import('./features/inventory/inventory.routes').then((m) => m.inventoryRoutes),
      },

      {
        path: 'transfers',
        canActivate: [permissionGuard],
        data: withAccess({ permissions: [Permission.TRANSFER_READ] }),
        loadChildren: () =>
          import('./features/transfers/transfers.routes').then((m) => m.transfersRoutes),
      },

      {
        path: 'consumption',
        // Read-level gate. Recording and editing need `STOCK_ADJUST` and voiding needs
        // `STOCK_WRITE_OFF`; the API enforces both, and the UI hides the buttons.
        canActivate: [permissionGuard],
        data: withAccess({ permissions: [Permission.STOCK_READ] }),
        loadChildren: () =>
          import('./features/consumption/consumption.routes').then((m) => m.consumptionRoutes),
      },

      {
        path: 'purchases',
        // Read-level gate only. Recording a bill needs `PURCHASE_ORDER_CREATE`, which the
        // `record` child adds for itself — a viewer may reach the history but not the form.
        canActivate: [permissionGuard],
        data: withAccess({ permissions: [Permission.PURCHASE_ORDER_READ] }),
        loadChildren: () =>
          import('./features/purchases/purchases.routes').then((m) => m.purchasesRoutes),
      },

      {
        path: 'suppliers',
        canActivate: [permissionGuard],
        data: withAccess({ permissions: [Permission.SUPPLIER_READ] }),
        loadChildren: () =>
          import('./features/suppliers/suppliers.routes').then((m) => m.suppliersRoutes),
      },

      {
        path: 'pos',
        // `POS_OPERATE` — the counter. Both roles hold it; what each may *see* is scoped
        // inside the use cases rather than by a second route.
        canActivate: [permissionGuard],
        data: withAccess({ permissions: [Permission.POS_OPERATE] }),
        loadChildren: () => import('./features/pos/pos.routes').then((m) => m.posRoutes),
      },

      {
        path: 'sales',
        // Admin-only, matching the API: revenue is financial data, and the entry itself
        // is reconciled against a bank statement and the aggregator dashboards.
        canActivate: [permissionGuard],
        data: withAccess({ permissions: [Permission.SALE_READ] }),
        loadChildren: () => import('./features/sales/sales.routes').then((m) => m.salesRoutes),
      },

      {
        path: 'notifications',
        // No permission gate: an inbox is owned, not shared. The API scopes every query
        // to the verified token, so there is nothing here a permission could usefully
        // guard — see `notifications.routes.ts`.
        loadChildren: () =>
          import('./features/notifications/notifications.routes').then(
            (m) => m.notificationsRoutes,
          ),
      },

      {
        path: 'analytics',
        // Admin-only, matching the API. The page is built around revenue, stock valuation
        // and food cost; projecting it per figure would leave a manager with two tiles and
        // four empty charts, which is a worse answer than withholding it whole.
        canActivate: [permissionGuard],
        data: withAccess({ permissions: [Permission.REPORT_VIEW_FINANCIAL] }),
        loadChildren: () =>
          import('./features/analytics/analytics.routes').then((m) => m.analyticsRoutes),
      },

      {
        path: 'reports',
        // `REPORT_VIEW` only. The purchase report additionally needs
        // `REPORT_VIEW_FINANCIAL`, which the API enforces per report — and the picker is
        // built from what the API says the caller may run, so it is never offered.
        canActivate: [permissionGuard],
        data: withAccess({ permissions: [Permission.REPORT_VIEW] }),
        loadChildren: () =>
          import('./features/reports/reports.routes').then((m) => m.reportsRoutes),
      },

      /*
       * Living reference for the design system.
       *
       * Inside the authenticated shell so it renders against the real theme, topbar and sidebar —
       * a token gallery on a bare page would not show how these components sit in the app.
       *
       * Deliberately **not** in the sidebar. It is a reference for whoever is building the UI, not
       * a feature of the product, and a nav entry to it would be the only link in there that does
       * not do anything for the business. Reachable at /design-system.
       *
       * No permission guard: it renders static sample data and reaches no API.
       */
      {
        path: 'design-system',
        title: 'Design system · Paris Bites',
        loadComponent: () =>
          import('./features/design-system/design-system.page').then((m) => m.DesignSystemPage),
      },

      // Further features follow the same shape: `permissionGuard` + `withAccess`, a
      // `withBreadcrumb` on the child, and a nav entry in the sidebar.
    ],
  },

  {
    path: 'forbidden',
    title: 'Access denied · Paris Bites',
    loadComponent: () => import('./features/errors/forbidden.page').then((m) => m.ForbiddenPage),
  },

  /** Wildcard must stay last — it matches anything the routes above did not. */
  {
    path: '**',
    title: 'Page not found · Paris Bites',
    loadComponent: () => import('./features/errors/not-found.page').then((m) => m.NotFoundPage),
  },
];
