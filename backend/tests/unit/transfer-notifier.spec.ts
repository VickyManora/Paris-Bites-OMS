import { beforeEach, describe, expect, it } from 'vitest';
import {
  StockTransfer,
  type StockTransferProps,
} from '../../src/core/domain/entities/stock-transfer.entity.js';
import {
  InventoryCategory,
  InventoryLocation,
  InventoryUnit,
} from '../../src/core/domain/enums/inventory.enum.js';
import { NotificationType } from '../../src/core/domain/enums/notification.enum.js';
import { Role } from '../../src/core/domain/enums/role.enum.js';
import { StockTransferStatus } from '../../src/core/domain/enums/stock-transfer.enum.js';
import { UserStatus } from '../../src/core/domain/enums/user-status.enum.js';
import type { Notification } from '../../src/core/domain/entities/notification.entity.js';
import type {
  CreateNotificationData,
  INotificationRepository,
  NotificationFilter,
} from '../../src/core/domain/repositories/notification.repository.js';
import { TransferNotifier } from '../../src/core/application/use-cases/transfers/transfer-notifier.js';
import { createPage, type Page, type PageRequest } from '../../src/shared/pagination.js';
import { fakeLogger, FakeUserRepository, makeUser } from './fakes.js';

const REQUESTER_ID = 'manager-1';
const ADMIN_ONE_ID = 'admin-1';
const ADMIN_TWO_ID = 'admin-2';

class FakeNotificationRepository implements INotificationRepository {
  readonly written: CreateNotificationData[] = [];
  /** Set to make every write throw, standing in for a database outage. */
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

  /** Alert de-duplication is not this notifier's concern; nothing has been alerted. */
  async findAlertedEntityIds(): Promise<ReadonlySet<string>> {
    return new Set<string>();
  }
}

function makeTransfer(overrides: Partial<StockTransferProps> = {}): StockTransfer {
  return StockTransfer.fromPersistence({
    id: 'transfer-1',
    reference: 'TR-000001',
    fromLocation: InventoryLocation.HOME_WAREHOUSE,
    toLocation: InventoryLocation.CART,
    status: StockTransferStatus.PENDING,
    notes: null,
    requestedById: REQUESTER_ID,
    requestedByName: 'Store Manager',
    requestedAt: new Date('2026-07-26T08:00:00Z'),
    reviewedById: null,
    reviewedByName: null,
    reviewedAt: null,
    reviewNote: null,
    completedById: null,
    completedByName: null,
    completedAt: null,
    createdAt: new Date('2026-07-26T08:00:00Z'),
    updatedAt: new Date('2026-07-26T08:00:00Z'),
    lines: [
      {
        id: 'line-1',
        itemId: 'item-1',
        quantity: 5,
        itemName: 'Unsalted butter',
        unit: InventoryUnit.KG,
        category: InventoryCategory.DAIRY,
      },
    ],
    ...overrides,
  });
}

