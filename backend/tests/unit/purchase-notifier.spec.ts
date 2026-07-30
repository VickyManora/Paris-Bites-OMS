import { beforeEach, describe, expect, it } from 'vitest';
import { NotificationType } from '../../src/core/domain/enums/notification.enum.js';
import { Role } from '../../src/core/domain/enums/role.enum.js';
import { UserStatus } from '../../src/core/domain/enums/user-status.enum.js';
import type { Notification } from '../../src/core/domain/entities/notification.entity.js';
import type {
  CreateNotificationData,
  INotificationRepository,
  NotificationFilter,
} from '../../src/core/domain/repositories/notification.repository.js';
import {
  PurchaseNotifier,
  type PurchaseRecordedEvent,
} from '../../src/core/application/use-cases/purchases/purchase-notifier.js';
import { createPage, type Page, type PageRequest } from '../../src/shared/pagination.js';
import { fakeLogger, FakeUserRepository, makeUser } from './fakes.js';

const ADMIN_ONE_ID = 'admin-1';
const ADMIN_TWO_ID = 'admin-2';
const MANAGER_ID = 'manager-1';

class FakeNotificationRepository implements INotificationRepository {
  readonly written: CreateNotificationData[] = [];
  failOnWrite = false;

  async createMany(data: readonly CreateNotificationData[]): Promise<number> {
    if (this.failOnWrite) {
      throw new Error('database unavailable');
    }

    this.written.push(...data);
    return data.length;
  }

  async findMany(_filter: NotificationFilter, page: PageRequest): Promise<Page<Notification>> {
    return createPage([], 0, page);
  }

  async countUnread(): Promise<number> {
    return 0;
  }

  async markRead(): Promise<boolean> {
    return true;
  }

  async markAllRead(): Promise<number> {
    return 0;
  }

  async findAlertedEntityIds(): Promise<ReadonlySet<string>> {
    return new Set<string>();
  }
}

function event(overrides: Partial<PurchaseRecordedEvent> = {}): PurchaseRecordedEvent {
  return {
    purchaseId: 'purchase-1',
    invoiceNumber: 'INV-2026-041',
    supplierName: 'Gurukripa Enterprices',
    totalAmount: 8755.6,
    lineCount: 3,
    actorId: MANAGER_ID,
    ...overrides,
  };
}

describe('PurchaseNotifier', () => {
  let notifications: FakeNotificationRepository;
  let notifier: PurchaseNotifier;

  beforeEach(() => {
    notifications = new FakeNotificationRepository();
    notifier = new PurchaseNotifier(
      notifications,
      new FakeUserRepository([
        makeUser({ id: ADMIN_ONE_ID, role: Role.ADMIN, status: UserStatus.ACTIVE }),
        makeUser({ id: ADMIN_TWO_ID, role: Role.ADMIN, status: UserStatus.ACTIVE }),
        makeUser({ id: MANAGER_ID, role: Role.STORE_MANAGER, status: UserStatus.ACTIVE }),
      ]),
      fakeLogger,
    );
  });

  it('tells every admin when a store manager records a bill', async () => {
    await notifier.purchaseRecorded(event());

    expect(notifications.written.map((row) => row.recipientId).sort()).toEqual([
      ADMIN_ONE_ID,
      ADMIN_TWO_ID,
    ]);
    expect(notifications.written[0]?.type).toBe(NotificationType.PURCHASE_COMPLETED);
  });

  /** A bell that lights up for your own click teaches people to ignore the bell. */
  it('does not notify the admin who recorded it', async () => {
    await notifier.purchaseRecorded(event({ actorId: ADMIN_ONE_ID }));

    expect(notifications.written.map((row) => row.recipientId)).toEqual([ADMIN_TWO_ID]);
  });

  it('states the amount and the supplier, which is what makes it worth reading', async () => {
    await notifier.purchaseRecorded(event());

    const body = notifications.written[0]?.body ?? '';
    expect(body).toContain('₹8,755.60');
    expect(body).toContain('Gurukripa Enterprices');
    expect(body).toContain('3 items');
  });

  it('pluralises a single line correctly', async () => {
    await notifier.purchaseRecorded(event({ lineCount: 1 }));

    expect(notifications.written[0]?.body).toContain('1 item.');
  });

  it('links back to the invoice', async () => {
    await notifier.purchaseRecorded(event());

    expect(notifications.written[0]?.entityType).toBe('Purchase');
    expect(notifications.written[0]?.entityId).toBe('purchase-1');
  });

  /**
   * The invoice and its stock movement have already committed by the time this runs.
   * Throwing here would report a failure for work that succeeded, and the obvious next
   * action — record it again — is the one mistake that double-counts stock.
   */
  it('never throws when notifications cannot be written', async () => {
    notifications.failOnWrite = true;

    await expect(notifier.purchaseRecorded(event())).resolves.toBeUndefined();
  });
});
