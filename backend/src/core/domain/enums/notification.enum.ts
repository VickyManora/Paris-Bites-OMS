/**
 * Notification vocabulary.
 *
 * Domain-owned; `NotificationPrismaMapper` bridges to Prisma's generated enum with an
 * exhaustive switch that stops compiling if the two diverge.
 *
 * Types are named after the **event**, not the audience. One event can fan out to
 * several people — a transfer request notifies every admin — and naming by audience
 * would force a second type for the same thing.
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

export const ALL_NOTIFICATION_TYPES: readonly NotificationType[] = [
  NotificationType.TRANSFER_REQUESTED,
  NotificationType.TRANSFER_APPROVED,
  NotificationType.TRANSFER_REJECTED,
  NotificationType.TRANSFER_COMPLETED,
  NotificationType.LOW_STOCK,
  NotificationType.PURCHASE_COMPLETED,
  NotificationType.EXPIRY_ALERT,
];

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === 'string' && Object.hasOwn(NotificationType, value);
}

/**
 * Severity, used by the UI to pick a colour.
 *
 * Derived from the type here rather than stored per row: it is presentation of the
 * event, not a fact about the notification, and a stored copy would be one write away
 * from disagreeing with its type.
 */
export const NotificationSeverity = {
  INFO: 'INFO',
  SUCCESS: 'SUCCESS',
  WARNING: 'WARNING',
} as const;

export type NotificationSeverity =
  (typeof NotificationSeverity)[keyof typeof NotificationSeverity];

const TYPE_SEVERITY: Readonly<Record<NotificationType, NotificationSeverity>> = {
  // An admin is being asked to do something — it needs attention, but nothing is wrong.
  [NotificationType.TRANSFER_REQUESTED]: NotificationSeverity.INFO,
  [NotificationType.TRANSFER_APPROVED]: NotificationSeverity.SUCCESS,
  // The one outcome the requester has to act on: a refusal needs a new request or a fix.
  [NotificationType.TRANSFER_REJECTED]: NotificationSeverity.WARNING,
  [NotificationType.TRANSFER_COMPLETED]: NotificationSeverity.SUCCESS,
  // Something is wrong with the stock on hand and somebody has to buy or move it.
  [NotificationType.LOW_STOCK]: NotificationSeverity.WARNING,
  [NotificationType.PURCHASE_COMPLETED]: NotificationSeverity.SUCCESS,
  // Expiry is the one alert with a deadline attached, and the loss is unrecoverable
  // once it passes — it shares WARNING with low stock rather than getting a quieter tone.
  [NotificationType.EXPIRY_ALERT]: NotificationSeverity.WARNING,
};

export function severityOf(type: NotificationType): NotificationSeverity {
  return TYPE_SEVERITY[type];
}

/**
 * Material icon per type, so every surface that renders a notification picks the same
 * one. Kept beside the severity because both answer "how is this drawn".
 */
const TYPE_ICONS: Readonly<Record<NotificationType, string>> = {
  [NotificationType.TRANSFER_REQUESTED]: 'inbox',
  [NotificationType.TRANSFER_APPROVED]: 'local_shipping',
  [NotificationType.TRANSFER_REJECTED]: 'cancel',
  [NotificationType.TRANSFER_COMPLETED]: 'task_alt',
  [NotificationType.LOW_STOCK]: 'production_quantity_limits',
  [NotificationType.PURCHASE_COMPLETED]: 'receipt_long',
  [NotificationType.EXPIRY_ALERT]: 'event_busy',
};

export function iconOf(type: NotificationType): string {
  return TYPE_ICONS[type];
}
