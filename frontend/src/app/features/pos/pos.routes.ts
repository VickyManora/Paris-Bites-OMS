import type { Routes } from '@angular/router';
import { withBreadcrumb } from '../../core/services/breadcrumb.service';

/**
 * POS routes. The permission gate lives on the parent in `app.routes.ts`.
 *
 * Three screens rather than one: the home screen is a launchpad, the order screen is
 * full-bleed and wants the whole viewport, and the history is an ordinary list. Making them
 * one component would mean the order screen carried the history's imports.
 */
export const posRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Point of sale · Paris Bites',
    data: withBreadcrumb('Point of sale'),
    loadComponent: () => import('./pages/pos-home/pos-home.page').then((m) => m.PosHomePage),
  },
  {
    path: 'new',
    title: 'New order · Paris Bites',
    data: withBreadcrumb('New order'),
    loadComponent: () => import('./pages/new-order/new-order.page').then((m) => m.NewOrderPage),
  },
  {
    path: 'orders',
    title: 'Orders · Paris Bites',
    data: withBreadcrumb('Orders'),
    loadComponent: () => import('./pages/pos-orders/pos-orders.page').then((m) => m.PosOrdersPage),
  },
];
