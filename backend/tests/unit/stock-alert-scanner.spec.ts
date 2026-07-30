import { beforeEach, describe, expect, it } from 'vitest';
import { InventoryItem } from '../../src/core/domain/entities/inventory-item.entity.js';
import {
  InventoryCategory,
  InventoryItemStatus,
  InventoryLocation,
  InventoryUnit,
} from '../../src/core/domain/enums/inventory.enum.js';
import { NotificationType } from '../../src/core/domain/enums/notification.enum.js';
import { Role } from '../../src/core/domain/enums/role.enum.js';
import { UserStatus } from '../../src/core/domain/enums/user-status.enum.js';
import type { Notification } from '../../src/core/domain/entities/notification.entity.js';
import type {
  CreateNotificationData,
  INotificationRepository,
  NotificationFilter,
} from '../../src/core/domain/repositories/notification.repository.js';
import type {
  IInventoryItemRepository,
  InventorySummary,
} from '../../src/core/domain/repositories/inventory-item.repository.js';
import { StockAlertScanner } from '../../src/core/application/use-cases/notifications/stock-alert-scanner.js';
import { createPage, type Page, type PageRequest } from '../../src/shared/pagination.js';
import { fakeLogger, FakeUserRepository, makeUser } from './fakes.js';

const ADMIN_ID = 'admin-1';
const MANAGER_ID = 'manager-1';
const NOW = new Date('2026-07-28T09:00:00Z');

function makeItem(overrides: Partial<Parameters<typeof InventoryItem.fromPersistence>[0]> = {}) {
  return InventoryItem.fromPersistence({
    id: 'item-1',
    name: 'Dark chocolate',
    category: InventoryCategory.CHOCOLATE,
    unit: InventoryUnit.KG,
    location: InventoryLocation.HOME_WAREHOUSE,
    currentQuantity: 2,
    openingQuantity: 10,
    minimumQuantity: 5,
    purchasePrice: null,
    supplierId: null,
    supplierName: null,
    lowStockAlertEnabled: true,
    batchNumber: null,
    expiryDate: null,
    status: InventoryItemStatus.ACTIVE,
    notes: null,
    createdById: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  });
}

class FakeNotificationRepository implements INotificationRepository {
  readonly written: CreateNotificationData[] = [];
  /** Entity ids to report as already alerted, keyed by type. */
  readonly alerted = new Map<NotificationType, Set<string>>();
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

  /** Records the cutoff it was asked about, so the cooldown window can be asserted. */
  readonly cutoffsAsked: Date[] = [];

  async findAlertedEntityIds(
    type: NotificationType,
    since: Date,
  ): Promise<ReadonlySet<string>> {
    this.cutoffsAsked.push(since);
    return this.alerted.get(type) ?? new Set<string>();
  }

  typesWritten(): NotificationType[] {
    return [...new Set(this.written.map((row) => row.type))];
  }
}

/** Only the two scan queries matter here; the rest of the port is unreachable. */
class FakeInventoryRepository implements IInventoryItemRepository {
  lowStock: InventoryItem[] = [];
  expiring: InventoryItem[] = [];
  expiryCutoffAsked: Date | null = null;

  async findLowStockForAlert(): Promise<InventoryItem[]> {
    return this.lowStock;
  }

  async findExpiringOnOrBefore(date: Date): Promise<InventoryItem[]> {
    this.expiryCutoffAsked = date;
    return this.expiring;
  }

  findById = unsupported;
  findByNameAndLocation = unsupported;
  findMany = unsupported;
  create = unsupported;
  update = unsupported;
  adjustQuantity = unsupported;
  softDelete = unsupported;
  restore = unsupported;
  summary = unsupported as unknown as () => Promise<InventorySummary>;
}

function unsupported(): never {
  throw new Error('not used by the alert scan');
}

