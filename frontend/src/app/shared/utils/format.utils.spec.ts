import {
  calendarDate,
  count,
  money,
  moneyCompact,
  percentOf,
  plural,
  quantity,
  timestamp,
  toDateInput,
} from './format.utils';

/**
 * These functions were copy-pasted into nine components before they lived here, and the
 * copies had already diverged on decimal places. They are now the single definition of how
 * this app renders a figure, which makes them worth pinning down.
 */
describe('format.utils', () => {
  describe('money', () => {
    it('uses lakh grouping, not thousands', () => {
      // ₹1,23,456 — not ₹123,456. This is the whole reason the locale is hard-coded.
      expect(money(123456)).toBe('₹1,23,456.00');
    });

    it('always shows paise', () => {
      expect(money(1416)).toBe('₹1,416.00');
      expect(money(1416.5)).toBe('₹1,416.50');
    });

    it('renders an em dash for absent values rather than ₹0.00', () => {
      // "we have not priced this" and "it costs nothing" are different facts.
      expect(money(null)).toBe('—');
      expect(money(undefined)).toBe('—');
    });

    it('keeps a real zero as zero', () => {
      expect(money(0)).toBe('₹0.00');
    });

    it('does not consult the browser locale', () => {
      // A laptop set to en-US must not reformat the accounts.
      expect(money(1234.5)).toContain('₹');
      expect(money(1234.5)).toBe('₹1,234.50');
    });
  });

  describe('moneyCompact', () => {
    it('rounds to whole rupees for tight spaces', () => {
      expect(moneyCompact(7048.4)).toBe('₹7,048');
      expect(moneyCompact(7048.6)).toBe('₹7,049');
    });

    it('renders an em dash for absent values', () => {
      expect(moneyCompact(null)).toBe('—');
    });
  });

  describe('quantity', () => {
    it('keeps three decimals, because stock is tracked to grams', () => {
      expect(quantity(1.234)).toBe('1.234');
    });

    it('does not pad whole numbers', () => {
      expect(quantity(20)).toBe('20');
    });
  });

  describe('count', () => {
    it('groups thousands', () => {
      expect(count(1234)).toBe('1,234');
    });
  });

  describe('toDateInput', () => {
    /**
     * The bug this prevents: `toISOString()` on a local-midnight Date shifts to the
     * previous day for any negative UTC offset, which files a Monday's takings under
     * Sunday.
     */
    it('uses local parts, so the day never shifts', () => {
      const localMidnight = new Date(2026, 6, 27, 0, 0, 0);
      expect(toDateInput(localMidnight)).toBe('2026-07-27');
    });

    it('pads single-digit months and days', () => {
      expect(toDateInput(new Date(2026, 0, 5))).toBe('2026-01-05');
    });

    it('survives a late-evening time', () => {
      // 23:30 local is the following day in UTC for positive offsets; the date must not move.
      expect(toDateInput(new Date(2026, 6, 27, 23, 30))).toBe('2026-07-27');
    });
  });

  describe('calendarDate', () => {
    /**
     * `new Date('2026-07-27')` is parsed as UTC midnight and rendered locally, which shows
     * the 26th in any negative offset. The `T00:00:00` suffix is what prevents it.
     */
    it('renders the day it was given', () => {
      expect(calendarDate('2026-07-27')).toContain('27');
      expect(calendarDate('2026-07-27')).toContain('Jul');
      expect(calendarDate('2026-07-27')).toContain('2026');
    });

    it('accepts overrides', () => {
      expect(calendarDate('2026-07-27', { weekday: 'short' })).toContain('Mon');
    });
  });

  describe('timestamp', () => {
    it('renders an em dash for absent values', () => {
      expect(timestamp(null)).toBe('—');
      expect(timestamp(undefined)).toBe('—');
    });

    it('formats an ISO instant', () => {
      expect(timestamp('2026-07-27T14:30:00.000Z')).toContain('2026');
    });
  });

  describe('percentOf', () => {
    it('rounds to a whole percent', () => {
      expect(percentOf(25, 100)).toBe('25%');
      expect(percentOf(1, 3)).toBe('33%');
    });

    /** A share of nothing is not 0% — the two read very differently off a tile. */
    it('returns an em dash when there is nothing to divide by', () => {
      expect(percentOf(0, 0)).toBe('—');
      expect(percentOf(5, -1)).toBe('—');
    });
  });

  describe('plural', () => {
    it('uses the singular for exactly one', () => {
      expect(plural(1, 'invoice')).toBe('1 invoice');
    });

    it('adds an s otherwise', () => {
      expect(plural(0, 'invoice')).toBe('0 invoices');
      expect(plural(3, 'invoice')).toBe('3 invoices');
    });

    it('accepts an irregular plural', () => {
      expect(plural(2, 'entry', 'entries')).toBe('2 entries');
    });
  });
});
