import { inject, Injectable } from '@angular/core';
import { MatSnackBar, type MatSnackBarConfig } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { SNACKBAR_DURATION_MS } from '../constants/app.constants';
import type { AppError } from '../errors/app-error';

export interface ToastAction {
  readonly label: string;
  readonly handler: () => void;
}

/**
 * Toast notifications — the single way the app reports outcomes.
 *
 * Routing every message through here keeps duration, position and styling
 * consistent, and means swapping snackbars for another mechanism is one file
 * rather than hundreds of call sites.
 *
 * Durations differ by severity on purpose: an error needs longer to read than a
 * "Saved" confirmation, and a toast that vanishes before it is read may as well
 * not exist.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);

  private readonly baseConfig: MatSnackBarConfig = {
    horizontalPosition: 'center',
    // Bottom-centre so the toast never covers the topbar or the sidebar's
    // scrollable content, and clears thumb reach on mobile.
    verticalPosition: 'bottom',
  };

  success(message: string, action?: ToastAction): void {
    this.show(message, 'pb-snackbar-success', SNACKBAR_DURATION_MS.success, action);
  }

  info(message: string, action?: ToastAction): void {
    this.show(message, 'pb-snackbar-info', SNACKBAR_DURATION_MS.info, action);
  }

  warning(message: string, action?: ToastAction): void {
    this.show(message, 'pb-snackbar-warning', SNACKBAR_DURATION_MS.error, action);
  }

  error(message: string, action?: ToastAction): void {
    this.show(message, 'pb-snackbar-error', SNACKBAR_DURATION_MS.error, action);
  }

  /**
   * Shows an `AppError`.
   *
   * Validation errors are skipped: those messages belong beside the offending
   * field, and a toast repeating them is noise. A caller that wants both can call
   * `error()` explicitly.
   */
  fromError(error: AppError): void {
    if (error.isValidationError) {
      return;
    }
    this.error(error.message);
  }

  /**
   * Toast with an undo affordance, resolving to whether it was used.
   *
   * The caller decides what "undo" means; this only reports the choice. Note it
   * resolves `false` on timeout, so a caller awaiting it must treat that as
   * "keep the change".
   */
  async withUndo(message: string, undoLabel = 'Undo'): Promise<boolean> {
    const ref = this.snackBar.open(message, undoLabel, {
      ...this.baseConfig,
      duration: SNACKBAR_DURATION_MS.error,
      panelClass: 'pb-snackbar-info',
    });

    // `onAction` completes without emitting when the toast times out, so race it
    // against dismissal rather than awaiting it alone — which would hang forever.
    const dismissed = await firstValueFrom(ref.afterDismissed());
    return dismissed.dismissedByAction;
  }

  /** Closes whatever is currently showing. Used on sign-out and route resets. */
  dismiss(): void {
    this.snackBar.dismiss();
  }

  private show(message: string, panelClass: string, duration: number, action?: ToastAction): void {
    const ref = this.snackBar.open(message, action?.label ?? 'Dismiss', {
      ...this.baseConfig,
      duration,
      panelClass,
    });

    if (action !== undefined) {
      ref.onAction().subscribe(() => action.handler());
    }
  }
}
