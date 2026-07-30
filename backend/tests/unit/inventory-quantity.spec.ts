import { describe, expect, it } from 'vitest';
import { InventoryUnit } from '../../src/core/domain/enums/inventory.enum.js';
import { BusinessRuleError } from '../../src/core/domain/errors/domain-error.js';
import {
  InventoryQuantity,
  QUANTITY_MAX,
} from '../../src/core/domain/value-objects/inventory-quantity.js';

describe('InventoryQuantity.normalise', () => {
  it('accepts a valid fractional quantity for a continuous unit', () => {
    expect(InventoryQuantity.normalise(12.5, InventoryUnit.KG)).toBe(12.5);
  });

  it('rounds excess precision to three decimal places rather than rejecting it', () => {
    // The column stores 3dp. Refusing 0.0001 kg would be pedantic; truncating would
    // lose the digit inconsistently.
    expect(InventoryQuantity.normalise(1.23456, InventoryUnit.KG)).toBe(1.235);
    expect(InventoryQuantity.normalise(0.0001, InventoryUnit.KG)).toBe(0);
  });

  it('rejects fractions for discrete units', () => {
    // "2.5 boxes" is meaningless, not a rounding problem.
    expect(() => InventoryQuantity.normalise(2.5, InventoryUnit.BOXES)).toThrow(BusinessRuleError);
    expect(() => InventoryQuantity.normalise(2.5, InventoryUnit.PIECES)).toThrow(BusinessRuleError);
  });

  it('accepts whole numbers for discrete units', () => {
    expect(InventoryQuantity.normalise(3, InventoryUnit.BOXES)).toBe(3);
  });

  it('rejects negatives, infinities and NaN', () => {
    expect(() => InventoryQuantity.normalise(-1, InventoryUnit.KG)).toThrow(BusinessRuleError);
    expect(() => InventoryQuantity.normalise(Number.NaN, InventoryUnit.KG)).toThrow(
      BusinessRuleError,
    );
    expect(() => InventoryQuantity.normalise(Number.POSITIVE_INFINITY, InventoryUnit.KG)).toThrow(
      BusinessRuleError,
    );
  });

  it('rejects values above the column maximum', () => {
    expect(() => InventoryQuantity.normalise(QUANTITY_MAX + 1, InventoryUnit.KG)).toThrow(
      BusinessRuleError,
    );
  });

  it('accepts zero', () => {
    expect(InventoryQuantity.normalise(0, InventoryUnit.KG)).toBe(0);
  });

  it('scopes the error to the named field so a form can show it', () => {
    try {
      InventoryQuantity.normalise(-1, InventoryUnit.KG, 'minimumQuantity');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessRuleError);
      expect((error as BusinessRuleError).details?.['minimumQuantity']).toBeDefined();
    }
  });
});

describe('InventoryQuantity.applyDelta', () => {
  it('adds and removes', () => {
    expect(InventoryQuantity.applyDelta(10, 5, InventoryUnit.KG)).toBe(15);
    expect(InventoryQuantity.applyDelta(10, -4, InventoryUnit.KG)).toBe(6);
  });

  it('does not accumulate floating-point drift', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in binary floating point. Rounding at the stored
    // scale is what keeps stock levels from slowly becoming wrong.
    let quantity = 0;
    for (let i = 0; i < 10; i += 1) {
      quantity = InventoryQuantity.applyDelta(quantity, 0.1, InventoryUnit.KG);
    }
    expect(quantity).toBe(1);
  });

  it('allows removing exactly the remaining stock', () => {
    expect(InventoryQuantity.applyDelta(8, -8, InventoryUnit.KG)).toBe(0);
  });

  it('rejects removing more than is in stock instead of clamping to zero', () => {
    // Clamping would hide a real discrepancy: either the recorded stock was wrong or the
    // withdrawal was, and both need a human to look.
    expect(() => InventoryQuantity.applyDelta(8, -10, InventoryUnit.KG)).toThrow(BusinessRuleError);
  });

  it('says how much is actually available', () => {
    try {
      InventoryQuantity.applyDelta(8, -10, InventoryUnit.KG);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as BusinessRuleError).message).toContain('8');
    }
  });

  it('rejects a zero delta', () => {
    expect(() => InventoryQuantity.applyDelta(10, 0, InventoryUnit.KG)).toThrow(BusinessRuleError);
  });

  it('rejects a fractional delta for a discrete unit', () => {
    expect(() => InventoryQuantity.applyDelta(10, 1.5, InventoryUnit.BOXES)).toThrow(
      BusinessRuleError,
    );
  });

  it('rejects a non-finite delta', () => {
    expect(() => InventoryQuantity.applyDelta(10, Number.NaN, InventoryUnit.KG)).toThrow(
      BusinessRuleError,
    );
  });
});
