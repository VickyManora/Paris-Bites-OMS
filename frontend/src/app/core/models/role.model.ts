/**
 * Mirrors `backend/src/core/domain/enums/role.enum.ts`.
 *
 * A const object rather than a TS `enum`: it works under `isolatedModules`,
 * erases to a plain object, and the derived union is what guards and route data
 * actually consume.
 */
export const Role = {
  ADMIN: 'ADMIN',
  STORE_MANAGER: 'STORE_MANAGER',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const ALL_ROLES: readonly Role[] = [Role.ADMIN, Role.STORE_MANAGER];

const ROLE_RANK: Readonly<Record<Role, number>> = {
  [Role.STORE_MANAGER]: 1,
  [Role.ADMIN]: 2,
};

/** True when `actual` meets or exceeds the `required` privilege level. */
export function hasAtLeastRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && Object.hasOwn(ROLE_RANK, value);
}

/** Labels for menus, chips and the account menu. */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  [Role.ADMIN]: 'Administrator',
  [Role.STORE_MANAGER]: 'Store Manager',
};
