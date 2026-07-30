import { Pipe, type PipeTransform } from '@angular/core';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * Renders an ISO timestamp as "just now" / "5m ago" / "3d ago".
 *
 * For a notification feed the *distance* is what matters — whether something needs
 * attention now — and an absolute time makes the reader do that subtraction themselves.
 * Past a week the distance stops being useful and an actual date is clearer, so it falls
 * back to one.
 *
 * `pure`, which means it does not tick: an entry rendered at "just now" still reads that
 * way a minute later, until something re-renders it. That is the right trade for a panel
 * that is opened, read and closed — an impure pipe recomputing on every change detection
 * cycle costs far more than the staleness is worth. The panel refetches on open, which is
 * when accuracy actually matters.
 */
@Pipe({
  name: 'pbRelativeTime',
})
export class RelativeTimePipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    if (value === null || value === undefined) {
      return '';
    }

    const date = value instanceof Date ? value : new Date(value);
    const time = date.getTime();

    if (Number.isNaN(time)) {
      return '';
    }

    // Clamped at zero: a clock skew of a few seconds between server and browser must not
    // produce "in 3 seconds" on something that has already happened.
    const elapsed = Math.max(Date.now() - time, 0);

    if (elapsed < MINUTE_MS) {
      return 'just now';
    }

    if (elapsed < HOUR_MS) {
      return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
    }

    if (elapsed < DAY_MS) {
      return `${Math.floor(elapsed / HOUR_MS)}h ago`;
    }

    if (elapsed < WEEK_MS) {
      return `${Math.floor(elapsed / DAY_MS)}d ago`;
    }

    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
}
