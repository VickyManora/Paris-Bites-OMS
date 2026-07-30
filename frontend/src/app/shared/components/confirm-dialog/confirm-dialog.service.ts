import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom, map, type Observable } from 'rxjs';
import { ConfirmDialogComponent } from './confirm-dialog.component';
import type { ConfirmDialogData } from '../../models/dialog-data.model';

/**
 * Opens confirmation dialogs.
 *
 * Exists so no caller has to remember the dialog config. Two settings in
 * particular are easy to omit and matter:
 *
 * - `disableClose: false` with backdrop dismissal allowed — an Escape or backdrop
 *   click resolves to "cancelled", which is the safe default for a confirmation.
 * - `autoFocus` left to Material so the `cdkFocusInitial` in the template wins,
 *   which is what puts focus on *cancel* for destructive prompts.
 *
 * Returns a promise: a confirmation is a single answer, not a stream, and `await`
 * reads better than nesting a subscribe around the action being confirmed.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  private readonly dialog = inject(MatDialog);

  /**
   * ```ts
   * if (await this.confirm.ask({ title: 'Delete product?', message: '…', variant: 'danger' })) {
   *   // proceed
   * }
   * ```
   */
  async ask(data: ConfirmDialogData): Promise<boolean> {
    return firstValueFrom(this.open(data));
  }

  /** Observable form, for composing inside an existing rxjs pipeline. */
  open(data: ConfirmDialogData): Observable<boolean> {
    const ref = this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(
      ConfirmDialogComponent,
      {
        data,
        width: '440px',
        // Never wider than a small phone in portrait.
        maxWidth: 'calc(100vw - 2rem)',
        restoreFocus: true,
        ariaLabel: data.title,
      },
    );

    // Dismissal (Escape, backdrop) closes with `undefined`; treat anything that
    // is not an explicit confirm as a decline.
    return ref.afterClosed().pipe(map((result) => result === true));
  }

  /** Convenience wrapper for the common delete prompt. */
  async askDelete(entity: string, detail?: string): Promise<boolean> {
    return this.ask({
      title: `Delete ${entity}?`,
      message: `This will permanently delete this ${entity.toLowerCase()}. This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      variant: 'danger',
      icon: 'delete_forever',
      ...(detail !== undefined && { detail }),
    });
  }
}
