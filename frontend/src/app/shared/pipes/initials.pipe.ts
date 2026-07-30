import { Pipe, type PipeTransform } from '@angular/core';

/**
 * Reduces a name to up to two initials, for avatar placeholders.
 *
 * `pure` (the default) so it is recomputed only when the input changes.
 */
@Pipe({
  name: 'pbInitials',
})
export class InitialsPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (value === null || value === undefined) {
      return '';
    }

    const parts = value
      .trim()
      .split(/\s+/)
      .filter((part) => part.length > 0);

    if (parts.length === 0) {
      return '';
    }

    // First and last word, so "Marie Claire Dupont" gives "MD" rather than "MC".
    const first = parts[0]?.charAt(0) ?? '';
    const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';

    return `${first}${last}`.toUpperCase();
  }
}
