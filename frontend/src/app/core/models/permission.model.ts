/**
 * Mirrors `backend/src/core/domain/enums/permission.enum.ts`.
 *
 * The client does **not** derive permissions from the role — it uses the list the
 * server sent on `/auth/login` and `/auth/me`. Duplicating the role→permission
 * mapping here would create two sources of truth that silently disagree the
 * moment one is edited.
 *
 * These values exist only so route declarations and templates can name a
 * permission without a magic string.
 */
export const Permission = {
  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_MANAGE_ROLES: 'user:manage-roles',

  AUDIT_READ: 'audit:read',

  SETTINGS_READ: 'settings:read',
  SETTINGS_UPDATE: 'settings:update',

  PRODUCT_READ: 'product:read',
  PRODUCT_CREATE: 'product:create',
  PRODUCT_UPDATE: 'product:update',
  PRODUCT_DELETE: 'product:delete',

  STOCK_READ: 'stock:read',
  STOCK_ADJUST: 'stock:adjust',
  STOCK_WRITE_OFF: 'stock:write-off',

  TRANSFER_READ: 'transfer:read',
  TRANSFER_CREATE: 'transfer:create',
  TRANSFER_APPROVE: 'transfer:approve',
  TRANSFER_COMPLETE: 'transfer:complete',

  SUPPLIER_READ: 'supplier:read',
  SUPPLIER_MANAGE: 'supplier:manage',

  PURCHASE_ORDER_READ: 'purchase-order:read',
  PURCHASE_ORDER_CREATE: 'purchase-order:create',
  PURCHASE_ORDER_APPROVE: 'purchase-order:approve',

  /**
   * Point of sale. `POS_OPERATE` is the counter and a Store Manager holds it; the other
   * four are admin-only — see the backend permission enum for the reasoning.
   *
   * `POS_TAKINGS_READ` is not read by any guard here: the POS home screen renders the takings if
   * the response carries them, because the server is what withholds the numbers. It is mirrored so
   * this list stays a complete copy of the backend's.
   */
  POS_OPERATE: 'pos:operate',
  POS_ORDER_READ_ALL: 'pos:order-read-all',
  POS_ORDER_CANCEL: 'pos:order-cancel',
  POS_DISCOUNT_UNLIMITED: 'pos:discount-unlimited',
  POS_TAKINGS_READ: 'pos:takings-read',

  /** Both admin-only: revenue is financial data, and entry is reconciled by an admin. */
  SALE_READ: 'sale:read',
  SALE_RECORD: 'sale:record',

  REPORT_VIEW: 'report:view',
  REPORT_VIEW_FINANCIAL: 'report:view-financial',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];
