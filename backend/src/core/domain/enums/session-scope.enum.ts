import { Permission, permissionsForRole } from './permission.enum.js';
import type { Role } from './role.enum.js';

/**
 * What a *session* may do, as opposed to what its user may do.
 *
 * Authorisation in this system has always been one question — what does this role permit — and that
 * is the right question for a person at a desk. It is the wrong question for a phone propped at a
 * counter, which is signed in permanently and could be picked up by anyone in the shop.
 *
 * A scope is the second half of the answer. The effective permissions of a request are the
 * **intersection** of the two: what the user could do, narrowed by what this particular sign-in was
 * granted. The user's own role never widens a scope, and the scope never widens a role.
 *
 * - `FULL` — an ordinary sign-in. The session may do whatever the role may do, which is the
 *   behaviour every existing session has and continues to have.
 * - `POS` — the till device. Sunil's own account, signed in for six months on the shop phone, able
 *   to take orders and nothing else. If that phone is lost, what is lost with it is the ability to
 *   ring up a waffle: not the day's takings, not the inventory, not the supplier invoices, and not
 *   the ability to cancel a paid order.
 *
 * That last sentence is the entire justification for the concept. A long-lived session is a
 * standing risk, and the only honest way to run one is to make the thing it can do small enough
 * that standing behind it is comfortable.
 */
export const SessionScope = {
  FULL: 'FULL',
  POS: 'POS',
} as const;

export type SessionScope = (typeof SessionScope)[keyof typeof SessionScope];

/**
 * What each scope allows, before the role is taken into account.
 *
 * `FULL` is deliberately absent rather than listed as "everything": a scope that enumerates every
 * permission would have to be edited every time a permission is added, and forgetting would quietly
 * restrict admins. Absence means "do not narrow", which is the safe default in the *other*
 * direction — a new permission is available to a full session and withheld from a till until
 * someone decides otherwise.
 */
const SCOPE_ALLOWANCE: Partial<Record<SessionScope, readonly Permission[]>> = {
  [SessionScope.POS]: [Permission.POS_OPERATE],
};

export function isSessionScope(value: unknown): value is SessionScope {
  return value === SessionScope.FULL || value === SessionScope.POS;
}

/**
 * The effective permissions of a session: the role's, narrowed by the scope's.
 *
 * Every authorisation check goes through this rather than through `permissionsForRole`, so a scope
 * cannot be forgotten at a call site — which is the failure mode that would make the whole idea
 * worthless, since the one that forgets is the one an attacker finds.
 */
export function permissionsForSession(
  role: Role,
  scope: SessionScope = SessionScope.FULL,
): readonly Permission[] {
  const rolePermissions = permissionsForRole(role);
  const allowance = SCOPE_ALLOWANCE[scope];

  return allowance === undefined
    ? rolePermissions
    : rolePermissions.filter((permission) => allowance.includes(permission));
}

export function sessionHasAllPermissions(
  role: Role,
  scope: SessionScope | undefined,
  permissions: readonly Permission[],
): boolean {
  const granted = permissionsForSession(role, scope);
  return permissions.every((permission) => granted.includes(permission));
}

export function sessionHasAnyPermission(
  role: Role,
  scope: SessionScope | undefined,
  permissions: readonly Permission[],
): boolean {
  const granted = permissionsForSession(role, scope);
  return permissions.some((permission) => granted.includes(permission));
}
