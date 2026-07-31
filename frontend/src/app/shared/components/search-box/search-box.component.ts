import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounce, distinctUntilChanged, map, timer } from 'rxjs';
import { SEARCH_DEBOUNCE_MS } from '../../../core/constants/app.constants';
import { MATERIAL_FORM_IMPORTS } from '../../material/material-imports';
import { IconComponent } from '../icon/icon.component';

/**
 * Debounced search input.
 *
 * Debouncing is the whole point: emitting per keystroke would fire a request for
 * every character, and the responses can arrive out of order so the list ends up
 * showing results for a prefix of what was typed.
 *
 * `distinctUntilChanged` suppresses the no-op emission you otherwise get from
 * typing a character and deleting it within one debounce window.
 *
 * The clear button is deliberately a real `<button>` rather than a click handler on
 * an icon, so it is reachable by keyboard.
 */
@Component({
  selector: 'pb-search-box',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, IconComponent, ...MATERIAL_FORM_IMPORTS],
  host: {
    class: 'block',
  },
  template: `
    @if (variant() === 'bar') {
      <!--
        Compact bar for the app shell.

        A Material form field is the right control inside a page — it has a floating label, a hint
        line and validation chrome. In a 64px toolbar all three are wasted vertical space, and the
        label duplicates a placeholder that is already visible. This variant is the same control
        with the chrome removed and a keyboard hint added, in the idiom Linear and Vercel use.
      -->
      <!--
        'rounded-pb-lg' to match the sidebar's nav pills rather than 'pb-md' for a form control: this
        is the one input that is part of the *frame* rather than part of a page, and the shell reads
        as one piece when its rounding agrees with itself.
      -->
      <!--
        Focus is carried by the pink ring, the same one every other control in the app uses, plus
        the field lifting from the sunken fill to the surface colour. That lift is what makes it
        read as "now active" rather than only "now outlined" — the box changes what it *is*, not
        just its edge.
      -->
      <div
        class="group flex h-11 items-center gap-pb-2 rounded-pb-lg border border-pb-border bg-pb-surface-sunken px-pb-3 transition-[border-color,box-shadow,background-color] duration-pb-fast ease-pb-out focus-within:border-pb-interactive focus-within:bg-pb-surface focus-within:shadow-pb-focus hover:border-pb-border-strong motion-reduce:transition-none"
      >
        <!-- Tints to the interaction colour while the field has focus, so the whole control
             confirms the shortcut landed rather than only the border moving a shade. -->
        <pb-icon
          name="search"
          [size]="16"
          class="text-pb-text-muted transition-colors duration-pb-fast ease-pb-out group-focus-within:text-pb-interactive motion-reduce:transition-none"
        />

        <input
          #barInput
          type="search"
          [formControl]="control"
          [placeholder]="placeholder() || label()"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          [attr.aria-label]="label()"
          class="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-pb-body text-pb-text outline-none placeholder:text-pb-text-muted"
          (keydown.escape)="clear()"
        />

        @if (control.value.length > 0) {
          <button
            type="button"
            aria-label="Clear search"
            class="grid h-8 w-8 shrink-0 cursor-pointer appearance-none place-items-center rounded-pb-sm border-0 bg-transparent text-pb-text-secondary transition-colors duration-pb-instant hover:bg-pb-hover-surface hover:text-pb-text"
            (click)="clear()"
          >
            <pb-icon name="close" [size]="14" />
          </button>
        } @else if (shortcutHint()) {
          <!--
            Hidden from assistive tech: it is a visual affordance for the shortcut, and a screen
            reader announcing "slash" inside the search field would be noise. The shortcut itself
            is owned by the shell, not by this component.

            Fades out as the field takes focus. Once you are typing the hint is spent — it told you
            how to get here and now it is just a box next to your cursor — but it is animated rather
            than removed so the field's contents do not jump sideways at the moment of focus.
          -->
          <kbd
            class="pb-kbd shrink-0 opacity-100 transition-opacity duration-pb-fast ease-pb-out group-focus-within:opacity-0 motion-reduce:transition-none"
            aria-hidden="true"
          >
            {{ shortcutHint() }}
          </kbd>
        }
      </div>
    } @else {
      <mat-form-field [subscriptSizing]="'dynamic'" class="w-full">
        <mat-label>{{ label() }}</mat-label>

        <input
          matInput
          type="search"
          [formControl]="control"
          [placeholder]="placeholder()"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          [attr.aria-label]="label()"
          (keydown.escape)="clear()"
        />

        <!--
          The 'field' variant's icons, matched to the 'bar' variant above.

          These were the last Material glyphs in a shared component, which meant the same search
          control drew a filled magnifier on a page and an outline one in the topbar — the two are
          side by side on every list screen. 'matPrefix'/'matSuffix' still position them; only the
          glyph changed.
        -->
        <pb-icon matPrefix name="search" [size]="18" class="mr-pb-2 text-pb-text-muted" />

        @if (control.value.length > 0) {
          <button
            matSuffix
            type="button"
            aria-label="Clear search"
            class="mr-pb-1 grid h-9 w-9 shrink-0 cursor-pointer appearance-none place-items-center rounded-pb-md border-0 bg-transparent p-0 text-pb-text-secondary transition-colors duration-pb-fast ease-pb-out hover:bg-pb-hover-surface hover:text-pb-text motion-reduce:transition-none"
            (click)="clear()"
          >
            <pb-icon name="close" [size]="16" />
          </button>
        }

        @if (hint()) {
          <mat-hint>{{ hint() }}</mat-hint>
        }
      </mat-form-field>
    }
  `,
})
export class SearchBoxComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly label = input<string>('Search');
  readonly placeholder = input<string>('');
  readonly hint = input<string>('');
  readonly debounceMs = input<number>(SEARCH_DEBOUNCE_MS);
  /** Seeds the field, e.g. from a `?q=` query parameter on load. */
  readonly initialValue = input<string>('');

  /**
   * `field` is the Material form field used on every page; `bar` is the compact shell variant.
   *
   * Defaulting to `field` is the point — this component is used on eight feature pages, and adding
   * a variant must not touch any of them. The debounce, de-duplication and clear behaviour are
   * shared by both, which is why this is a variant rather than a second component.
   */
  readonly variant = input<'field' | 'bar'>('field');

  /** Keyboard hint rendered in the `bar` variant, e.g. `/`. Empty renders nothing. */
  readonly shortcutHint = input<string>('');

  /**
   * Debounced, de-duplicated search term. Emits `''` when cleared.
   *
   * Named `searchChange`, not `search`: `<input type="search">` fires a native
   * `search` event, so an output of that name would let the DOM event and this one
   * arrive on the same binding.
   */
  readonly searchChange = output<string>();

  protected readonly control = new FormControl('', { nonNullable: true });

  private readonly barInput = viewChild<ElementRef<HTMLInputElement>>('barInput');

  /**
   * Focuses the field, for a keyboard shortcut owned by whoever hosts this.
   *
   * The shortcut lives in the shell rather than here: a component that bound a global key would
   * fight every other instance of itself on the page, and there are eight of them.
   */
  focus(): void {
    this.barInput()?.nativeElement.focus();
  }

  constructor() {
    // Keeps the field in step with an externally driven value (deep link, reset).
    effect(() => {
      const seed = this.initialValue();
      if (seed !== this.control.value) {
        this.control.setValue(seed, { emitEvent: false });
      }
    });

    this.control.valueChanges
      .pipe(
        map((value) => value.trim()),
        // A duration selector rather than a fixed `debounceTime`, so the input is
        // read on each emission and can change at runtime. Zero means no delay,
        // which is what tests want.
        debounce(() => timer(this.debounceMs())),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((value) => this.searchChange.emit(value));
  }

  clear(): void {
    if (this.control.value.length === 0) {
      return;
    }
    // Emits through the normal pipeline so the consumer sees the cleared term.
    this.control.setValue('');
  }
}
