import type { InventoryItem } from '../../../domain/entities/inventory-item.entity.js';
import {
  INVENTORY_LOCATION_LABELS,
  INVENTORY_UNIT_ABBREVIATIONS,
  InventoryLocation,
} from '../../../domain/enums/inventory.enum.js';
import { NotificationType } from '../../../domain/enums/notification.enum.js';
import { Role } from '../../../domain/enums/role.enum.js';
import type { IInventoryItemRepository } from '../../../domain/repositories/inventory-item.repository.js';
import type {
  CreateNotificationData,
  INotificationRepository,
} from '../../../domain/repositories/notification.repository.js';
import type { IUserRepository } from '../../../domain/repositories/user.repository.js';
import type { ILogger } from '../../ports/logger.port.js';

/** Entity type stored on every alert, for deep-linking and for de-duplication. */
const ENTITY_TYPE = 'InventoryItem';

/**
 * Most individual alerts of one kind in a single sweep.
 *
 * Not a limit on what gets alerted — anything held back is simply picked up by the next
 * sweep, because nothing was written for it and the de-duplication query will not find
 * it. It exists so that switching this feature on against an inventory with thirty items
 * already below their reorder level does not put thirty rows in the bell at once, which
 * is the fastest way to teach somebody to ignore it.
 *
 * What is deferred is logged rather than dropped silently.
 */
const MAX_ALERTS_PER_SWEEP = 10;

export interface StockAlertOptions {
  /** How far ahead to look for expiring stock. */
  readonly expiryWithinDays: number;
  /** How long an alert about one item suppresses the next alert about that item. */
  readonly cooldownHours: number;
}

export interface StockAlertScanResult {
  readonly lowStockItems: number;
  readonly expiringItems: number;
  readonly notificationsWritten: number;
  readonly deferred: number;
}

/**
 * Raises low-stock and expiry alerts.
 *
 * These two are the odd ones out among the notification sources: every other type is
 * emitted by somebody doing something, so there is an obvious moment to send it. Nothing
 * *happens* when stock crosses its reorder level during a consumption entry, and nothing
 * at all happens when an expiry date arrives — the date simply passes. Both are conditions
 * that become true on their own, so both need something that looks.
 *
 * ## Why a sweep rather than a hook on every stock change
 *
 * Stock moves in four places (purchases, transfers, consumption, manual adjustment) and
 * each would need the same before/after comparison bolted on, with the fifth caller added
 * later being the one that forgets. Expiry would still need a timer regardless, because no
 * write occurs when a date passes. One sweep covers both conditions and every writer,
 * including ones that do not exist yet.
 *
 * The cost is latency: an item that goes low is alerted within one sweep interval rather
 * than instantly. For restocking decisions measured in days, that is not a real cost.
 *
 * ## Routing: whoever can take the first action
 *
 * | Condition | Goes to | Because |
 * |---|---|---|
 * | Low at Home Warehouse | admins | restocking it means buying, and purchases are theirs |
 * | Low at Cart | store managers | they raise the transfer request that refills it |
 * | Expiring | admins | writing stock off is admin-only |
 *
 * Broadcasting all three to everyone would be less code and worse: an alert that is not
 * actionable by its reader is noise, and noise is what stops the actionable ones landing.
 *
 * ## Repetition
 *
 * A low item is still low on the next sweep, so the naive version re-sends the same alert
 * every interval forever. `findAlertedEntityIds` is the memory: an item alerted within the
 * cooldown window is skipped. The window is deliberately per-item and not per-recipient —
 * see the note on that method.
 *
 * ## Nothing here may throw
 *
 * It runs on a timer with no request to fail, so an exception would either be swallowed by
 * the runtime or take the process down depending on where it surfaced. Failures are caught
 * and logged, and the next sweep tries again.
 */
export class StockAlertScanner {
  constructor(
    private readonly items: IInventoryItemRepository,
    private readonly notifications: INotificationRepository,
    private readonly users: IUserRepository,
    private readonly logger: ILogger,
    private readonly options: StockAlertOptions,
  ) {}