describe('StockAlertScanner', () => {
  let notifications: FakeNotificationRepository;
  let items: FakeInventoryRepository;
  let users: FakeUserRepository;
  let scanner: StockAlertScanner;

  beforeEach(() => {
    notifications = new FakeNotificationRepository();
    items = new FakeInventoryRepository();
    users = new FakeUserRepository([
      makeUser({ id: ADMIN_ID, role: Role.ADMIN, status: UserStatus.ACTIVE }),
      makeUser({ id: MANAGER_ID, role: Role.STORE_MANAGER, status: UserStatus.ACTIVE }),
    ]);
    scanner = new StockAlertScanner(items, notifications, users, fakeLogger, {
      expiryWithinDays: 7,
      cooldownHours: 24,
    });
  });

  describe('routing', () => {
    it('sends warehouse shortages to admins, who are the ones who buy', async () => {
      items.lowStock = [makeItem({ location: InventoryLocation.HOME_WAREHOUSE })];

      await scanner.scan(NOW);

      expect(notifications.written).toHaveLength(1);
      expect(notifications.written[0]?.recipientId).toBe(ADMIN_ID);
      expect(notifications.written[0]?.type).toBe(NotificationType.LOW_STOCK);
    });

    it('sends cart shortages to store managers, who raise the transfer', async () => {
      items.lowStock = [makeItem({ id: 'item-2', location: InventoryLocation.CART })];

      await scanner.scan(NOW);

      expect(notifications.written).toHaveLength(1);
      expect(notifications.written[0]?.recipientId).toBe(MANAGER_ID);
    });

    it('sends expiry alerts to admins, because writing off is admin-only', async () => {
      items.expiring = [makeItem({ expiryDate: new Date('2026-07-30T00:00:00Z') })];

      await scanner.scan(NOW);

      expect(notifications.written).toHaveLength(1);
      expect(notifications.written[0]?.recipientId).toBe(ADMIN_ID);
      expect(notifications.written[0]?.type).toBe(NotificationType.EXPIRY_ALERT);
    });

    it('attributes alerts to nobody — they are not somebody’s doing', async () => {
      items.lowStock = [makeItem()];

      await scanner.scan(NOW);

      expect(notifications.written[0]?.actorId).toBeNull();
    });
  });

  describe('de-duplication', () => {
    /**
     * The failure this prevents is the whole reason the cooldown exists: a low item stays
     * low, so an un-deduplicated sweep re-sends it every interval until somebody restocks.
     */
    it('skips an item already alerted about within the cooldown', async () => {
      items.lowStock = [makeItem({ id: 'item-1' }), makeItem({ id: 'item-2', name: 'Milk' })];
      notifications.alerted.set(NotificationType.LOW_STOCK, new Set(['item-1']));

      const result = await scanner.scan(NOW);

      expect(notifications.written).toHaveLength(1);
      expect(notifications.written[0]?.entityId).toBe('item-2');
      expect(result.lowStockItems).toBe(1);
    });

    it('keeps the two alert kinds independent', async () => {
      const item = makeItem({ expiryDate: new Date('2026-07-29T00:00:00Z') });
      items.lowStock = [item];
      items.expiring = [item];
      // Told about the shortage, not about the expiry: the expiry must still go out.
      notifications.alerted.set(NotificationType.LOW_STOCK, new Set(['item-1']));

      await scanner.scan(NOW);

      expect(notifications.typesWritten()).toEqual([NotificationType.EXPIRY_ALERT]);
    });

    it('asks for the cooldown window, not for all time', async () => {
      await scanner.scan(NOW);

      // 24 hours before the scan instant.
      expect(notifications.cutoffsAsked[0]?.toISOString()).toBe('2026-07-27T09:00:00.000Z');
    });
  });

  describe('the per-sweep cap', () => {
    it('defers the excess rather than dropping it, worst first', async () => {
      // 12 low items: two out of stock, the rest merely low with varying shortfalls.
      items.lowStock = Array.from({ length: 12 }, (_, index) =>
        makeItem({
          id: `item-${String(index)}`,
          name: `Item ${String(index)}`,
          currentQuantity: index < 2 ? 0 : 4,
          minimumQuantity: 5,
        }),
      );

      const result = await scanner.scan(NOW);

      expect(notifications.written).toHaveLength(10);
      expect(result.deferred).toBe(2);
      // Out of stock outranks low, so both zero-quantity items are in the first batch.
      const sent = notifications.written.map((row) => row.entityId);
      expect(sent).toContain('item-0');
      expect(sent).toContain('item-1');
    });
  });

  describe('wording', () => {
    it('does not tell anyone an item is "short by 0"', async () => {
      // Exactly on the reorder level: worth acting on, but nothing is missing yet, and
      // "short by 0 kg" reads like a rounding bug and discredits the whole alert.
      items.lowStock = [makeItem({ currentQuantity: 5, minimumQuantity: 5 })];

      await scanner.scan(NOW);

      const body = notifications.written[0]?.body ?? '';
      expect(body).not.toContain('Short by 0');
      expect(body).toContain('exactly its reorder level');
    });

    it('leads with the gap when there is one', async () => {
      items.lowStock = [makeItem({ currentQuantity: 1, minimumQuantity: 5 })];

      await scanner.scan(NOW);

      expect(notifications.written[0]?.body).toContain('Short by 4 kg');
    });
  });

  describe('the expiry window', () => {
    it('looks the configured number of days ahead, to the end of that day', async () => {
      await scanner.scan(NOW);

      // 28 July + 7 days = 4 August, inclusive of the whole day.
      expect(items.expiryCutoffAsked?.toISOString()).toBe('2026-08-04T23:59:59.999Z');
    });

    it('says an item has expired rather than that it expires soon', async () => {
      items.expiring = [makeItem({ expiryDate: new Date('2026-07-20T00:00:00Z') })];

      await scanner.scan(NOW);

      expect(notifications.written[0]?.title).toContain('has expired');
    });
  });

  /**
   * The sweep runs on a timer with no request to fail. An exception escaping it would
   * either be swallowed or take the process down through the unhandled-rejection handler.
   */
  it('never throws when the database is unavailable', async () => {
    items.lowStock = [makeItem()];
    notifications.failOnWrite = true;

    await expect(scanner.scan(NOW)).resolves.toEqual({
      lowStockItems: 0,
      expiringItems: 0,
      notificationsWritten: 0,
      deferred: 0,
    });
  });

  it('writes nothing when there is nothing wrong', async () => {
    const result = await scanner.scan(NOW);

    expect(notifications.written).toHaveLength(0);
    expect(result.notificationsWritten).toBe(0);
  });
});
