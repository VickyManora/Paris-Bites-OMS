import { Injectable } from '@angular/core';
import type { StorageKey } from '../constants/storage-keys';

/**
 * Typed, fail-safe wrapper over `localStorage`.
 *
 * Every operation is guarded: Safari private mode throws on write, storage can
 * be full, and a stale entry may no longer parse as the expected shape. A UI
 * preference is never worth crashing over, so failures degrade to the default.
 */
@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly available = this.detectAvailability();

  get<T>(key: StorageKey, fallback: T): T {
    if (!this.available) {
      return fallback;
    }

    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      // Corrupt or hand-edited value — drop it so it cannot fail again.
      this.remove(key);
      return fallback;
    }
  }

  set<T>(key: StorageKey, value: T): void {
    if (!this.available) {
      return;
    }

    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota exceeded or blocked; a lost preference is acceptable.
    }
  }

  remove(key: StorageKey): void {
    if (!this.available) {
      return;
    }

    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore.
    }
  }

  /** Probes with a real write — merely checking for the object is not enough. */
  private detectAvailability(): boolean {
    try {
      const probe = '__pb_probe__';
      localStorage.setItem(probe, probe);
      localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  }
}