  /**
   * Runs one sweep.
   *
   * `now` is a parameter rather than read from the clock so the rule is testable and a
   * sweep can be asked about any moment.
   */
  async scan(now: Date = new Date()): Promise<StockAlertScanResult> {
    const empty: StockAlertScanResult = {
      lowStockItems: 0,
      expiringItems: 0,
      notificationsWritten: 0,
      deferred: 0,
    };

    try {
      const cooldownStart = new Date(now.getTime() - this.options.cooldownHours * 3_600_000);

      const [lowStock, expiring, alertedLow, alertedExpiry, adminIds, managerIds] =
        await Promise.all([
          this.items.findLowStockForAlert(),
          this.items.findExpiringOnOrBefore(this.expiryCutoff(now)),
          this.notifications.findAlertedEntityIds(NotificationType.LOW_STOCK, cooldownStart),
          this.notifications.findAlertedEntityIds(NotificationType.EXPIRY_ALERT, cooldownStart),
          this.users.findIdsByRole(Role.ADMIN),
          this.users.findIdsByRole(Role.STORE_MANAGER),
        ]);

      const freshLow = lowStock.filter((item) => !alertedLow.has(item.id));
      const freshExpiring = expiring.filter((item) => !alertedExpiry.has(item.id));

      // Worst first, so a capped sweep sends the ones that matter most. Out of stock
      // outranks merely low, and among those the biggest gap goes first.
      const rankedLow = [...freshLow].sort((a, b) => this.urgency(b) - this.urgency(a));
      // Soonest expiry first — an item already past its date outranks one due next week.
      const rankedExpiring = [...freshExpiring].sort(
        (a, b) => (a.expiryDate?.getTime() ?? 0) - (b.expiryDate?.getTime() ?? 0),
      );

      const sendLow = rankedLow.slice(0, MAX_ALERTS_PER_SWEEP);
      const sendExpiring = rankedExpiring.slice(0, MAX_ALERTS_PER_SWEEP);
      const deferred =
        rankedLow.length - sendLow.length + (rankedExpiring.length - sendExpiring.length);

      const messages = [
        ...sendLow.flatMap((item) =>
          this.lowStockMessages(item, item.location === InventoryLocation.CART ? managerIds : adminIds),
        ),
        ...sendExpiring.flatMap((item) => this.expiryMessages(item, adminIds, now)),
      ];

      const written = messages.length === 0 ? 0 : await this.notifications.createMany(messages);

      if (deferred > 0) {
        // Said out loud: a capped sweep that reported only what it sent would look like
        // it had covered everything.
        this.logger.info('Stock alert sweep deferred alerts to the next run', {
          deferred,
          cap: MAX_ALERTS_PER_SWEEP,
        });
      }

      return {
        lowStockItems: freshLow.length,
        expiringItems: freshExpiring.length,
        notificationsWritten: written,
        deferred,
      };
    } catch (error) {
      this.logger.error('Stock alert sweep failed', error);
      return empty;
    }
  }

  /** End of the day `expiryWithinDays` from now, so "within 7 days" includes day 7. */
  private expiryCutoff(now: Date): Date {
    const cutoff = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + this.options.expiryWithinDays),
    );
    cutoff.setUTCHours(23, 59, 59, 999);
    return cutoff;
  }

  /** Out of stock beats low; within each, the bigger shortfall goes first. */
  private urgency(item: InventoryItem): number {
    const outOfStock = item.currentQuantity <= 0 ? 1_000_000 : 0;
    return outOfStock + item.shortfall;
  }

  private lowStockMessages(
    item: InventoryItem,
    recipientIds: readonly string[],
  ): readonly CreateNotificationData[] {
    const where = INVENTORY_LOCATION_LABELS[item.location];
    const unit = INVENTORY_UNIT_ABBREVIATIONS[item.unit];
    const outOfStock = item.currentQuantity <= 0;

    /*
     * Three wordings, because two would produce nonsense at the boundary.
     *
     * An item sitting exactly on its reorder level has a shortfall of zero, and telling
     * somebody it is "short by 0 kg" reads like a rounding bug and gets the whole alert
     * discounted. At the level is its own state: worth acting on, nothing missing yet.
     *
     * Where there is a real gap, the alert leads with it — "order 4 kg" is a decision,
     * "you have 1 kg" is a fact the reader still has to do arithmetic on.
     */
    const body = outOfStock
      ? `${item.displayQuantity} left at the ${where}. Reorder level is ${String(item.minimumQuantity)} ${unit}.`
      : item.shortfall <= 0
        ? `Down to ${item.displayQuantity} at the ${where}, which is exactly its reorder level.`
        : `Down to ${item.displayQuantity} at the ${where}, against a reorder level of ${String(item.minimumQuantity)} ${unit}. Short by ${String(item.shortfall)} ${unit}.`;

    return this.fanOut(recipientIds, {
      type: NotificationType.LOW_STOCK,
      title: outOfStock ? `${item.name} is out of stock` : `${item.name} is running low`,
      body,
      entityId: item.id,
    });
  }

  private expiryMessages(
    item: InventoryItem,
    recipientIds: readonly string[],
    now: Date,
  ): readonly CreateNotificationData[] {
    const expired = item.isExpiredAsOf(now);
    const on = item.expiryDate?.toISOString().slice(0, 10) ?? 'an unknown date';

    return this.fanOut(recipientIds, {
      type: NotificationType.EXPIRY_ALERT,
      title: expired ? `${item.name} has expired` : `${item.name} expires soon`,
      body: expired
        ? `${item.displayQuantity} at the ${INVENTORY_LOCATION_LABELS[item.location]} expired on ${on} and should be written off.`
        : `${item.displayQuantity} at the ${INVENTORY_LOCATION_LABELS[item.location]} expires on ${on}. Use it or write it off before then.`,
      entityId: item.id,
    });
  }

  /**
   * One row per recipient.
   *
   * `actorId` is null throughout: nobody caused these. A notification attributed to the
   * last person who touched the item would read as an accusation.
   */
  private fanOut(
    recipientIds: readonly string[],
    message: {
      readonly type: NotificationType;
      readonly title: string;
      readonly body: string;
      readonly entityId: string;
    },
  ): readonly CreateNotificationData[] {
    return recipientIds.map((recipientId) => ({
      recipientId,
      type: message.type,
      title: message.title,
      body: message.body,
      entityType: ENTITY_TYPE,
      entityId: message.entityId,
      actorId: null,
    }));
  }
}
