import { DOCUMENT, inject, Injectable, signal, type Signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, of, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiEndpoints } from '../constants/api-endpoints';
import { skipErrorNotification } from '../http/interceptors/error.interceptor';
import { skipLoading } from '../http/interceptors/loading.interceptor';
import { withTimeout } from '../http/interceptors/timeout.interceptor';

/**
 * How long the API may be asleep. Render's free tier spins a service down after 15 minutes idle
 * and takes the better part of a minute to come back, so the ping is given a deadline well past
 * the app's normal one rather than the 30s that would cut it off mid-boot.
 */
const WAKE_TIMEOUT_MS = 90_000;

/**
 * How stale contact has to be before returning to the tab re-pings.
 *
 * Below the platform's 15-minute idle window, so a cashier who comes back to the tab after a lull
 * starts the cold start *before* they tap anything. Above a few minutes, so switching between tabs
 * during a shift costs nothing.
 */
const STALE_CONTACT_MS = 4 * 60_000;

/**
 * Wakes the API, as early as possible and without blocking anything.
 *
 * ## The problem this exists for
 *
 * The API sleeps. On the hosting the shop pays nothing for, a service with no traffic for fifteen
 * minutes is stopped, and the next request pays for the whole start-up — around a minute of it.
 * That minute used to land on the *cashier*, at the worst possible moment: they open the tab with a
 * customer already at the counter, and the screen has nothing on it because the first thing the app
 * does on boot is ask the API who they are.
 *
 * Nothing here makes the server start faster. What it does is move the wait off the critical path
 * and start it sooner:
 *
 * - **Sooner**, because the ping goes out the moment the app boots and again when a hidden tab
 *   becomes visible — before the cashier has navigated anywhere or tapped anything. The cold start
 *   overlaps with them walking to the counter instead of starting when they get there.
 * - **Off the path**, because it is `void`ed. Nothing awaits it, no guard blocks on it, and it
 *   paints nothing. The screens render from cache and this quietly makes the network real again.
 *
 * ## Why `/health/live` and not something useful
 *
 * It is public, it touches no database, and it is the one endpoint whose response nobody needs.
 * A cold start is expensive on the *server*, not on the wire, so any endpoint would do to trigger
 * it — but a real one would either need a token the app may not have yet or return data that then
 * has to be thrown away. `live` also answers as soon as the process is listening, which is exactly
 * the moment the rest of the app's requests stop failing.
 *
 * Failures are swallowed on purpose: this is a warm-up, and a snackbar reading "could not reach the
 * server" while the server is in the middle of starting would be both true and useless.
 */
@Injectable({ providedIn: 'root' })
export class ApiWakeService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  private readonly pinging = signal(false);
  private lastContactAt = 0;

  /** True while a wake ping is in flight — the POS shows this as "reconnecting". */
  readonly waking: Signal<boolean> = this.pinging.asReadonly();

  /**
   * Starts pinging, and keeps doing it whenever the tab comes back into view.
   *
   * Called once from the app initializer. The visibility listener is never removed because this
   * service lives as long as the tab does; adding teardown would be ceremony around a no-op.
   */
  start(): void {
    this.ping();

    this.document.addEventListener('visibilitychange', () => {
      if (this.document.visibilityState !== 'visible') {
        return;
      }

      // A tab switch mid-shift is not a cold start. Only a real gap is.
      if (Date.now() - this.lastContactAt >= STALE_CONTACT_MS) {
        this.ping();
      }
    });
  }

  /** Records that something else reached the API, so the next tab focus does not re-ping. */
  markContact(): void {
    this.lastContactAt = Date.now();
  }

  private ping(): void {
    if (this.pinging()) {
      return;
    }

    this.pinging.set(true);

    void this.http
      .get(`${environment.apiBaseUrl}${ApiEndpoints.health.live}`, {
        context: withTimeout(WAKE_TIMEOUT_MS, skipLoading(skipErrorNotification())),
      })
      .pipe(
        tap(() => this.markContact()),
        catchError(() => of(null)),
      )
      .subscribe(() => this.pinging.set(false));
  }
}
