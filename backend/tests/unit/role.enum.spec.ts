import { describe, expect, it } from 'vitest';
import { ALL_ROLES, hasAtLeastRole, isRole, Role } from '../../src/core/domain/enums/role.enum.js';

describe('Role hierarchy', () => {
  it('treats a role as satisfying itself', () => {
    for (const role of ALL_ROLES) {
      expect(hasAtLeastRole(role, role)).toBe(true);
    }
  });

  it('lets Admin subsume Store Manager', () => {
    expect(hasAtLeastRole(Role.ADMIN, Role.STORE_MANAGER)).toBe(true);
  });

  it('does not let Store Manager satisfy Admin', () => {
    expect(hasAtLeastRole(Role.STORE_MANAGER, Role.ADMIN)).toBe(false);
  });

  it('rejects values that are not roles', () => {
    expect(isRole('ADMIN')).toBe(true);
    expect(isRole('STORE_MANAGER')).toBe(true);
    // Guards against trusting an arbitrary `role` claim from a JWT payload.
    expect(isRole('SUPERUSER')).toBe(false);
    expect(isRole('STAFF')).toBe(false);
    expect(isRole('admin')).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(null)).toBe(false);
    expect(isRole(3)).toBe(false);
  });
});
