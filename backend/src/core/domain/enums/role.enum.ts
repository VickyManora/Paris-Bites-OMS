/**
 * Domain-owned copy of the role taxonomy.
 *
 * This deliberately does not re-export Prisma's generated `Role`. The domain must
 * not depend on the persistence layer; `UserPrismaMapper` bridges the two with an
 * exhaustive switch that stops compiling if they ever diverge.
 */
export const Role = {
  ADMIN: 'ADMIN',
  STORE_MANAGER: 'STORE_MANAGER',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const ALL_ROLES: readonly Role[] = [Role.ADMIN, Role.STORE_MANAGER];

/**
 * Privilege ordering. Higher numbers subsume lower ones, which lets a guard ask
 * "at least STORE_MANAGER" instead of enumerating every acceptable role — so
 * inserting a role between the two later does not silently exclude it.
 */
const ROLE_RANK: Readonly<Record<Role, number>> = {
  [Role.STORE_MANAGER]: 1,
  [Role.ADMIN]: 2,
};

export function hasAtLeastRole(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && Object.hasOwn(ROLE_RANK, value);
}

/** Human-readable labels for API responses and UI. */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  [Role.ADMIN]: 'Administrator',
  [Role.STORE_MANAGER]: 'Store Manager',
};
