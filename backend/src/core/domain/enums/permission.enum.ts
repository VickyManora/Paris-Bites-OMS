import { Role } from './role.enum.js';

/**
 * The complete set of things a caller can be permitted to do.
 *
 * Authorization is expressed in permissions rather than roles because roles
 * change: the day a third role appears, every `if (role === ADMIN)` scattered
 * through the codebase becomes a bug, while a permission check keeps working.
 * Routes declare the permission they need; this file decides who holds it.
 *
 * Naming is `<resource>:<action>`.
 */
export const Permission = {
  // --- Users & access control -------------------------------------------------
  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  /** Change someone else's role — privilege escalation, so admin-only. */
  USER_MANAGE_ROLES: 'user:manage-roles',

  // --- Auditing --------------------------------------------------------------
  AUDIT_READ: 'audit:read',

  // --- Settings --------------------------------------------------------------
  SETTINGS_READ: 'settings:read',
  SETTINGS_UPDATE: 'settings:update',

  // --- Inventory (permissions defined ahead of the features that use them, so
  //     the access model is decided once rather than per-feature) --------------
  PRODUCT_READ: 'product:read',
  PRODUCT_CREATE: 'product:create',
  PRODUCT_UPDATE: 'product:update',
  PRODUCT_DELETE: 'product:delete',

  STOCK_READ: 'stock:read',
  /** Record a normal movement: goods in, goods out. */
  STOCK_ADJUST: 'stock:adjust',
  /** Correct the ledger after a mistake or write off waste. Admin-only, because
   *  it can make physical and recorded stock agree without an explanation. */
  STOCK_WRITE_OFF: 'stock:write-off',

  // --- Stock transfers -------------------------------------------------------
  TRANSFER_READ: 'transfer:read',
  /** Raise a transfer request. No stock moves until it is approved. */
  TRANSFER_CREATE: 'transfer:create',
  /**
   * Approve or reject a transfer. Admin-only: approval is the control point that actually
   * moves stock out of the warehouse, so the person requesting it should not also be the
   * person authorising it.
   */
  TRANSFER_APPROVE: 'transfer:approve',
  /** Confirm receipt at the destination. The person running the cart does this. */
  TRANSFER_COMPLETE: 'transfer:complete',

  SUPPLIER_READ: 'supplier:read',
  SUPPLIER_MANAGE: 'supplier:manage',

  PURCHASE_ORDER_READ: 'purchase-order:read',
  PURCHASE_ORDER_CREATE: 'purchase-order:create',
  /** Committing money to a supplier. Admin-only. */
  PURCHASE_ORDER_APPROVE: 'purchase-order:approve',

  /**
   * Point of sale.
   *
   * `POS_OPERATE` is the counter itself — take an order, receive payment. A Store Manager
   * holds it; it is the one thing on this list they use every day.
   *
   * The rest are the checks around it:
   *
   * - `POS_ORDER_READ_ALL` — see other people's orders and every past day. Without it a
   *   user sees today's orders only, which is what the person on the counter needs and all
   *   they need.
   * - `POS_ORDER_CANCEL` — void a paid order. Admin-only: it makes money disappear from the
   *   day's takings, and the person who took the payment should not be the one who can
   *   quietly reverse it.
   * - `POS_DISCOUNT_UNLIMITED` — discount past the Store Manager ceiling. Held by admins;
   *   the ceiling itself lives in the use case so both roles go through one rule.
   * - `POS_TAKINGS_READ` — the day's takings as a total: revenue, average order value, and the
   *   cash/digital split. Admin-only, for the same reason `SALE_READ` is: a day's takings are
   *   financial data, and totalling them is a reconciliation task rather than a counter one.
   *   Withholding it does **not** touch the counter's own job — an order's total, the amount
   *   tendered and what is still owed all remain visible, because a cashier cannot take payment
   *   without them. What goes is the aggregate at the top of the POS home screen.
   */
  POS_OPERATE: 'pos:operate',
  POS_ORDER_READ_ALL: 'pos:order-read-all',
  POS_ORDER_CANCEL: 'pos:order-cancel',
  POS_DISCOUNT_UNLIMITED: 'pos:discount-unlimited',
  POS_TAKINGS_READ: 'pos:takings-read',

  /**
   * Daily sales figures.
   *
   * Both are withheld from Store Manager, deliberately. Revenue is financial data, and
   * the same reasoning that keeps `REPORT_VIEW_FINANCIAL` admin-only applies here — plus
   * the entry itself is an admin task: the takings are reconciled against a bank
   * statement and the aggregator dashboards, neither of which a manager holds.
   */
  SALE_READ: 'sale:read',
  SALE_RECORD: 'sale:record',

  REPORT_VIEW: 'report:view',
  /** Financial reporting — margins, stock valuation. */
  REPORT_VIEW_FINANCIAL: 'report:view-financial',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(Permission);

/**
 * What a Store Manager may do: run the cart, shift to shift.
 *
 * The role is scoped to the four things the person on the cart actually does — sell at the
 * counter, keep the cart's stock straight, record what was used, and ask the warehouse for
 * more. Everything else is withheld.
 *
 * ## Buying and reporting are deliberately not here
 *
 * `SUPPLIER_*`, `PURCHASE_ORDER_*` and `REPORT_VIEW` were all granted to this role
 * originally, on a reading of "store manager" as someone who runs a shop end to end
 * including its buying. That is not this role: the cart is supplied by the warehouse through
 * stock transfers, not by its own purchase orders, so supplier and invoice screens were
 * capability the person on the counter never used and could still be talked into using.
 *
 * `REPORT_VIEW` is withheld for the narrower reason that a report aggregates across
 * locations and dates. `REPORT_VIEW_FINANCIAL` already kept margins and valuation out, but
 * the non-financial reports still answer questions about the business rather than about
 * today's cart, and this role is scoped to the latter.
 *
 * What remains withheld for the original reasons: user administration, self-approval of
 * transfers, stock write-offs, the audit trail, and anything financial — the places where an
 * unchecked mistake or a bad actor does real damage.
 *
 * Removing a permission from this list is safe by construction. Routes declare what they
 * need and the sidebar is gated on the same permissions, so dropping one closes the API, the
 * direct URL and the menu entry together; there is no fourth place to remember.
 */
const STORE_MANAGER_PERMISSIONS: readonly Permission[] = [
  Permission.PRODUCT_READ,
  Permission.PRODUCT_CREATE,
  Permission.PRODUCT_UPDATE,

  Permission.STOCK_READ,
  Permission.STOCK_ADJUST,

  // Requests a transfer and confirms its arrival at the cart, but cannot approve it: the
  // request and the authorisation must not be the same person.
  Permission.TRANSFER_READ,
  Permission.TRANSFER_CREATE,
  Permission.TRANSFER_COMPLETE,

  // The counter. Deliberately without POS_ORDER_READ_ALL, POS_ORDER_CANCEL,
  // POS_DISCOUNT_UNLIMITED or POS_TAKINGS_READ: taking orders is their job, reversing them is
  // not, and the day's takings as a total are financial data they have no task for.
  Permission.POS_OPERATE,

  Permission.SETTINGS_READ,
];

/**
 * Role → permissions.
 *
 * ADMIN is granted `ALL_PERMISSIONS` by construction rather than by an
 * enumerated list, so a newly added permission is automatically available to
 * admins and must be *explicitly* granted to anyone else. That default is the
 * safe direction: forgetting to list a permission restricts, never escalates.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  [Role.ADMIN]: ALL_PERMISSIONS,
  [Role.STORE_MANAGER]: STORE_MANAGER_PERMISSIONS,
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** True when the role holds every one of `permissions`. */
export function roleHasAllPermissions(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.every((permission) => roleHasPermission(role, permission));
}

/** True when the role holds at least one of `permissions`. */
export function roleHasAnyPermission(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => roleHasPermission(role, permission));
}
