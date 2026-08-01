import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { LoadingService } from '../../../core/services/loading.service';

/**
 * Fixed indeterminate progress bar reflecting global HTTP activity, plus a note once that activity
 * outlasts a person's patience.
 *
 * Reads the `LoadingService` signal directly, so no component has to pass
 * loading state down; the interceptor increments the counter and this reacts.
 *
 * The note exists because the bar answers "is something happening" but not "should I keep
 * waiting". The API sleeps after fifteen idle minutes, so the first request after a quiet spell
 * takes tens of seconds while every later one takes under a second — and without a word of
 * explanation that reads as a broken app rather than a waking one.
 *
 * `aria-live="polite"`, not `assertive`: this is reassurance and should wait its turn rather than
 * interrupt a screen reader mid-sentence. It sits on the note rather than the bar, because the
 * note is the part with something to say.
 */
@Component({
  selector: 'pb-loading-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatProgressBarModule],
  template: `
    @if (loading.isLoading()) {
      <mat-progress-bar
        class="!fixed inset-x-0 top-0 z-50"
        mode="indeterminate"
        aria-label="Loading"
      />
    }

    @if (loading.isSlow()) {
      <!-- pointer-events-none so a message that appears under the cursor cannot swallow a tap. -->
      <div
        class="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4"
        role="status"
        aria-live="polite"
      >
        <p
          class="m-0 max-w-[22rem] rounded-full border border-outline-variant bg-surface px-4 py-2 text-center text-xs leading-snug text-on-surface shadow-pb-md"
        >
          @if (loading.isWaking()) {
            Waking the server — this can take up to a minute after a quiet spell.
          } @else {
            Still working…
          }
        </p>
      </div>
    }
  `,
})
export class LoadingBarComponent {
  protected readonly loading = inject(LoadingService);
}
