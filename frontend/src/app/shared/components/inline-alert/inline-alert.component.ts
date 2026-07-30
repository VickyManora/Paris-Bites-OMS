import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MATERIAL_CORE_IMPORTS } from '../../material/material-imports';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

/**
 * A message about the state of the thing next to it — a failed request, an impossible filter range.
 *
 * ## Why this is a component
 *
 * Six list pages had each hand-rolled the same banner, and they had drifted: all six used
 * `bg-error-container` with `text-on-error-container`, which on this app's **rose** palette is a pink
 * panel — so "could not load" and "the from date is after the to date" looked like decoration rather
 * than a problem. Two pages used a `<p class="text-pb-caption">` inside it, one used bare text, and one
 * used no panel at all. The wording of the roles differed too: some set `role="alert"`, one did not, so
 * whether a screen reader announced the failure depended on which list you were on.
 *
 * The tones come from the design system's semantic set, which is fixed hues chosen to mean something
 * outside the brand — see the STATUS COLOURS note in `design-system.css`.
 *
 * ## `role` follows the tone, not the caller
 *
 * `danger` and `warning` render `role="alert"`, which interrupts a screen reader — correct for "your
 * request failed", and wrong for "3 items exported". `info` and `success` render `role="status"`, which
 * waits for a pause. Deriving it means no call site can get the aggressive version by accident.
 */
@Component({
  selector: 'pb-inline-alert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...MATERIAL_CORE_IMPORTS],
  host: {
    class: 'block',
  },
  template: `
    <div [class]="wrapperClass()" [attr.role]="role()">
      @if (tone() === 'success') {
        <!--
          The success tone gets a drawn tick rather than the icon font.

          This is the one tone that marks a moment rather than a condition: "saved" happened just now,
          where "could not load" is a state you are in. An animation on the others would be decoration
          on a message someone is trying to read.
        -->
        <svg
          class="h-5 w-5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path class="pb-tick" pathLength="1" d="M4 12.5 9.5 18 20 7" />
        </svg>
      } @else {
        <mat-icon class="!h-5 !w-5 shrink-0 !text-[20px]" aria-hidden="true">
          {{ resolvedIcon() }}
        </mat-icon>
      }

      <div class="min-w-0 flex-1">
        @if (title()) {
          <p class="m-0 text-pb-body font-medium">{{ title() }}</p>
        }
        <!-- 'break-words' because the commonest content here is a server message, which can carry an
             unbroken identifier long enough to widen the panel past its container. -->
        <p class="m-0 whitespace-normal break-words text-pb-caption">{{ message() }}</p>
      </div>

      <!-- A retry or a dismiss, supplied by the caller. -->
      <div class="flex shrink-0 items-center gap-pb-1">
        <ng-content select="[slot=actions]" />
      </div>
    </div>
  `,
})
export class InlineAlertComponent {
  readonly message = input.required<string>();
  /** Optional lead line, for when the message alone does not say what failed. */
  readonly title = input<string>('');
  readonly tone = input<AlertTone>('danger');

  /** Overrides the per-tone default. */
  readonly icon = input<string>('');

  /**
   * The icon actually drawn.
   *
   * Every tone has one, because colour is never the only signal here — a reader who cannot separate
   * the amber panel from the red one still gets `warning` against `error`.
   */
  protected readonly resolvedIcon = computed(() => {
    const override = this.icon();

    if (override.length > 0) {
      return override;
    }

    switch (this.tone()) {
      case 'info':
        return 'info';
      case 'success':
        return 'check_circle';
      case 'warning':
        return 'warning';
      default:
        return 'error';
    }
  });

  protected readonly wrapperClass = computed(() => {
    const base = 'flex items-start gap-pb-3 rounded-pb-lg border p-pb-3';

    switch (this.tone()) {
      case 'info':
        return `${base} pb-tone-info`;
      case 'success':
        return `${base} pb-tone-success`;
      case 'warning':
        return `${base} pb-tone-warning`;
      default:
        return `${base} pb-tone-danger`;
    }
  });

  protected readonly role = computed(() =>
    this.tone() === 'danger' || this.tone() === 'warning' ? 'alert' : 'status',
  );
}
