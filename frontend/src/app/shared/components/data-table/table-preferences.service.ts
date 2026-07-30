import { effect, inject, Injectable, signal, type Signal } from '@angular/core';
import { StorageKeys } from '../../../core/constants/storage-keys';
import { StorageService } from '../../../core/services/storage.service';

/** How tightly rows are packed. */
export type TableDensity = 'compact' | 'comfortable';

/**
 * Row density for every table in the app, persisted.
 *
 * **Root-provided, and deliberately one preference rather than one per screen.** Density is a
 * statement about the person, not about the data: someone scanning a 100-row inventory on a large
 * monitor wants tight rows, and they want them tight on the purchases list too. A per-table setting
 * would mean setting it six times and finding it reset on the seventh screen.
 *
 * Persisted for the same reason — a display preference that resets on reload is a preference the user
 * stops bothering to set.
 *
 * Defaults to `comfortable`. A first-time user should meet the readable version; density is something
 * you reach for once the list is long enough to want it.
 */
@Injectable({ providedIn: 'root' })
export class TablePreferencesService {
  private readonly storage = inject(StorageService);

  private readonly state = signal<TableDensity>(
    this.storage.get<TableDensity>(StorageKeys.tableDensity, 'comfortable'),
  );

  readonly density: Signal<TableDensity> = this.state.asReadonly();

  constructor() {
    effect(() => {
      this.storage.set(StorageKeys.tableDensity, this.state());
    });
  }

  setDensity(density: TableDensity): void {
    this.state.set(density);
  }

  toggleDensity(): void {
    this.state.update((current) => (current === 'compact' ? 'comfortable' : 'compact'));
  }
}
