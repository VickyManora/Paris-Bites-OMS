import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

export type SpinnerSize = 'sm' | 'md' | 'lg';

/**
 * Loading spinner, inline or as an overlay.
 *
 * Two modes rather than two components because the difference is purely
 * presentational — the accessibility contract is identical, and duplicating it is
 * how one copy ends up without `role="status"`.
 *
 * `role="status"` with `aria-live="polite"` announces the label to a screen reader
 * without interrupting; the visual spinner alone conveys nothing.
 */
@Component({
  selector: 'pb-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatProgressSpinnerModule],
  template: `
    @if (overlay()) {
      <!-- 'absolute' and not 'fixed': the overlay covers its positioned ancestor
           (a card, a table) rather than the whole viewport, so the rest of the
           page stays usable while one region loads. -->
      <div
        class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface/70 backdrop-blur-sm"
        role="status"
        aria-live="polite"
      >
        <mat-progress-spinner mode="indeterminate" [diameter]="diameter()" />
        <p class="text-pb-caption text-on-surface-variant">{{ label() }}</p>
      </div>
    } @else {
      <div
        class="flex items-center justify-center gap-3"
        [class.py-8]="padded()"
        role="status"
        aria-live="polite"
      >
        <mat-progress-spinner mode="indeterminate" [diameter]="diameter()" />
        @if (showLabel()) {
          <span class="text-pb-caption text-on-surface-variant">{{ label() }}</span>
        } @else {
          <!-- Still announced, just not shown. -->
          <span class="sr-only">{{ label() }}</span>
        }
      </div>
    }
  `,
})
export class SpinnerComponent {
  readonly size = input<SpinnerSize>('md');
  readonly label = input<string>('Loading…');
  readonly showLabel = input<boolean>(false);
  /** Renders as a translucent cover over the nearest positioned ancestor. */
  readonly overlay = input<boolean>(false);
  readonly padded = input<boolean>(true);

  protected readonly diameter = computed(() => {
    switch (this.size()) {
      case 'sm':
        return 20;
      case 'lg':
        return 56;
      case 'md':
        return 36;
    }
  });
}
