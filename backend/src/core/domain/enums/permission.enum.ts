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
   */
  POS_OPERATE: 'pos:operate',
  POS_ORDER_READ_ALL: 'pos:order-read-all',
  POS_ORDER_CANCEL: 'pos:order-cancel',
  POS_DISCOUNT_UNLIMITED: 'pos:discount-unlimited',

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
 * What a Store Manager may do: run the store day to day.
 *
 * They read and maintain products, move stock, deal with suppliers, raise purchase orders,
 * and request and receive stock transfers. They cannot manage user accounts, approve their
 * own purchase orders or transfers, write off stock, read the audit trail, or see financial
 * reporting — the places where an unchecked mistake or a bad actor does real damage.
 */
const STORE_MANAGER_PERMISSIONS: readonly Permission[] = [
  Permission.PRODUCT_READ,
  Permission.PRODUCT_CREATE,
  Permission.PRODUCT_UPDATE,

  Permission.STOCK_READ,
  Permission.STOCK_ADJUST,

  // Requests a transfer and confirms its arrival at the cart, but cannot approve it —
  // the same separation as purchase orders.
  Permission.TRANSFER_READ,
  Permission.TRANSFER_CREATE,
  Permission.TRANSFER_COMPLETE,

  Permission.SUPPLIER_READ,
  Permission.SUPPLIER_MANAGE,

  Permission.PURCHASE_ORDER_READ,
  Permission.PURCHASE_ORDER_CREATE,

  Permission.REPORT_VIEW,

  // The counter. Deliberately without POS_ORDER_READ_ALL, POS_ORDER_CANCEL or
  // POS_DISCOUNT_UNLIMITED: taking orders is their job, reversing them is not.
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
