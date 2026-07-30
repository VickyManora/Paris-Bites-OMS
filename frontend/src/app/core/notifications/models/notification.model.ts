/**
 * Mirrors the notification DTOs.
 *
 * `severity` and `icon` are **sent by the server**, derived there from the type. Nothing
 * here re-derives them, so the bell and the dashboard card cannot drift from each other
 * or from a type added later.
 *
 * Note the naming: `AppNotification`, not `Notification`. The DOM already has a global
 * `Notification` (the browser notification API), and shadowing it in a file that also
 * touches the window object is a debugging trap.
 */

export const NotificationType = {
  TRANSFER_REQUESTED: 'TRANSFER_REQUESTED',
  TRANSFER_APPROVED: 'TRANSFER_APPROVED',
  TRANSFER_REJECTED: 'TRANSFER_REJECTED',
  TRANSFER_COMPLETED: 'TRANSFER_COMPLETED',
  LOW_STOCK: 'LOW_STOCK',
  PURCHASE_COMPLETED: 'PURCHASE_COMPLETED',
  EXPIRY_ALERT: 'EXPIRY_ALERT',
} as const;

export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const NotificationSeverity = {
  INFO: 'INFO',
  SUCCESS: 'SUCCESS',
  WARNING: 'WARNING',
} as const;

export type NotificationSeverity = (typeof NotificationSeverity)[keyof typeof NotificationSeverity];

/**
 * Icon tint per severity. Text colour, not a filled chip — an inbox of chips is noise.
 *
 * These are the design system's **semantic** tones, not Material theme roles. The previous values
 * were `text-primary`, `text-tertiary` and `text-error`, which looked principled and rendered all
 * three severities as the same colour: the app's Material theme is built from a rose palette, so
 * primary, tertiary and error are three shades of pink. A low-stock warning and a completed transfer
 * were indistinguishable in the feed.
 *
 * The status ramps in `palette.css` are fixed hues chosen to mean something outside the brand — see
 * the STATUS COLOURS note there. The `-fg` step is the text-safe one: the base hues these ramps are
 * named for measure 2.1–3.8:1 on white and are legal as a dot or a bar, never as a word.
 */
export const SEVERITY_CLASSES: Readonly<Record<NotificationSeverity, string>> = {
  INFO: 'text-pb-info-fg',
  SUCCESS: 'text-pb-success-fg',
  WARNING: 'text-pb-warning-fg',
};

/**
 * Full tone per severity: surface, border and foreground as a set.
 *
 * For the notification bell, where the icon sits in a `pb-icon-tile` rather than loose in the row.
 * Separate from `SEVERITY_CLASSES` because the notification centre lists entries in a table where a
 * tinted tile per row would be far too much colour — the two surfaces want the same *meaning* at
 * different weights, which is exactly what a tone and a text colour are.
 */
export const SEVERITY_TONE_CLASSES: Readonly<Record<NotificationSeverity, string>> = {
  INFO: 'pb-tone-info',
  SUCCESS: 'pb-tone-success',
  WARNING: 'pb-tone-warning',
};

export interface AppNotification {
  readonly id: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;

  readonly severity: NotificationSeverity;
  /** Material icon name, chosen server-side from the type. */
  readonly icon: string;

  /** What it is about, for deep-linking: `StockTransfer`, `InventoryItem` or `Purchase`. */
  readonly entityType: string | null;
  readonly entityId: string | null;

  readonly actorName: string | null;

  readonly isRead: boolean;
  readonly readAt: string | null;
  readonly createdAt: string;
}

/** The bell's payload: newest few plus the badge count, fetched together. */
export interface NotificationFeed {
  readonly items: readonly AppNotification[];
  readonly unreadCount: number;
}

/** Returned by both mark-read endpoints so the badge never has to be guessed at. */
export interface UnreadCount {
  readonly unreadCount: number;
}
