import { DestroyRef, inject, Injectable, signal, type Signal } from '@angular/core';

/**
 * Whether the browser currently believes it has a network.
 *
 * A signal rather than an observable because every consumer is a template deciding whether to
 * show a warning, and `@if (online())` needs no subscription or `async` pipe.
 *
 * **What `navigator.onLine` actually means.** It reports whether the device has *a* network
 * connection, not whether the API is reachable — a phone attached to a captive-portal wifi with
 * no route out reports `true`. So this is treated as a hint that improves a message, never as a
 * gate on sending a request: `false` is reliable enough to warn about, `true` is not reliable
 * enough to promise anything. Attempts still go out and the HTTP layer still decides.
 *
 * Listeners are torn down with the injector, which matters because this is used by the POS
 * screen rather than only at the root.
 */
@Injectable({ providedIn: 'root' })
export class OnlineStatusService {
  private readonly state = signal(navigator.onLine);

  /** `false` only when the browser is certain there is no network. */
  readonly online: Signal<boolean> = this.state.asReadonly();

  constructor() {
    const goOnline = (): void => this.state.set(true);
    const goOffline = (): void => this.state.set(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    });
  }
}
