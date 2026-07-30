/**
 * Actions worth a permanent record.
 *
 * Authentication events are here because they are what an investigation starts
 * from: who signed in, from where, and which attempts failed.
 */
export const AuditAction = {
  LOGIN_SUCCEEDED: 'auth.login.succeeded',
  LOGIN_FAILED: 'auth.login.failed',
  LOGOUT: 'auth.logout',
  TOKEN_REFRESHED: 'auth.token.refreshed',
  /** A revoked or already-rotated refresh token was presented — see below. */
  TOKEN_REUSE_DETECTED: 'auth.token.reuse-detected',
  PASSWORD_CHANGED: 'auth.password.changed',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface CreateAuditLogData {
  /** Null when the actor could not be identified, e.g. a failed login. */
  readonly actorId: string | null;
  /**
   * Typed to `string` rather than the `AuditAction` union: the column is open so
   * future features can record their own actions without editing this file.
   * Prefer an `AuditAction` constant wherever one exists.
   */
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string | undefined;
  /** Must never contain a password, token, or digest. */
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly ip?: string | undefined;
}

/**
 * Append-only audit trail. There is deliberately no update or delete method:
 * a trail that can be rewritten is not evidence of anything.
 */
export interface IAuditLogRepository {
  record(data: CreateAuditLogData): Promise<void>;
}
