import { NotificationType } from '../../../domain/enums/notification.enum.js';
import { Role } from '../../../domain/enums/role.enum.js';
import type {
  CreateNotificationData,
  INotificationRepository,
} from '../../../domain/repositories/notification.repository.js';
import type { IUserRepository } from '../../../domain/repositories/user.repository.js';
import type { ILogger } from '../../ports/logger.port.js';

/** Entity type stored on every notification this class writes, for deep-linking. */
const ENTITY_TYPE = 'Purchase';

/** What the message needs to say. Deliberately not the whole aggregate. */
export interface PurchaseRecordedEvent {
  readonly purchaseId: string;
  readonly invoiceNumber: string;
  readonly supplierName: string;
  readonly totalAmount: number;
  readonly lineCount: number;
  readonly actorId: string;
}

/**
 * Announces a recorded supplier invoice.
 *
 * Sits beside `purchase-audit.ts` for the same reason `TransferNotifier` sits beside
 * `transfer-audit.ts`: the audit entry is evidence kept forever, this is a message a
 * person reads once.
 *
 * **Routed to every admin, not to the recorder.** Recording an invoice commits money and
 * silently increases stock, and the person who typed it in already knows they did. The
 * people who need telling are the ones accountable for the spend — which is why a Store
 * Manager recording a bill notifies the admins, and an admin recording one notifies the
 * *other* admins.
 *
 * **Nothing here may throw.** By the time this runs, the invoice and its stock movement
 * have committed. Failing the response afterwards would tell the user their bill was not
 * recorded when it was, and the near-certain next action is to record it again — which is
 * the one mistake in this module that double-counts stock.
 */
export class PurchaseNotifier {
  constructor(
    private readonly notifications: INotificationRepository,
    private readonly users: IUserRepository,
    private readonly logger: ILogger,
  ) {}

  async purchaseRecorded(event: PurchaseRecordedEvent): Promise<void> {
    try {
      const adminIds = await this.users.findIdsByRole(Role.ADMIN);
      const recipients = adminIds.filter((id) => id !== event.actorId);

      if (recipients.length === 0) {
        return;
      }

      const items = `${String(event.lineCount)} item${event.lineCount === 1 ? '' : 's'}`;

      const messages: readonly CreateNotificationData[] = recipients.map((recipientId) => ({
        recipientId,
        type: NotificationType.PURCHASE_COMPLETED,
        title: `Invoice ${event.invoiceNumber} recorded`,
        body: `${formatMoney(event.totalAmount)} to ${event.supplierName} for ${items}. Stock has been added to the Home Warehouse.`,
        entityType: ENTITY_TYPE,
        entityId: event.purchaseId,
        actorId: event.actorId,
      }));

      await this.notifications.createMany(messages);
    } catch (error) {
      this.logger.error('Failed to send purchase notifications', error, {
        purchaseId: event.purchaseId,
        invoiceNumber: event.invoiceNumber,
      });
    }
  }
}

/** `₹8,755.60`. Indian grouping, because every other amount in this app uses it. */
function formatMoney(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
