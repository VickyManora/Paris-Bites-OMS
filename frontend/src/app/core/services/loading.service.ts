import { computed, Injectable, signal, type Signal } from '@angular/core';

/**
 * Tracks how many HTTP requests are in flight so a single progress bar can
 * reflect global activity.
 *
 * A counter rather than a boolean: with a boolean, two concurrent requests would
 * hide the indicator as soon as the first one finished.
 */
@Injectable({ providedIn: 'root' })
export class LoadingService {
  private readonly pendingCount = signal(0);

  readonly isLoading: Signal<boolean> = computed(() => this.pendingCount() > 0);
  readonly pending: Signal<number> = this.pendingCount.asReadonly();

  start(): void {
    this.pendingCount.update((count) => count + 1);
  }

  stop(): void {
    // Clamped at zero so an unbalanced stop cannot latch the bar off.
    this.pendingCount.update((count) => Math.max(0, count - 1));
  }

  /** Escape hatch for route changes that abandon in-flight requests. */
  reset(): void {
    this.pendingCount.set(0);
  }
}
