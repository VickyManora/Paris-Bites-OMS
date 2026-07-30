import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MATERIAL_CORE_IMPORTS } from '../../material/material-imports';

/** One stage of a long form. `complete` is decided by the page, from its own form state. */
export interface FormStep {
  /** Matches the `id` of the section it points at, for the scroll and for `aria-controls`. */
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly complete: boolean;
}

/**
 * Stepper-style progress for a long single-page form.
 *
 * ## Why this is a progress indicator and not a `MatStepper`
 *
 * A gated stepper hides the steps you are not on, and that is exactly wrong for the form this exists
 * for. Recording a purchase means entering invoice details, then lines, and **watching the totals
 * change as you type** — the GST split is derived from the supplier and the line rates, and the whole
 * reason someone checks it is to compare it against the paper invoice in their hand. A stepper that put
 * totals behind "next" would hide the number the task is about.
 *
 * So this borrows the stepper's *language* — numbered stages, completion ticks, a connector — without
 * its gating. Everything stays on one page and reachable; the stages say how far along you are and what
 * is still missing, and pressing one scrolls to it.
 *
 * That distinction is the whole design: a wizard is right when steps are independent and sequential, and
 * this form's steps are neither. Nothing else in the app is a wizard either — the POS order screen and
 * the consumption sheet both need their totals and their lines visible at once for the same reason.
 *
 * ## Completion is claimed by the page, not inferred
 *
 * A step is complete when the page says so, because only the page knows what "done" means for it — an
 * invoice section with a supplier and a date is complete even though three optional fields are empty.
 * Inferring it from `FormGroup.valid` would mark a section incomplete for a reason the user cannot see.
 */
@Component({
  selector: 'pb-form-steps',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...MATERIAL_CORE_IMPORTS],
  host: {
    class: 'block',
  },
  template: `
    <!--
      An ordered list: these are stages in sequence, and that is what 'ol' means. The connector is
      drawn per item rather than as a line behind the row, so it cannot fall out of step with wrapping
      on a narrow screen.
    -->
    <nav [attr.aria-label]="ariaLabel()">
      <ol class="m-0 flex list-none flex-wrap items-center gap-pb-1 p-0">
        @for (step of steps(); track step.id; let index = $index; let last = $last) {
          <li class="flex items-center gap-pb-1">
            <button
              type="button"
              [class]="stepClass"
              [attr.aria-current]="step.complete ? null : 'step'"
              (click)="stepSelect.emit(step.id)"
            >
              <span [class]="markerClass(step)" aria-hidden="true">
                @if (step.complete) {
                  <mat-icon class="!h-4 !w-4 !text-[16px]">check</mat-icon>
                } @else {
                  {{ index + 1 }}
                }
              </span>

              <span class="flex min-w-0 flex-col items-start">
                <span class="truncate text-pb-body font-medium">{{ step.label }}</span>
                @if (step.hint) {
                  <span class="truncate text-pb-caption text-on-surface-variant">{{
                    step.hint
                  }}</span>
                }
              </span>

              <!-- Said in words as well as by the tick, because the tick is decoration to a screen
                   reader and "step 2 of 3, complete" is the useful sentence. -->
              <span class="sr-only">
                — step {{ index + 1 }} of {{ steps().length }},
                {{ step.complete ? 'complete' : 'not complete' }}
              </span>
            </button>

            @if (!last) {
              <span class="h-px w-pb-4 shrink-0 bg-outline-variant" aria-hidden="true"></span>
            }
          </li>
        }
      </ol>
    </nav>
  `,
})
export class FormStepsComponent {
  readonly steps = input.required<readonly FormStep[]>();
  readonly ariaLabel = input<string>('Form progress');

  /** The `id` of the pressed step, for the page to scroll to. */
  readonly stepSelect = output<string>();

  /**
   * One class list for every step, complete or not.
   *
   * Deliberately not varied by state: the marker inside carries completion, and tinting the whole
   * button as well would make the row read as a set of toggles where two are selected. The stages are
   * navigation, not a choice.
   */
  protected readonly stepClass =
    'flex cursor-pointer appearance-none items-center gap-pb-2 rounded-pb-lg border border-outline-variant bg-transparent px-pb-3 py-pb-2 text-left text-on-surface transition-colors duration-pb-fast ease-pb-out hover:bg-pb-neutral-surface';

  /**
   * The numbered circle, or a tick once done.
   *
   * Complete is the design system's success tone rather than the brand primary: on this rose palette
   * primary is pink, and a pink tick beside a grey number does not read as "finished" — it reads as
   * "selected". Green does, in a way that survives not knowing the convention.
   */
  protected markerClass(step: FormStep): string {
    const base =
      'grid h-6 w-6 shrink-0 place-items-center rounded-pb-full text-pb-caption font-semibold';

    return step.complete
      ? `${base} pb-tone-success border`
      : `${base} border border-outline-variant text-on-surface-variant`;
  }
}
