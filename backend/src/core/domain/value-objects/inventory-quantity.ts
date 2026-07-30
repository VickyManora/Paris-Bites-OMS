import { isDiscreteUnit, type InventoryUnit } from '../enums/inventory.enum.js';
import { BusinessRuleError } from '../errors/domain-error.js';

/** Matches `Decimal(12, 3)` in the schema. */
export const QUANTITY_DECIMAL_PLACES = 3;
export const QUANTITY_MAX = 999_999_999.999;

/**
 * Rules that every quantity in the system must satisfy.
 *
 * Centralised here rather than repeated in each use case, because the interesting
 * cases are easy to get subtly wrong:
 *
 * - **Rounding, not rejecting, excess precision.** `0.0001 kg` is a legitimate thing
 *   for a user to type; the column stores three decimal places, so the value is
 *   rounded rather than refused. Refusing would be pedantic; silently truncating
 *   would lose the last digit inconsistently.
 * - **Discrete units reject fractions outright.** "3.5 boxes" is not a rounding
 *   problem, it is a meaningless quantity, so it is an error rather than a value to
 *   fix up.
 * - **Floating-point cleanup.** `Number.EPSILON` noise from arithmetic (0.1 + 0.2)
 *   is removed by rounding at a fixed scale before the value ever reaches the
 *   database.
 */
export const InventoryQuantity = {
  /**
   * Validates and normalises a quantity for a given unit.
   *
   * @throws BusinessRuleError with a field-scoped message, so the HTTP layer can put
   *   it under the offending input.
   */
  normalise(value: number, unit: InventoryUnit, field = 'quantity'): number {
    if (!Number.isFinite(value)) {
      throw new BusinessRuleError('Quantity must be a number.', {
        [field]: ['Enter a valid number.'],
      });
    }

    if (value < 0) {
      throw new BusinessRuleError('Quantity cannot be negative.', {
        [field]: ['Quantity cannot be negative.'],
      });
    }

    if (value > QUANTITY_MAX) {
      throw new BusinessRuleError(`Quantity cannot exceed ${QUANTITY_MAX}.`, {
        [field]: [`Must be ${QUANTITY_MAX} or less.`],
      });
    }

    if (isDiscreteUnit(unit) && !Number.isInteger(value)) {
      throw new BusinessRuleError('This unit only accepts whole numbers.', {
        [field]: ['Enter a whole number for pieces and boxes.'],
      });
    }

    return InventoryQuantity.round(value);
  },

  /** Rounds to the stored scale. Half-up, which is what users expect. */
  round(value: number): number {
    const factor = 10 ** QUANTITY_DECIMAL_PLACES;
    return Math.round(value * factor) / factor;
  },

  /**
   * Applies a signed delta, rejecting a result below zero.
   *
   * Clamping to zero instead would quietly hide a mistake: if someone removes 10 kg
   * from an 8 kg stock, the recorded 8 kg was wrong or the removal was, and both
   * need a human to look rather than a silent zero.
   */
  applyDelta(current: number, delta: number, unit: InventoryUnit): number {
    if (!Number.isFinite(delta)) {
      throw new BusinessRuleError('Adjustment must be a number.', {
        delta: ['Enter a valid number.'],
      });
    }

    if (delta === 0) {
      throw new BusinessRuleError('Adjustment cannot be zero.', {
        delta: ['Enter a non-zero adjustment.'],
      });
    }

    if (isDiscreteUnit(unit) && !Number.isInteger(delta)) {
      throw new BusinessRuleError('This unit only accepts whole numbers.', {
        delta: ['Enter a whole number for pieces and boxes.'],
      });
    }

    const next = InventoryQuantity.round(current + delta);

    if (next < 0) {
      throw new BusinessRuleError(`Cannot remove ${Math.abs(delta)} — only ${current} in stock.`, {
        delta: [`Only ${current} available.`],
      });
    }

    return InventoryQuantity.normalise(next, unit, 'delta');
  },
} as const;
