import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MATERIAL_CORE_IMPORTS } from '../../material/material-imports';

/**
 * The primary action of a form, with its in-flight state.
 *
 * ## What it fixes
 *
 * Every form did this by hand as `{{ saving() ? 'Saving…' : 'Save changes' }}`, which has two problems
 * that show up on a slow connection. The label changes width, so the button resizes mid-submit and the
 * row beside it reflows. And "Saving…" is the *only* signal — there is no spinner, so on a request that
 * takes three seconds the button looks like it is simply displaying different text.
 *
 * Here the spinner appears **inside** the button at its resting width: `min-width` is held so the
 * geometry cannot change, and the label is replaced rather than rewritten.
 *
 * ## Why it stays enabled-looking while disabled
 *
 * A submitting button is `disabled` so it cannot be double-pressed — that part matters, because a
 * double-submit on a purchase creates two invoices. But Material's disabled styling drops it to ~38%
 * opacity, which reads as "this is unavailable" rather than "this is working". `aria-busy` carries the
 * state to assistive technology and the spinner carries it visually, so the opacity is held at full.
 *
 * ## `type="button"`, deliberately
 *
 * Every form in this app submits through an explicit handler rather than a native `submit` event,
 * because the handlers are async and need to disable the form before the request. A `type="submit"`
 * inside a `<form>` would fire both paths.
 */
@Component({
  selector: 'pb-submit-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatProgressSpinnerModule, ...MATERIAL_CORE_IMPORTS],
  host: {
    class: 'block sm:inline-block',
  },
  template: `
    <!--
      ## The content is repeated per branch, and that is not an oversight

      It used to live in one 'ng-template' pulled in with 'ngTemplateOutlet', which is the obvious way
      to keep three variants from drifting. It also silently broke the icon.

      'MatButton' takes its icon through 'ng-content select="mat-icon, .material-icons,
      [matButtonIcon]"', and content projection is matched at **compile time** against static markup.
      An 'ng-container' carrying a template outlet is opaque to that selector, so the icon never
      reached the icon slot — it fell into the default text slot, arriving with 'margin-right: 0' and
      'vertical-align: baseline' instead of the slot's own spacing and centring. Measured on the daily
      sales dialog: no gap between tick and label, and the icon's centre sitting 1.5px above the
      label's, because a 24px inline-block and a 27px line box share a baseline but not a middle.

      Control flow is different: Angular *can* project through an '@if' whose branch has a single root
      node. So each branch below holds exactly one projectable element, and the label is a plain span
      outside the conditional. Keep it that way — wrapping either in a template, or putting a second
      root node in an icon branch, puts the icon back in the wrong slot. The compiler warns about the
      second case (NG8011) and is silent about the first.

      Three static branches rather than one button with a bound variant.

      'matButton' is a *directive selector*, not an input: Angular matches it at compile time from the
      static attribute. Writing '[attr.matButton]="variant()"' sets the DOM attribute after
      compilation, so the directive never applies and the button renders as bare browser chrome —
      which, with Tailwind's preflight absent, is a grey bordered box. There is no binding form of this;
      the attribute has to be literal.
    -->
    @switch (variant()) {
      @case ('filled') {
        <button
          matButton="filled"
          type="button"
          [class]="buttonClass()"
          [style.min-width.px]="minWidth()"
          [disabled]="busy() || disabled()"
          [attr.aria-busy]="busy()"
          (click)="pressed.emit()"
        >
          @if (busy()) {
            <mat-spinner class="!mr-pb-2 !inline-block" [diameter]="18" aria-hidden="true" />
          } @else if (icon()) {
            <mat-icon>{{ icon() }}</mat-icon>
          }
          <span>{{ busy() ? busyLabel() : label() }}</span>
        </button>
      }
      @case ('tonal') {
        <button
          matButton="tonal"
          type="button"
          [class]="buttonClass()"
          [style.min-width.px]="minWidth()"
          [disabled]="busy() || disabled()"
          [attr.aria-busy]="busy()"
          (click)="pressed.emit()"
        >
          @if (busy()) {
            <mat-spinner class="!mr-pb-2 !inline-block" [diameter]="18" aria-hidden="true" />
          } @else if (icon()) {
            <mat-icon>{{ icon() }}</mat-icon>
          }
          <span>{{ busy() ? busyLabel() : label() }}</span>
        </button>
      }
      @default {
        <button
          matButton="outlined"
          type="button"
          [class]="buttonClass()"
          [style.min-width.px]="minWidth()"
          [disabled]="busy() || disabled()"
          [attr.aria-busy]="busy()"
          (click)="pressed.emit()"
        >
          @if (busy()) {
            <mat-spinner class="!mr-pb-2 !inline-block" [diameter]="18" aria-hidden="true" />
          } @else if (icon()) {
            <mat-icon>{{ icon() }}</mat-icon>
          }
          <span>{{ busy() ? busyLabel() : label() }}</span>
        </button>
      }
    }
  `,
})
export class SubmitButtonComponent {
  readonly label = input.required<string>();
  /** What it says while the request is in flight. */
  readonly busyLabel = input<string>('Saving…');
  readonly icon = input<string>('');
  readonly variant = input<'filled' | 'tonal' | 'outlined'>('filled');

  readonly busy = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });

  /**
   * Floor for the button's width, so swapping the label for a spinner cannot resize it.
   *
   * A number rather than a measurement: measuring the resting width would mean a render pass before
   * the first paint, and the labels here are known at the call site.
   */
  readonly minWidth = input<number>(132);

  readonly pressed = output<void>();

  protected readonly buttonClass = computed(() => {
    const base = 'pb-btn !w-full sm:!w-auto';
    return this.busy() ? `${base} pb-submit-busy` : base;
  });
}
