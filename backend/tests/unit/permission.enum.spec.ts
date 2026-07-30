import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  Permission,
  permissionsForRole,
  roleHasAllPermissions,
  roleHasAnyPermission,
  roleHasPermission,
} from '../../src/core/domain/enums/permission.enum.js';
import { Role } from '../../src/core/domain/enums/role.enum.js';

/**
 * The access model is a security boundary, so it is asserted rather than assumed.
 * These tests are what stop a future permission from being granted to Store
 * Manager by accident.
 */
describe('Role permissions', () => {
  it('grants Admin every permission', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(roleHasPermission(Role.ADMIN, permission)).toBe(true);
    }
  });

  it('grants Store Manager strictly fewer permissions than Admin', () => {
    const manager = permissionsForRole(Role.STORE_MANAGER);
    const admin = permissionsForRole(Role.ADMIN);

    expect(manager.length).toBeGreaterThan(0);
    expect(manager.length).toBeLessThan(admin.length);
    // Every manager permission must be a real one, not a typo'd string.
    expect(manager.every((permission) => admin.includes(permission))).toBe(true);
  });

  it('lets Store Manager run day-to-day store operations', () => {
    for (const permission of [
      Permission.PRODUCT_READ,
      Permission.PRODUCT_CREATE,
      Permission.PRODUCT_UPDATE,
      Permission.STOCK_READ,
      Permission.STOCK_ADJUST,
      Permission.SUPPLIER_MANAGE,
      Permission.PURCHASE_ORDER_CREATE,
      Permission.REPORT_VIEW,
    ]) {
      expect(roleHasPermission(Role.STORE_MANAGER, permission)).toBe(true);
    }
  });

  it('withholds the sensitive permissions from Store Manager', () => {
    // These are the four areas where an unchecked mistake or a bad actor does
    // real damage: user administration, self-approval, untracked stock loss,
    // and financial visibility.
    for (const permission of [
      Permission.USER_READ,
      Permission.USER_CREATE,
      Permission.USER_UPDATE,
      Permission.USER_DELETE,
      Permission.USER_MANAGE_ROLES,
      Permission.AUDIT_READ,
      Permission.SETTINGS_UPDATE,
      Permission.PRODUCT_DELETE,
      Permission.STOCK_WRITE_OFF,
      Permission.PURCHASE_ORDER_APPROVE,
      Permission.REPORT_VIEW_FINANCIAL,
    ]) {
      expect(roleHasPermission(Role.STORE_MANAGER, permission)).toBe(false);
    }
  });

  it('requires all permissions for roleHasAllPermissions', () => {
    expect(
      roleHasAllPermissions(Role.STORE_MANAGER, [Permission.PRODUCT_READ, Permission.STOCK_READ]),
    ).toBe(true);

    // One missing permission is enough to deny.
    expect(
      roleHasAllPermissions(Role.STORE_MANAGER, [Permission.PRODUCT_READ, Permission.USER_CREATE]),
    ).toBe(false);
  });

  it('requires only one permission for roleHasAnyPermission', () => {
    expect(
      roleHasAnyPermission(Role.STORE_MANAGER, [Permission.USER_CREATE, Permission.PRODUCT_READ]),
    ).toBe(true);

    expect(
      roleHasAnyPermission(Role.STORE_MANAGER, [Permission.USER_CREATE, Permission.AUDIT_READ]),
    ).toBe(false);
  });

  it('has no duplicate permission values', () => {
    // A copy-paste duplicate would silently make two names one permission.
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('grants an empty requirement to anyone (vacuous truth)', () => {
    // Documents the behaviour so a route with no declared permission is not
    // mistaken for a locked one.
    expect(roleHasAllPermissions(Role.STORE_MANAGER, [])).toBe(true);
    expect(roleHasAnyPermission(Role.STORE_MANAGER, [])).toBe(false);
  });
});
