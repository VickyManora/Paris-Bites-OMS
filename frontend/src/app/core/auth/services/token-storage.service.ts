import { Injectable, signal, type Signal } from '@angular/core';

/**
 * Holds the access token for the lifetime of the tab — in memory only.
 *
 * This is deliberate. A token in `localStorage` is readable by any script on the
 * origin, so one XSS bug becomes full account takeover; the token here dies with
 * the JS context. The cost is that a page reload has no token, which is fine
 * because the httpOnly refresh cookie survives and silently mints a new one.
 *
 * Signals rather than a plain field so the interceptor and guards read a
 * reactive value without a subscription.
 */
@Injectable({ providedIn: 'root' })
export class TokenStorageService {
  private readonly token = signal<string | null>(null);
  private readonly expiresAt = signal<Date | null>(null);

  readonly accessToken: Signal<string | null> = this.token.asReadonly();

  set(token: string, expiresAt: string | Date): void {
    this.token.set(token);
    this.expiresAt.set(expiresAt instanceof Date ? expiresAt : new Date(expiresAt));
  }

  clear(): void {
    this.token.set(null);
    this.expiresAt.set(null);
  }

  hasToken(): boolean {
    return this.token() !== null;
  }

  /** True when a token exists but is past (or at) its expiry. */
  isExpired(): boolean {
    const expiry = this.expiresAt();
    return expiry !== null && expiry.getTime() <= Date.now();
  }

  /**
   * True when the token expires within `leewayMs`. Lets the refresh flow run
   * ahead of expiry instead of reacting to a 401 mid-action.
   */
  expiresWithin(leewayMs: number): boolean {
    const expiry = this.expiresAt();
    return expiry !== null && expiry.getTime() - Date.now() <= leewayMs;
  }
}
