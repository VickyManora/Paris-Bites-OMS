import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MATERIAL_CORE_IMPORTS } from '../../material/material-imports';

/**
 * A whole screen that failed, with a drawn illustration rather than a warning icon.
 *
 * ## Why an illustration, and why this one
 *
 * A 40px `cloud_off` glyph on an empty page reads as a broken layout — the same visual weight as a
 * missing image. The point of an illustration here is not decoration: it is to make the state
 * *legible as a state*, so the reader knows the page is telling them something rather than failing to
 * render.
 *
 * It is inline SVG, not an asset. Three reasons, in order of how much they matter:
 *
 * 1. **It is the error path.** An illustration fetched over the network is exactly the request that
 *    also fails when the page's own request failed. A file that 404s here would leave a broken image
 *    inside the message explaining a broken connection.
 * 2. **It is themed.** `currentColor` and the design system's tones mean it follows light and dark
 *    without a second file, which a PNG cannot.
 * 3. It costs about 700 bytes in the chunk that already needs it, against a request plus a cache entry.
 *
 * Deliberately geometric — a disconnected plug and a broken line — rather than a character or a mascot.
 * A cartoon apologising for a 500 is charming once and irritating on the fourth attempt, and this is a
 * screen someone may be looking at because their shift is blocked.
 */
@Component({
  selector: 'pb-error-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...MATERIAL_CORE_IMPORTS],
  host: {
    class: 'block',
  },
  template: `
    <!--
      'role="alert"' on the wrapper, so the failure is announced when it replaces the content — this is
      the outcome the user was waiting for, not an aside.
    -->
    <div
      class="flex flex-col items-center justify-center gap-pb-3 rounded-pb-xl border border-outline-variant bg-surface-container-low px-pb-4 py-pb-6 text-center"
      role="alert"
    >
      <!--
        The illustration. 'aria-hidden' because the heading below says the same thing in words, and a
        screen reader describing a decorative drawing is noise before the message.

        Sized in rem so it scales with a browser's font setting rather than pinning at 96px.
      -->
      <svg
        class="h-24 w-24 text-on-surface-variant"
        viewBox="0 0 96 96"
        fill="none"
        aria-hidden="true"
      >
        <!-- The severed connection: two stubs and a gap where the line should join. -->
        <path
          d="M14 48h20"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          opacity="0.5"
        />
        <path
          d="M62 48h20"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          opacity="0.5"
        />
        <!-- The two halves, pulled apart. The tone class colours these, so the break is what the eye
             lands on. -->
        <rect
          x="30"
          y="34"
          width="14"
          height="28"
          rx="4"
          stroke="currentColor"
          stroke-width="3"
          class="text-pb-danger-fg"
        />
        <rect
          x="52"
          y="34"
          width="14"
          height="28"
          rx="4"
          stroke="currentColor"
          stroke-width="3"
          class="text-pb-danger-fg"
        />
        <!-- Three short strokes in the gap: the conventional "not connected" mark. -->
        <path
          d="M48 26v-6M42 30l-4-5M54 30l4-5"
          stroke="currentColor"
          stroke-width="3"
          stroke-linecap="round"
          class="text-pb-danger-fg"
          opacity="0.8"
        />
      </svg>

      <div class="flex max-w-prose flex-col gap-pb-1">
        <p class="m-0 text-pb-title text-on-surface">{{ title() }}</p>
        @if (message()) {
          <p class="m-0 whitespace-normal break-words text-pb-body text-on-surface-variant">
            {{ message() }}
          </p>
        }
        @if (hint()) {
          <p class="m-0 mt-pb-1 text-pb-caption text-on-surface-variant">{{ hint() }}</p>
        }
      </div>

      <div class="mt-pb-1 flex flex-wrap items-center justify-center gap-pb-2">
        @if (retryLabel()) {
          <button matButton="filled" type="button" class="pb-btn" (click)="retry.emit()">
            <mat-icon>refresh</mat-icon>
            {{ retryLabel() }}
          </button>
        }
        <ng-content select="[slot=actions]" />
      </div>
    </div>
  `,
})
export class ErrorStateComponent {
  readonly title = input<string>('Something went wrong');
  readonly message = input<string>('');

  /**
   * A line about what to do next, when there is something useful to say.
   *
   * Separate from `message` because `message` is usually the server's sentence, and advice from us
   * should not look like it came from the API.
   */
  readonly hint = input<string>('');

  /** Empty renders no retry button — for a failure that retrying cannot fix. */
  readonly retryLabel = input<string>('Try again');

  readonly retry = output<void>();
}
