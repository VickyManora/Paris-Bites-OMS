/**
 * Number, money and date formatting, in one place.
 *
 * These were copy-pasted into nine components before this file existed, and the copies had
 * already diverged: some rounded to whole rupees, some to paise, one dropped the symbol.
 * Formatting is exactly the kind of thing that looks too trivial to share right up until
 * two screens quote different figures for the same value.
 *
 * `en-IN` throughout, deliberately — the app is for one business in one country, and lakh
 * grouping (`₹1,23,456.00`) is what its staff read. Nothing here consults the browser
 * locale, so a laptop set to `en-US` cannot silently reformat the accounts.
 */

const LOCALE = 'en-IN';

/**
 * `₹1,23,456.00` — the default for anything a person will reconcile.
 *
 * Two decimal places always. Paise matter when the figure is being checked against a bank
 * statement, and a total that drops them cannot be added up by hand to match one that does.
 */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }

  return `₹${value.toLocaleString(LOCALE, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * `₹1,23,456` — whole rupees, for tight spaces.
 *
 * For captions, chart axes and tiles where the decimals would truncate the string rather
 * than inform anyone. Never for a figure being reconciled; use `money` there.
 */
export function moneyCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }

  return `₹${Math.round(value).toLocaleString(LOCALE)}`;
}

/** `1,234.567` — quantities. Three decimals, because stock is tracked to grams. */
export function quantity(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—';
  }

  return value.toLocaleString(LOCALE, { maximumFractionDigits: 3 });
}

/** `1,234` — counts. */
export function count(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString(LOCALE);
}

/**
 * A calendar day as `YYYY-MM-DD`, in **local** terms.
 *
 * What `<input type="date">` expects. Built from the local parts rather than
 * `toISOString()`, which would shift to the previous day for anyone east of UTC — the bug
 * that files a Monday's takings under Sunday.
 */
export function toDateInput(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * `27 Jul 2026` from a `YYYY-MM-DD` string.
 *
 * The `T00:00:00` suffix is load-bearing: `new Date('2026-07-27')` is parsed as UTC
 * midnight and then rendered in local time, which displays the 26th in any negative
 * offset. With the time present it is parsed as local midnight and the date survives.
 */
export function calendarDate(iso: string, options?: Intl.DateTimeFormatOptions): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  });
}

/** `27/07/2026, 8:14 pm` from an ISO timestamp. For things that happened at a moment. */
export function timestamp(iso: string | null | undefined): string {
  return iso === null || iso === undefined ? '—' : new Date(iso).toLocaleString(LOCALE);
}

/**
 * `25%`, or `—` when there is nothing to divide by.
 *
 * Null rather than `0%` for a zero denominator: a share of nothing is not zero, and the
 * two get read very differently off a tile.
 */
export function percentOf(part: number, whole: number): string {
  return whole <= 0 ? '—' : `${String(Math.round((part / whole) * 100))}%`;
}

/** `1 item` / `3 items`. Pluralised once so no caller has to think about it. */
export function plural(value: number, singular: string, pluralForm?: string): string {
  return `${String(value)} ${value === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}
