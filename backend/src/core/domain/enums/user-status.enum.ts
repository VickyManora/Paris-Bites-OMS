export const UserStatus = {
  ACTIVE: 'ACTIVE',
  INVITED: 'INVITED',
  SUSPENDED: 'SUSPENDED',
} as const;

export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/** Only ACTIVE accounts may authenticate. */
export function canAuthenticate(status: UserStatus): boolean {
  return status === UserStatus.ACTIVE;
}
