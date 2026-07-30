import { describe, expect, it } from 'vitest';
import { InventoryItem } from '../../src/core/domain/entities/inventory-item.entity.js';
import {
  deriveStockStatus,
  InventoryCategory,
  InventoryItemStatus,
  InventoryLocation,
  InventoryUnit,
  StockStatus,
} from '../../src/core/domain/enums/inventory.enum.js';

function makeItem(overrides: Partial<Parameters<typeof InventoryItem.fromPersistence>[0]> = {}) {
  return InventoryItem.fromPersistence({
    id: 'item-1',
    name: 'Unsalted butter',
    category: InventoryCategory.DAIRY,
    unit: InventoryUnit.KG,
    location: InventoryLocation.HOME_WAREHOUSE,
    currentQuantity: 10,
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

/**
 * The low-stock rule is the single most reused piece of logic in the module — the list
 * filter, the dashboard counts, the row badge and the SQL summary all have to agree with
 * it. These tests pin it down.
 */
describe('deriveStockStatus', () => {
  it('reports out of stock at or below zero', () => {
    expect(deriveStockStatus(0, 5)).toBe(StockStatus.OUT_OF_STOCK);
    expect(deriveStockStatus(-1, 5)).toBe(StockStatus.OUT_OF_STOCK);
  });

  it('reports low stock when at or below the threshold', () => {
    // `<=` not `<`: hitting the reorder point is the moment to reorder.
    expect(deriveStockStatus(5, 5)).toBe(StockStatus.LOW_STOCK);
    expect(deriveStockStatus(4.9, 5)).toBe(StockStatus.LOW_STOCK);
  });

  it('reports in stock above the threshold', () => {
    expect(deriveStockStatus(5.1, 5)).toBe(StockStatus.IN_STOCK);
  });

  it('treats a zero threshold as "not tracked"', () => {
    // Otherwise every item without a threshold would sit permanently in the low-stock
    // list and the warning would stop meaning anything.
    expect(deriveStockStatus(1, 0)).toBe(StockStatus.IN_STOCK);
    expect(deriveStockStatus(0.001, 0)).toBe(StockStatus.IN_STOCK);
  });

  it('still reports zero stock as out, even with no threshold', () => {
    expect(deriveStockStatus(0, 0)).toBe(StockStatus.OUT_OF_STOCK);
  });
});

describe('InventoryItem', () => {
  it('derives stock status from its quantities', () => {
    expect(makeItem({ currentQuantity: 10, minimumQuantity: 5 }).stockStatus).toBe(
      StockStatus.IN_STOCK,
    );
    expect(makeItem({ currentQuantity: 3, minimumQuantity: 5 }).stockStatus).toBe(
      StockStatus.LOW_STOCK,
    );
    expect(makeItem({ currentQuantity: 0, minimumQuantity: 5 }).stockStatus).toBe(
      StockStatus.OUT_OF_STOCK,
    );
  });

  it('counts out-of-stock as needing restocking', () => {
    // Out of stock is the worst case of needing stock; a warning that excluded it would
    // hide the most urgent items.
    expect(makeItem({ currentQuantity: 0, minimumQuantity: 5 }).needsRestocking).toBe(true);
    expect(makeItem({ currentQuantity: 3, minimumQuantity: 5 }).needsRestocking).toBe(true);
    expect(makeItem({ currentQuantity: 10, minimumQuantity: 5 }).needsRestocking).toBe(false);
  });

  it('reports the shortfall to reach the threshold', () => {
    expect(makeItem({ currentQuantity: 3, minimumQuantity: 5 }).shortfall).toBe(2);
    expect(makeItem({ currentQuantity: 0, minimumQuantity: 5 }).shortfall).toBe(5);
  });

  it('reports no shortfall when stock is sufficient', () => {
    expect(makeItem({ currentQuantity: 10, minimumQuantity: 5 }).shortfall).toBe(0);
  });

  it('rounds the shortfall up for discrete units', () => {
    // Ordering 2.5 boxes is not possible.
    const item = makeItem({
      unit: InventoryUnit.BOXES,
      currentQuantity: 2,
      minimumQuantity: 4.5,
    });
    expect(item.shortfall).toBe(3);
  });

  it('formats the quantity with its unit', () => {
    expect(makeItem({ currentQuantity: 12.5, unit: InventoryUnit.KG }).displayQuantity).toBe(
      '12.5 kg',
    );
    expect(makeItem({ currentQuantity: 3, unit: InventoryUnit.BOXES }).displayQuantity).toBe(
      '3 boxes',
    );
  });

  it('is inactive when its status is INACTIVE or it is deleted', () => {
    expect(makeItem().isActive).toBe(true);
    expect(makeItem({ status: InventoryItemStatus.INACTIVE }).isActive).toBe(false);
    expect(makeItem({ deletedAt: new Date() }).isActive).toBe(false);
  });

  it('exposes deletion state', () => {
    expect(makeItem().isDeleted).toBe(false);
    expect(makeItem({ deletedAt: new Date() }).isDeleted).toBe(true);
  });
});

/**
 * The alert toggle must not leak into the stock figures.
 *
 * The temptation is to make silencing an item remove it from the low-stock list too —
 * which would quietly shrink the reorder report and the dashboard counts. These tests
 * pin the separation: `needsRestocking` is a fact about quantities, `shouldAlertLowStock`
 * is a decision about whether to tell anyone.
 */
describe('InventoryItem low-stock alerting', () => {
  it('alerts when restocking is needed and alerts are enabled', () => {
    const item = makeItem({ currentQuantity: 3, minimumQuantity: 5 });
    expect(item.shouldAlertLowStock).toBe(true);
  });

  it('stays silent when alerts are disabled, without denying it is low', () => {
    const item = makeItem({
      currentQuantity: 3,
      minimumQuantity: 5,
      lowStockAlertEnabled: false,
    });

    expect(item.shouldAlertLowStock).toBe(false);
    // The item is still low on stock, and every list and report must keep saying so.
    expect(item.needsRestocking).toBe(true);
    expect(item.stockStatus).toBe(StockStatus.LOW_STOCK);
  });

  it('does not alert for an inactive or deleted item', () => {
    // Nobody is expected to restock something the business has stopped carrying.
    const base = { currentQuantity: 0, minimumQuantity: 5 };
    expect(makeItem({ ...base, status: InventoryItemStatus.INACTIVE }).shouldAlertLowStock).toBe(
      false,
    );
    expect(makeItem({ ...base, deletedAt: new Date() }).shouldAlertLowStock).toBe(false);
  });

  it('does not alert when stock is sufficient', () => {
    expect(makeItem({ currentQuantity: 10, minimumQuantity: 5 }).shouldAlertLowStock).toBe(false);
  });
});

describe('InventoryItem stock value', () => {
  it('multiplies quantity by price, at currency scale', () => {
    expect(makeItem({ currentQuantity: 4, purchasePrice: 250.5 }).stockValue).toBe(1002);
    // 2.5 x 199.9999 = 499.99975, which a report prints as 500.00.
    expect(makeItem({ currentQuantity: 2.5, purchasePrice: 199.9999 }).stockValue).toBe(500);
  });

  it('is null when the item has no price', () => {
    // Null, not 0: "worth nothing" and "not priced" are different facts, and a valuation
    // report that totals the second as the first understates the inventory.
    expect(makeItem({ currentQuantity: 10, purchasePrice: null }).stockValue).toBeNull();
  });

  it('is zero for a priced item with no stock', () => {
    expect(makeItem({ currentQuantity: 0, purchasePrice: 120 }).stockValue).toBe(0);
  });
});

describe('InventoryItem expiry', () => {
  const reference = new Date('2026-07-27T18:30:00Z');

  it('never expires without an expiry date', () => {
    // Most of this inventory — bowls, spoons, stickers — genuinely does not expire.
    expect(makeItem({ expiryDate: null }).isExpiredAsOf(reference)).toBe(false);
  });

  it('is not expired on the expiry day itself', () => {
    const item = makeItem({ expiryDate: new Date('2026-07-27T00:00:00Z') });
    expect(item.isExpiredAsOf(reference)).toBe(false);
  });

  it('is expired the day after', () => {
    const item = makeItem({ expiryDate: new Date('2026-07-26T00:00:00Z') });
    expect(item.isExpiredAsOf(reference)).toBe(true);
  });

  it('is not expired before the date', () => {
    const item = makeItem({ expiryDate: new Date('2026-08-01T00:00:00Z') });
    expect(item.isExpiredAsOf(reference)).toBe(false);
  });

  it('compares by calendar day, not by instant', () => {
    // The reference is late in the UTC day; the stock still has today to be used.
    const item = makeItem({ expiryDate: new Date('2026-07-27T00:00:00Z') });
    expect(item.isExpiredAsOf(new Date('2026-07-27T23:59:59Z'))).toBe(false);
    expect(item.isExpiredAsOf(new Date('2026-07-28T00:00:01Z'))).toBe(true);
  });
});
