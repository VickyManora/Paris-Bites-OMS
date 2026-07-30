/** Input contract for `ConfirmDialogComponent`. */
export interface ConfirmDialogData {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /**
   * `danger` styles confirm as destructive AND moves initial focus to cancel —
   * a reflexive Enter press should not delete a record.
   */
  readonly variant?: 'default' | 'danger';
  readonly icon?: string;
  /** Extra detail shown beneath the message, e.g. the name of the affected record. */
  readonly detail?: string;
}

export type ConfirmDialogResult = boolean;
