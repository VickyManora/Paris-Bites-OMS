import { describe, expect, it } from 'vitest';
import {
  StockTransfer,
  type StockTransferProps,
} from '../../src/core/domain/entities/stock-transfer.entity.js';
import {
  InventoryCategory,
  InventoryLocation,
  InventoryUnit,
} from '../../src/core/domain/enums/inventory.enum.js';
import {
  ALL_TRANSFER_STATUSES,
  canTransition,
  isInTransit,
  isTerminalStatus,
  StockTransferStatus,
} from '../../src/core/domain/enums/stock-transfer.enum.js';
import { BusinessRuleError } from '../../src/core/domain/errors/domain-error.js';

function makeTransfer(overrides: Partial<StockTransferProps> = {}): StockTransfer {
  return StockTransfer.fromPersistence({
    id: 'transfer-1',
    reference: 'TR-000001',
    fromLocation: InventoryLocation.HOME_WAREHOUSE,
    toLocation: InventoryLocation.CART,
    status: StockTransferStatus.PENDING,
    notes: null,
    requestedById: 'user-1',
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

/**
 * The state machine decides when stock is allowed to move, so it is pinned down here rather
 * than only exercised through the API.
 */
describe('Stock transfer state machine', () => {
  it('allows approve and reject only from pending', () => {
    expect(canTransition(StockTransferStatus.PENDING, StockTransferStatus.APPROVED)).toBe(true);
    expect(canTransition(StockTransferStatus.PENDING, StockTransferStatus.REJECTED)).toBe(true);
  });

  it('allows complete only from approved', () => {
    expect(canTransition(StockTransferStatus.APPROVED, StockTransferStatus.COMPLETED)).toBe(true);
  });

  it('never allows completing without approval', () => {
    // Skipping approval would move stock with nobody having authorised it.
    expect(canTransition(StockTransferStatus.PENDING, StockTransferStatus.COMPLETED)).toBe(false);
  });

  it('never allows rejecting after dispatch', () => {
    // The source has already been deducted; "rejecting" would leave the stock nowhere.
    expect(canTransition(StockTransferStatus.APPROVED, StockTransferStatus.REJECTED)).toBe(false);
  });

  it('treats rejected and completed as terminal', () => {
    expect(isTerminalStatus(StockTransferStatus.REJECTED)).toBe(true);
    expect(isTerminalStatus(StockTransferStatus.COMPLETED)).toBe(true);
    expect(isTerminalStatus(StockTransferStatus.PENDING)).toBe(false);
    expect(isTerminalStatus(StockTransferStatus.APPROVED)).toBe(false);
  });

  it('allows no transition at all out of a terminal state', () => {
    for (const terminal of [StockTransferStatus.REJECTED, StockTransferStatus.COMPLETED]) {
      for (const target of ALL_TRANSFER_STATUSES) {
        expect(canTransition(terminal, target)).toBe(false);
      }
    }
  });

  it('reports only approved as in transit', () => {
    // The one state where stock is neither at the source nor the destination.
    expect(isInTransit(StockTransferStatus.APPROVED)).toBe(true);
    expect(isInTransit(StockTransferStatus.PENDING)).toBe(false);
    expect(isInTransit(StockTransferStatus.COMPLETED)).toBe(false);
  });
});

describe('StockTransfer guards', () => {
  it('permits approving and rejecting a pending transfer', () => {
    expect(() => makeTransfer().assertCanApprove()).not.toThrow();
    expect(() => makeTransfer().assertCanReject()).not.toThrow();
  });

  it('refuses completing a pending transfer', () => {
    expect(() => makeTransfer().assertCanComplete()).toThrow(BusinessRuleError);
  });

  it('names the current status when refusing', () => {
    // "Cannot approve" alone leaves the user guessing whether someone else already did it.
    try {
      makeTransfer({ status: StockTransferStatus.REJECTED }).assertCanApprove();
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleError).message).toContain('rejected');
      expect((error as BusinessRuleError).message).toContain('TR-000001');
    }
  });

  it('distinguishes "already done" from "wrong state"', () => {
    // A double submit is the common case and deserves its own wording.
    try {
      makeTransfer({ status: StockTransferStatus.APPROVED }).assertCanApprove();
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleError).message).toMatch(/already been approved/);
    }
  });

  it('permits completing a dispatched transfer', () => {
    expect(() =>
      makeTransfer({ status: StockTransferStatus.APPROVED }).assertCanComplete(),
    ).not.toThrow();
  });

  it('refuses every action on a completed transfer', () => {
    const completed = makeTransfer({ status: StockTransferStatus.COMPLETED });
    expect(() => completed.assertCanApprove()).toThrow(BusinessRuleError);
    expect(() => completed.assertCanReject()).toThrow(BusinessRuleError);
    expect(() => completed.assertCanComplete()).toThrow(BusinessRuleError);
  });
});

describe('StockTransfer derived values', () => {
  it('sums line quantities without floating-point drift', () => {
    const transfer = makeTransfer({
      lines: [
        {
          id: 'l1',
          itemId: 'i1',
          quantity: 0.1,
          itemName: 'A',
          unit: InventoryUnit.KG,
          category: InventoryCategory.DAIRY,
        },
        {
          id: 'l2',
          itemId: 'i2',
          quantity: 0.2,
          itemName: 'B',
          unit: InventoryUnit.KG,
          category: InventoryCategory.DAIRY,
        },
      ],
    });

    expect(transfer.totalQuantity).toBe(0.3);
  });

  it('reports the line count', () => {
    expect(makeTransfer().lineCount).toBe(1);
  });

  it('reports pending and in-transit state', () => {
    expect(makeTransfer().isPending).toBe(true);
    expect(makeTransfer().isInTransit).toBe(false);
    expect(makeTransfer({ status: StockTransferStatus.APPROVED }).isInTransit).toBe(true);
  });
});
