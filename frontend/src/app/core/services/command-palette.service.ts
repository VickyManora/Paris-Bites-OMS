import { Injectable, signal, type Signal } from '@angular/core';

/**
 * Open/closed state for the command palette, and nothing else.
 *
 * A service rather than a signal on the layout, because the things that open the palette are spread
 * across the app: a global key handler in the shell, the topbar's search hint, and eventually a
 * per-page "what can I do here" affordance. All of them need the same switch, and none of them should
 * need a reference to the component.
 *
 * The command *list* is deliberately not here. It is derived per-open from the nav data and the user's
 * permissions, which the palette component already injects — keeping it there means there is no
 * registry to keep in step with the routes.
 */
@Injectable({ providedIn: 'root' })
export class CommandPaletteService {
  private readonly openState = signal(false);

  readonly isOpen: Signal<boolean> = this.openState.asReadonly();

  open(): void {
    this.openState.set(true);
  }

  close(): void {
    this.openState.set(false);
  }

  toggle(): void {
    this.openState.update((open) => !open);
  }
}
