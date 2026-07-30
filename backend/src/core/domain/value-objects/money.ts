import { BusinessRuleError } from '../errors/domain-error.js';

/** Matches `Decimal(14, 2)` on every money column. */
export const MONEY_DECIMAL_PLACES = 2;

/** Well past any plausible single invoice, and safely inside `Decimal(14, 2)`. */
export const MONEY_MAX = 99_999_999_999.99;

/** Per-unit rates are `Decimal(14, 4)` — see the schema comment on `unitRate`. */
export const RATE_DECIMAL_PLACES = 4;

const MONEY_FACTOR = 10 ** MONEY_DECIMAL_PLACES;
const RATE_FACTOR = 10 ** RATE_DECIMAL_PLACES;

/**
 * Currency arithmetic that does not drift.
 *
 * Every operation rounds through integer minor units (paise) rather than working in
 * floating point. The reason is the classic one: `0.1 + 0.2 !== 0.3`, and an invoice whose
 * lines sum to one paisa off its stated total is an invoice a human has to reconcile by
 * hand.
 *
 * Half-up rounding, because that is what an invoice does and what a user checking the
 * arithmetic on paper expects. JavaScript's `Math.round` is half-up for positive numbers,
 * which is all this deals with — money here is never negative.
 */
export const Money = {
  /**
   * Rounds a currency value to the stored scale.
   *
   * The `+ Number.EPSILON` nudge handles the case where a product that is mathematically
   * `x.005` lands a hair below it in binary — `1.005` is really `1.00499999...`, which
   * would round down to `1.00` and lose a paisa on an invoice that adds up on paper.
   */
  round(value: number): number {
    return Math.round((value + Number.EPSILON) * MONEY_FACTOR) / MONEY_FACTOR;
  },

  /** Rounds a per-unit rate to its own, finer scale. */
  roundRate(value: number): number {
    return Math.round((value + Number.EPSILON) * RATE_FACTOR) / RATE_FACTOR;
  },

  /**
   * Sums values that are already at currency scale.
   *
   * Adds as integer paise so a hundred lines cannot accumulate the fractional error that
   * repeated float addition produces.
   */
  sum(values: readonly number[]): number {
    const paise = values.reduce((total, value) => total + Math.round(value * MONEY_FACTOR), 0);
    return paise / MONEY_FACTOR;
  },

  /**
   * Validates a monetary input from a user.
   *
   * @throws BusinessRuleError with a field-scoped message, so the HTTP layer can put it
   *   under the offending input.
   */
  normalise(value: number, field: string, { allowZero = true } = {}): number {
    if (!Number.isFinite(value)) {
      throw new BusinessRuleError('Amount must be a number.', {
        [field]: ['Enter a valid amount.'],
      });
    }

    if (value < 0) {
      throw new BusinessRuleError('Amount cannot be negative.', {
        [field]: ['Amount cannot be negative.'],
      });
    }

    if (!allowZero && value === 0) {
      throw new BusinessRuleError('Amount must be greater than zero.', {
        [field]: ['Enter an amount greater than zero.'],
      });
    }

    if (value > MONEY_MAX) {
      throw new BusinessRuleError(`Amount cannot exceed ${MONEY_MAX}.`, {
        [field]: [`Must be ${MONEY_MAX} or less.`],
      });
    }

    return Money.round(value);
  },

  /** Same, at the finer rate scale. */
  normaliseRate(value: number, field: string): number {
    if (!Number.isFinite(value)) {
      throw new BusinessRuleError('Rate must be a number.', {
        [field]: ['Enter a valid rate.'],
      });
    }

    if (value < 0) {
      throw new BusinessRuleError('Rate cannot be negative.', {
        [field]: ['Rate cannot be negative.'],
      });
    }

    if (value > MONEY_MAX) {
      throw new BusinessRuleError(`Rate cannot exceed ${MONEY_MAX}.`, {
        [field]: [`Must be ${MONEY_MAX} or less.`],
      });
    }

    return Money.roundRate(value);
  },
} as const;
