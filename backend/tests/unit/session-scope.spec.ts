import { describe, expect, it } from 'vitest';
import { Permission } from '../../src/core/domain/enums/permission.enum.js';
import { Role } from '../../src/core/domain/enums/role.enum.js';
import {
  isSessionScope,
  permissionsForSession,
  SessionScope,
  sessionHasAllPermissions,
  sessionHasAnyPermission,
} from '../../src/core/domain/enums/session-scope.enum.js';

/**
 * The till device is an administrator's account signed in for six months on a phone that lives on a
 * counter. Every guarantee that makes that acceptable is in this file: if a scope ever stops
 * narrowing, the shop's finances are one lost phone away from being readable, and nothing else in
 * the system would notice.
 */
describe('session scope', () => {
  it('narrows an administrator to taking orders and nothing else', () => {
    const granted = permissionsForSession(Role.ADMIN, SessionScope.POS);

    expect(granted).toEqual([Permission.POS_OPERATE]);
  });

  it.each([
    ['the day’s takings', Permission.POS_TAKINGS_READ],
    ['cancelling a paid order', Permission.POS_ORDER_CANCEL],
    ['reading every order', Permission.POS_ORDER_READ_ALL],
    ['unlimited discounts', Permission.POS_DISCOUNT_UNLIMITED],
    ['stock adjustments', Permission.STOCK_ADJUST],
    ['financial reporting', Permission.REPORT_VIEW_FINANCIAL],
    ['recording sales', Permission.SALE_RECORD],
    ['managing users', Permission.USER_MANAGE_ROLES],
  ])('refuses %s to a till session held by an admin', (_label, permission) => {
    expect(sessionHasAllPermissions(Role.ADMIN, SessionScope.POS, [permission])).toBe(false);
  });

  it('leaves a full session exactly as the role defines it', () => {
    expect(permissionsForSession(Role.ADMIN, SessionScope.FULL)).toEqual(
      permissionsForSession(Role.ADMIN),
    );
    expect(sessionHasAllPermissions(Role.ADMIN, SessionScope.FULL, [Permission.USER_DELETE])).toBe(
      true,
    );
  });

  it('treats a missing scope as full, so tokens issued before scopes existed still work', () => {
    expect(
      sessionHasAllPermissions(Role.ADMIN, undefined, [Permission.REPORT_VIEW_FINANCIAL]),
    ).toBe(true);
  });

  /**
   * The scope narrows; it never grants. A Store Manager does not hold `POS_TAKINGS_READ`, and being
   * on the till must not hand it to them — the intersection has to run in both directions.
   */
  it('cannot widen a role', () => {
    const managerOnTill = permissionsForSession(Role.STORE_MANAGER, SessionScope.POS);

    expect(managerOnTill).not.toContain(Permission.POS_TAKINGS_READ);
    expect(managerOnTill).toEqual([Permission.POS_OPERATE]);
  });

  it('still allows the one thing a counter exists to do', () => {
    expect(
      sessionHasAnyPermission(Role.STORE_MANAGER, SessionScope.POS, [Permission.POS_OPERATE]),
    ).toBe(true);
  });

  it('recognises only the two real scopes', () => {
    expect(isSessionScope('POS')).toBe(true);
    expect(isSessionScope('FULL')).toBe(true);
    expect(isSessionScope('ADMIN')).toBe(false);
    expect(isSessionScope(undefined)).toBe(false);
    expect(isSessionScope('')).toBe(false);
  });
});
