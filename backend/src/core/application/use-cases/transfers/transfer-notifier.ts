import type { StockTransfer } from '../../../domain/entities/stock-transfer.entity.js';
import { INVENTORY_LOCATION_LABELS } from '../../../domain/enums/inventory.enum.js';
import { NotificationType } from '../../../domain/enums/notification.enum.js';
import { Role } from '../../../domain/enums/role.enum.js';
import type {
  CreateNotificationData,
  INotificationRepository,
} from '../../../domain/repositories/notification.repository.js';
import type { IUserRepository } from '../../../domain/repositories/user.repository.js';
import type { ILogger } from '../../ports/logger.port.js';

/** Entity type stored on every notification this class writes, for deep-linking. */
const ENTITY_TYPE = 'StockTransfer';

/**
 * Turns transfer events into notifications for the people who need to act on them.
 *
 * Sits alongside `transfer-audit.ts`, and the split between them is the point: the audit
 * log records **what happened** for later investigation and is never deleted; a
 * notification is a **message to a person** that they read once and dismiss. Same events,
 * different lifetimes and different readers, so they are different tables.
 *
 * Routing follows the approval chain rather than broadcasting:
 *
 * | Event | Goes to | Because |
 * |---|---|---|
 * | Requested | every admin | only an admin can approve, and none is "the" approver |
 * | Approved | the requester | their request is now in transit and needs receiving |
 * | Rejected | the requester | they must act — fix and re-raise, or drop it |
 * | Completed | the requester | closes the loop when somebody else received it |
 *
 * **Nothing here may throw.** Every method swallows its failures and logs them, for the
 * same reason `AuditLogPrismaRepository` does: a notification that cannot be delivered
 * must never turn a successful stock movement into a 500. Approving a transfer moves real
 * stock in a committed transaction — failing the response afterwards would tell the admin
 * it did not happen when it did, which is far worse than a missing bell entry.
 */
export class TransferNotifier {
  constructor(
    private readonly notifications: INotificationRepository,
    private readonly users: IUserRepository,
    private readonly logger: ILogger,
  ) {}

  /** Requested: ask every admin for a decision. */
  async transferRequested(transfer: StockTransfer, actorId: string): Promise<void> {
    await this.dispatch('requested', transfer, async () => {
      const adminIds = await this.users.findIdsByRole(Role.ADMIN);
      const requester = transfer.toProps().requestedByName ?? 'A store manager';
      const destination = INVENTORY_LOCATION_LABELS[transfer.toLocation];

      return this.fanOut(adminIds, actorId, {
        type: NotificationType.TRANSFER_REQUESTED,
        title: `Transfer ${transfer.reference} needs approval`,
        body: `${requester} requested ${this.itemCount(transfer)} for the ${destination}.`,
        transfer,
        actorId,
      });
    });
  }

  /** Approved and dispatched: tell the requester their stock is on its way. */
  async transferApproved(transfer: StockTransfer, actorId: string): Promise<void> {
    await this.dispatch('approved', transfer, () => {
      const reviewer = transfer.toProps().reviewedByName ?? 'An administrator';
      const destination = INVENTORY_LOCATION_LABELS[transfer.toLocation];

      return Promise.resolve(
        this.fanOut([transfer.requestedById], actorId, {
          type: NotificationType.TRANSFER_APPROVED,
          title: `Transfer ${transfer.reference} approved`,
          body: `${reviewer} approved ${this.itemCount(transfer)}. In transit to the ${destination} — confirm arrival to receive the stock.`,
          transfer,
          actorId,
        }),
      );
    });
  }

  /**
   * Rejected: tell the requester, and carry the reason.
   *
   * The reason is the whole value of this one. "Your request was rejected" with no cause
   * just produces an identical second request.
   */
  async transferRejected(transfer: StockTransfer, actorId: string, reason: string): Promise<void> {
    await this.dispatch('rejected', transfer, () => {
      const reviewer = transfer.toProps().reviewedByName ?? 'An administrator';

      return Promise.resolve(
        this.fanOut([transfer.requestedById], actorId, {
          type: NotificationType.TRANSFER_REJECTED,
          title: `Transfer ${transfer.reference} rejected`,
          body: `${reviewer} rejected this request: ${reason}`,
          transfer,
          actorId,
        }),
      );
    });
  }

  /** Completed: close the loop for the requester when somebody else received the goods. */
  async transferCompleted(transfer: StockTransfer, actorId: string): Promise<void> {
    await this.dispatch('completed', transfer, () => {
      const receiver = transfer.toProps().completedByName ?? 'Someone';
      const destination = INVENTORY_LOCATION_LABELS[transfer.toLocation];

      return Promise.resolve(
        this.fanOut([transfer.requestedById], actorId, {
          type: NotificationType.TRANSFER_COMPLETED,
          title: `Transfer ${transfer.reference} completed`,
          body: `${receiver} confirmed ${this.itemCount(transfer)} arrived at the ${destination}.`,
          transfer,
          actorId,
        }),
      );
    });
  }

  /**
   * Runs one notification attempt, absorbing any failure.
   *
   * Wrapped once here rather than repeated in four methods, so a new event cannot be
   * added without the safety net.
   */
  private async dispatch(
    event: string,
    transfer: StockTransfer,
    build: () => Promise<readonly CreateNotificationData[]>,
  ): Promise<void> {
    try {
      const messages = await build();

      if (messages.length === 0) {
        return;
      }

      await this.notifications.createMany(messages);
    } catch (error) {
      this.logger.error('Failed to send transfer notifications', error, {
        event,
        transferId: transfer.id,
        reference: transfer.reference,
      });
    }
  }

  /**
   * Builds one message per recipient, skipping the person who caused the event.
   *
   * Self-notification is filtered here rather than at each call site because it is a
   * property of the whole mechanism: an admin who requests their own transfer, or
   * receives the stock themselves, already knows. A bell that lights up for your own
   * click teaches people to ignore the bell.
   */
  private fanOut(
    recipientIds: readonly string[],
    actorId: string,
    message: {
      readonly type: NotificationType;
      readonly title: string;
      readonly body: string;
      readonly transfer: StockTransfer;
      readonly actorId: string;
    },
  ): readonly CreateNotificationData[] {
    return recipientIds
      .filter((recipientId) => recipientId !== actorId)
      .map((recipientId) => ({
        recipientId,
        type: message.type,
        title: message.title,
        body: message.body,
        entityType: ENTITY_TYPE,
        entityId: message.transfer.id,
        actorId,
      }));
  }

  /** "3 items" / "1 item" — pluralised once, so no message has to think about it. */
  private itemCount(transfer: StockTransfer): string {
    const count = transfer.lineCount;
    return `${count} item${count === 1 ? '' : 's'}`;
  }
}