describe('TransferNotifier', () => {
  let notifications: FakeNotificationRepository;
  let users: FakeUserRepository;
  let notifier: TransferNotifier;

  beforeEach(() => {
    notifications = new FakeNotificationRepository();
    users = new FakeUserRepository([
      makeUser({ id: REQUESTER_ID, email: 'manager@test.local', role: Role.STORE_MANAGER }),
      makeUser({ id: ADMIN_ONE_ID, email: 'admin1@test.local', role: Role.ADMIN }),
      makeUser({ id: ADMIN_TWO_ID, email: 'admin2@test.local', role: Role.ADMIN }),
    ]);
    notifier = new TransferNotifier(notifications, users, fakeLogger);
  });

  describe('transferRequested', () => {
    it('notifies every admin', async () => {
      await notifier.transferRequested(makeTransfer(), REQUESTER_ID);

      expect(notifications.written.map((entry) => entry.recipientId).sort()).toEqual([
        ADMIN_ONE_ID,
        ADMIN_TWO_ID,
      ]);
      expect(notifications.written[0]?.type).toBe(NotificationType.TRANSFER_REQUESTED);
    });

    it('does not notify a store manager, who cannot approve', async () => {
      await notifier.transferRequested(makeTransfer(), REQUESTER_ID);

      expect(notifications.written.map((entry) => entry.recipientId)).not.toContain(REQUESTER_ID);
    });

    it('skips the admin who raised the request themselves', async () => {
      await notifier.transferRequested(
        makeTransfer({ requestedById: ADMIN_ONE_ID }),
        ADMIN_ONE_ID,
      );

      expect(notifications.written.map((entry) => entry.recipientId)).toEqual([ADMIN_TWO_ID]);
    });

    it('excludes suspended admins, who cannot sign in to read it', async () => {
      users = new FakeUserRepository([
        makeUser({ id: ADMIN_ONE_ID, email: 'admin1@test.local', role: Role.ADMIN }),
        makeUser({
          id: ADMIN_TWO_ID,
          email: 'admin2@test.local',
          role: Role.ADMIN,
          status: UserStatus.SUSPENDED,
        }),
      ]);
      notifier = new TransferNotifier(notifications, users, fakeLogger);

      await notifier.transferRequested(makeTransfer(), REQUESTER_ID);

      expect(notifications.written.map((entry) => entry.recipientId)).toEqual([ADMIN_ONE_ID]);
    });

    it('links the notification back to the transfer', async () => {
      await notifier.transferRequested(makeTransfer(), REQUESTER_ID);

      expect(notifications.written[0]).toMatchObject({
        entityType: 'StockTransfer',
        entityId: 'transfer-1',
        actorId: REQUESTER_ID,
      });
    });
  });

  describe('decisions', () => {
    it('notifies only the requester on approval', async () => {
      await notifier.transferApproved(
        makeTransfer({ status: StockTransferStatus.APPROVED, reviewedByName: 'Paris Admin' }),
        ADMIN_ONE_ID,
      );

      expect(notifications.written).toHaveLength(1);
      expect(notifications.written[0]?.recipientId).toBe(REQUESTER_ID);
      expect(notifications.written[0]?.type).toBe(NotificationType.TRANSFER_APPROVED);
    });

    it('carries the rejection reason, which is the only actionable part', async () => {
      await notifier.transferRejected(
        makeTransfer({ status: StockTransferStatus.REJECTED, reviewedByName: 'Paris Admin' }),
        ADMIN_ONE_ID,
        'Not enough butter until Thursday',
      );

      expect(notifications.written[0]?.body).toContain('Not enough butter until Thursday');
    });

    it('says nothing when the requester received the stock themselves', async () => {
      await notifier.transferCompleted(
        makeTransfer({ status: StockTransferStatus.COMPLETED }),
        REQUESTER_ID,
      );

      expect(notifications.written).toHaveLength(0);
    });
  });

  describe('failure handling', () => {
    /**
     * The load-bearing guarantee. By the time these run the caller has already committed a
     * stock movement, so throwing here would report a failure for work that succeeded.
     */
    it('swallows a repository failure rather than failing the transfer', async () => {
      notifications.failOnWrite = true;

      await expect(notifier.transferRequested(makeTransfer(), REQUESTER_ID)).resolves.toBeUndefined();
    });

    it('swallows a failure to resolve the audience', async () => {
      const brokenUsers = new FakeUserRepository();
      brokenUsers.findIdsByRole = (): Promise<readonly string[]> => {
        throw new Error('connection reset');
      };

      const brokenNotifier = new TransferNotifier(notifications, brokenUsers, fakeLogger);

      await expect(
        brokenNotifier.transferRequested(makeTransfer(), REQUESTER_ID),
      ).resolves.toBeUndefined();
      expect(notifications.written).toHaveLength(0);
    });
  });
});
