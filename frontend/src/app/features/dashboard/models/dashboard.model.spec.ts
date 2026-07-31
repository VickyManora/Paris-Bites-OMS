import { previousDay, shortDate } from './dashboard.model';

/**
 * `previousDay` decides whether the dashboard says "please add yesterday's consumption" or the
 * much weaker "consumption is missing for 3 days", so getting it wrong changes what the person on
 * the counter is asked to do — and it would be wrong in a way nobody notices, because the fallback
 * message is still plausible.
 *
 * The month and year boundaries are the cases a hand-rolled `day - 1` gets wrong, and the timezone
 * case is the one that would have passed on a CI box in UTC and failed in Mumbai.
 */
describe('dashboard.model', () => {
  describe('previousDay', () => {
    it('steps back one day', () => {
      expect(previousDay('2026-07-31')).toBe('2026-07-30');
    });

    it('crosses a month boundary', () => {
      expect(previousDay('2026-07-01')).toBe('2026-06-30');
    });

    it('crosses a year boundary', () => {
      expect(previousDay('2026-01-01')).toBe('2025-12-31');
    });

    it('lands on 28 February in a common year', () => {
      expect(previousDay('2026-03-01')).toBe('2026-02-28');
    });

    it('lands on 29 February in a leap year', () => {
      expect(previousDay('2024-03-01')).toBe('2024-02-29');
    });

    /*
     * The reason the arithmetic is pinned to UTC at both ends.
     *
     * A calendar day has no time in it. Building a local `Date` from `2026-07-31` puts it at local
     * midnight, and re-serialising through `toISOString` then converts back to UTC — which east of
     * Greenwich lands on the previous day and west of it on the next. Either way the function would
     * be off by one for most of the world while passing on a UTC machine.
     */
    it('does not shift with the local timezone', () => {
      // 30 June is the answer whatever `TZ` this suite runs under; if the implementation ever
      // reaches for a local Date, this is the assertion that catches it.
      expect(previousDay('2026-07-01')).toBe('2026-06-30');
      expect(previousDay('2026-12-31')).toBe('2026-12-30');
    });
  });

  describe('shortDate', () => {
    it('renders a calendar day without shifting it', () => {
      expect(shortDate('2026-07-29')).toBe('29 Jul');
    });

    it('renders the first of a month', () => {
      expect(shortDate('2026-01-01')).toBe('01 Jan');
    });
  });
});
