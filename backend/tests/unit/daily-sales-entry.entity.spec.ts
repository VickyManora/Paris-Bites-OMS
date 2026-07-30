import { describe, expect, it } from 'vitest';
import {
  DailySalesEntry,
  type DailySalesLineProps,
} from '../../src/core/domain/entities/daily-sales-entry.entity.js';
import { SalesChannel, SalesPaymentMode } from '../../src/core/domain/enums/sales.enum.js';

function line(
  channel: SalesChannel,
  paymentMode: SalesPaymentMode,
  amount: number,
): DailySalesLineProps {
  return { id: `${channel}-${paymentMode}`, channel, paymentMode, amount };
}

function makeEntry(lines: DailySalesLineProps[], overrides: Record<string, unknown> = {}) {
  return DailySalesEntry.fromPersistence({
    id: 'entry-1',
    entryDate: new Date('2026-07-28T00:00:00Z'),
    totalAmount: Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100,
    notes: null,
    revision: 1,
    recordedById: 'admin-1',
    recordedByName: 'Paris Admin',
    createdAt: new Date('2026-07-28T20:00:00Z'),
    updatedAt: new Date('2026-07-28T20:00:00Z'),
    deletedAt: null,
    lines,
    revisions: [],
    ...overrides,
  });
}

/** A representative trading day: counter takings split by tender, plus both platforms. */
const TRADING_DAY = [
  line(SalesChannel.WALK_IN, SalesPaymentMode.CASH, 4200),
  line(SalesChannel.WALK_IN, SalesPaymentMode.ONLINE, 1800),
  line(SalesChannel.ZOMATO, SalesPaymentMode.ONLINE, 1100),
  line(SalesChannel.SWIGGY, SalesPaymentMode.ONLINE, 900),
];

describe('DailySalesEntry', () => {
  describe('splitting the day up', () => {
    it('totals one channel across its payment modes', () => {
      const entry = makeEntry(TRADING_DAY);

      expect(entry.amountForChannel(SalesChannel.WALK_IN)).toBe(6000);
      expect(entry.amountForChannel(SalesChannel.ZOMATO)).toBe(1100);
    });

    it('reports zero for a channel that took nothing', () => {
      const entry = makeEntry([line(SalesChannel.WALK_IN, SalesPaymentMode.CASH, 500)]);

      expect(entry.amountForChannel(SalesChannel.SWIGGY)).toBe(0);
    });

    /** The figure someone counts at the end of the night. */
    it('separates cash from everything settled digitally', () => {
      const entry = makeEntry(TRADING_DAY);

      expect(entry.cashTotal).toBe(4200);
      expect(entry.onlineTotal).toBe(3800);
      expect(entry.cashTotal + entry.onlineTotal).toBe(entry.totalAmount);
    });

    it('separates own counter from the platforms', () => {
      const entry = makeEntry(TRADING_DAY);

      expect(entry.walkInTotal).toBe(6000);
      expect(entry.aggregatorTotal).toBe(2000);
      expect(entry.walkInTotal + entry.aggregatorTotal).toBe(entry.totalAmount);
    });
  });

  describe('aggregator share', () => {
    it('is a percentage of the day', () => {
      expect(makeEntry(TRADING_DAY).aggregatorSharePercent).toBe(25);
    });

    /**
     * A closed day is not a day on which the platforms happened to sell nothing.
     * Plotting 0% for it would invent a trend out of a day that had no trade at all.
     */
    it('is null on a day with no trade rather than zero', () => {
      expect(makeEntry([]).aggregatorSharePercent).toBeNull();
    });
  });

  describe('rounding', () => {
    /** Money must not drift: the parts have to add back up to the whole. */
    it('keeps the split adding up on awkward amounts', () => {
      const entry = makeEntry([
        line(SalesChannel.WALK_IN, SalesPaymentMode.CASH, 33.33),
        line(SalesChannel.WALK_IN, SalesPaymentMode.ONLINE, 33.33),
        line(SalesChannel.ZOMATO, SalesPaymentMode.ONLINE, 33.34),
      ]);

      expect(entry.totalAmount).toBe(100);
      expect(entry.cashTotal).toBe(33.33);
      expect(entry.onlineTotal).toBe(66.67);
      expect(entry.cashTotal + entry.onlineTotal).toBe(100);
    });
  });

  describe('presentation helpers', () => {
    it('exposes the date as a calendar day, never a timestamp', () => {
      expect(makeEntry(TRADING_DAY).entryDateIso).toBe('2026-07-28');
    });

    it('names only the channels that actually took money', () => {
      const entry = makeEntry([
        line(SalesChannel.WALK_IN, SalesPaymentMode.CASH, 500),
        line(SalesChannel.ZOMATO, SalesPaymentMode.ONLINE, 0),
      ]);

      expect(entry.activeChannelLabels).toBe('Walk-in');
    });

    it('does not name a channel twice when both tenders were used', () => {
      const entry = makeEntry([
        line(SalesChannel.WALK_IN, SalesPaymentMode.CASH, 500),
        line(SalesChannel.WALK_IN, SalesPaymentMode.ONLINE, 200),
      ]);

      expect(entry.activeChannelLabels).toBe('Walk-in');
    });

    it('flags a day that has been corrected', () => {
      expect(makeEntry(TRADING_DAY).isEdited).toBe(false);
      expect(makeEntry(TRADING_DAY, { revision: 2 }).isEdited).toBe(true);
    });
  });
});
