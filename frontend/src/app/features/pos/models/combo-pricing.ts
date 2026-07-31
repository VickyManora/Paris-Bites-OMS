import type { CartLine } from './pos.model';

/**
 * The "any 2" offers, mirrored from the server.
 *
 * ## Why this arithmetic exists twice
 *
 * The server is the only thing that decides what a customer is charged — this file cannot change
 * that and does not try to. What it changes is what the cart *shows*. Without it the counter would
 * read ₹478 for two Blueberry bowls, and the customer would be charged ₹399 when the order landed.
 * A total that only becomes correct after payment is worse than no total: the cashier reads the
 * wrong number out loud.
 *
 * So this is a preview, and it is deliberately the same rule rather than an approximation of it —
 * the two agree because they are the same three lines of logic, kept side by side on purpose. The
 * pair prices below are the one thing that has to be edited in both places; they are in
 * `COMBO_OFFER_POLICY` on the server.
 *
 * The same trade already applies to the discount arithmetic in `PosCartStore`, for the same reason:
 * a cart that cannot total itself until it round-trips is not usable at a counter.
 */
const COMBO_OFFERS: readonly {
  readonly categoryName: string;
  readonly pairPrice: number;
  readonly label: string;
}[] = [
  { categoryName: 'Signature Bowls', pairPrice: 299, label: 'Any 2 Signature Bowls' },
  { categoryName: 'Premium Bowls', pairPrice: 399, label: 'Any 2 Premium Bowls' },
];

export interface ComboMatch {
  readonly label: string;
  readonly products: readonly [string, string];
  readonly saving: number;
}

export interface ComboPreview {
  readonly matches: readonly ComboMatch[];
  readonly discount: number;
}

const EMPTY: ComboPreview = { matches: [], discount: 0 };

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * What the automatic offers will take off this cart.
 *
 * Mirrors the server rule exactly:
 *
 * - pairs only within one tier, because the two offers are priced per tier
 * - pairs the **dearest** units first, which is the largest saving available
 * - applies a pair only when it beats paying separately — two Death By Chocolate bowls are ₹298
 *   against a ₹299 combo, so applying it blindly would charge a rupee *extra* for taking an offer
 * - counts two of the same bowl as a valid pair
 *
 * `categoryNameOf` is supplied by the caller because the cart holds products, not categories — the
 * menu knows which tier each product came from.
 */
export function previewCombos(
  lines: readonly CartLine[],
  categoryNameOf: (productId: string) => string | undefined,
): ComboPreview {
  if (lines.length === 0) {
    return EMPTY;
  }

  const matches: ComboMatch[] = [];

  for (const offer of COMBO_OFFERS) {
    // One entry per unit, so a quantity of two is two candidates.
    const units: { name: string; price: number }[] = [];

    for (const line of lines) {
      if (categoryNameOf(line.product.id) !== offer.categoryName) {
        continue;
      }

      for (let unit = 0; unit < line.quantity; unit++) {
        units.push({ name: line.product.name, price: line.product.price });
      }
    }

    units.sort((a, b) => b.price - a.price);

    for (let i = 0; i + 1 < units.length; i += 2) {
      const first = units[i];
      const second = units[i + 1];

      if (first === undefined || second === undefined) {
        break;
      }

      const saving = round(first.price + second.price - offer.pairPrice);

      // Sorted descending, so once a pair stops saving every later pair is cheaper still.
      if (saving <= 0) {
        break;
      }

      matches.push({ label: offer.label, products: [first.name, second.name], saving });
    }
  }

  return {
    matches,
    discount: round(matches.reduce((sum, match) => sum + match.saving, 0)),
  };
}
