import { computed, Injectable, signal, type Signal } from '@angular/core';

/**
 * How long work must run before the UI stops being silent about it.
 *
 * `SLOW` is "long enough that a person wonders whether the tap registered". `WAKING` is long
 * enough that the only realistic explanation is the API waking up: the free instance it runs on
 * sleeps after fifteen idle minutes and takes tens of seconds to come back, so the first request
 * after a quiet spell is slow in a way no later one is. Saying so is the difference between a wait
 * that looks broken and a wait that looks explained.
 *
 * `WAKING` deliberately sits well past any healthy response. Naming a sleeping server while the
 * database is merely being slow would be a confident wrong answer.
 */
const SLOW_AFTER_MS = 4_000;
const WAKING_AFTER_MS = 12_000;

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
  private readonly slow = signal(false);
  private readonly waking = signal(false);

  private timers: ReturnType<typeof setTimeout>[] = [];

  readonly isLoading: Signal<boolean> = computed(() => this.pendingCount() > 0);
  readonly pending: Signal<number> = this.pendingCount.asReadonly();

  /** Something has been in flight longer than a person will wait quietly. */
  readonly isSlow: Signal<boolean> = this.slow.asReadonly();

  /** Long enough that the API is almost certainly still waking up. */
  readonly isWaking: Signal<boolean> = this.waking.asReadonly();

  start(): void {
    this.pendingCount.update((count) => count + 1);

    /*
     * Timed from the first request of a burst, not the most recent one, so a page that fires four
     * calls in sequence is judged on how long the *user* has been waiting rather than resetting
     * the clock on every hop.
     */
    if (this.timers.length === 0) {
      this.timers = [
        setTimeout(() => this.slow.set(true), SLOW_AFTER_MS),
        setTimeout(() => this.waking.set(true), WAKING_AFTER_MS),
      ];
    }
  }

  stop(): void {
    // Clamped at zero so an unbalanced stop cannot latch the bar off.
    this.pendingCount.update((count) => Math.max(0, count - 1));

    if (this.pendingCount() === 0) {
      this.clearSlowState();
    }
  }

  /** Escape hatch for route changes that abandon in-flight requests. */
  reset(): void {
    this.pendingCount.set(0);
    this.clearSlowState();
  }

  private clearSlowState(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }

    this.timers = [];
    this.slow.set(false);
    this.waking.set(false);
  }
}
