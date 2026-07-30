import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { LoadingService } from '../../../core/services/loading.service';

/**
 * Fixed indeterminate progress bar reflecting global HTTP activity.
 *
 * Reads the `LoadingService` signal directly, so no component has to pass
 * loading state down; the interceptor increments the counter and this reacts.
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
  `,
})
export class LoadingBarComponent {
  protected readonly loading = inject(LoadingService);
}
