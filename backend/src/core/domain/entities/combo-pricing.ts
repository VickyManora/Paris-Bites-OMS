import { Money } from '../value-objects/money.js';

/**
 * A "any two from this tier for a fixed price" offer.
 *
 * Keyed on the **category** the pair must come from, because that is what the offer actually says:
 * any two Signature bowls, any two Premium bowls. Keying on a product list would need editing every
 * time the menu gains a flavour, and the offer would silently stop covering the new one.
 */
export interface ComboOffer {
  /** Category whose products may be paired. Both halves must come from it. */
  readonly categoryId: string;
  /** What the pair costs together. */
  readonly pairPrice: number;
  /** For the audit trail and the cart preview — "Any 2 Signature Bowls". */
  readonly label: string;
}

/**
 * The offers the shop runs, as policy.
 *
 * Declared here rather than as rows in the menu, because the two "Any 2 …" *products* are being
 * retired: they were how a combo used to be rung up, and keeping them as the price source would
 * leave a hidden product whose only remaining job was to hold a number. One definition, in the
 * layer that owns pricing rules.
 *
 * Keyed by category **name** because that is the stable thing across a reseed — ids are generated.
 * A name that matches no category simply yields no offer, and the customer pays the menu price.
 */
export const COMBO_OFFER_POLICY: readonly {
  readonly categoryName: string;
  readonly pairPrice: number;
  readonly label: string;
}[] = [
  { categoryName: 'Signature Bowls', pairPrice: 299, label: 'Any 2 Signature Bowls' },
  { categoryName: 'Premium Bowls', pairPrice: 399, label: 'Any 2 Premium Bowls' },
];

/**
 * Resolves the policy against the categories actually present in a cart.
 *
 * The rule needs category *ids* to pair on; the policy is written in names. This is the join, done
 * once per order from products the caller has already loaded — no extra query.
 */
export function resolveComboOffers(
  products: readonly { categoryId: string; categoryName: string }[],
): ComboOffer[] {
  const byName = new Map<string, string>();

  for (const product of products) {
    if (product.categoryName !== '') {
      byName.set(product.categoryName, product.categoryId);
    }
  }

  return COMBO_OFFER_POLICY.flatMap((policy) => {
    const categoryId = byName.get(policy.categoryName);

    return categoryId === undefined
      ? []
      : [{ categoryId, pairPrice: policy.pairPrice, label: policy.label }];
  });
}

/** One unit of one product, as a candidate for pairing. */
export interface ComboCandidate {
  readonly productId: string;
  readonly productName: string;
  readonly categoryId: string;
  readonly unitPrice: number;
}

/** A pair the rule matched, kept so the cart and the receipt can name it. */
export interface MatchedCombo {
  readonly label: string;
  readonly pairPrice: number;
  /** The two product names, in the order they were paired. */
  readonly products: readonly [string, string];
  /** What the two would have cost separately. */
  readonly pairSubtotal: number;
  /** `pairSubtotal - pairPrice`. Always positive; a pair that saves nothing is not matched. */
  readonly saving: number;
}

export interface ComboResult {
  readonly matches: readonly MatchedCombo[];
  /** Total taken off the order by combos. Zero when nothing paired. */
  readonly discount: number;
}

const EMPTY: ComboResult = { matches: [], discount: 0 };

/**
 * Applies the "any two" offers to a cart.
 *
 * Replaces the old way of selling a combo, which was to add a separate "Any 2 Signature Bowls"
 * product. That worked at the till and lost the thing worth knowing: the order recorded *a combo*
 * rather than *which two bowls went out*, so stock and the top-sellers report never saw the
 * flavours. Pairing real lines keeps both — the customer gets the offer, and the two bowls are on
 * the order.
 *
 * ## The rules, and why each one is there
 *
 * **Pairs come from one tier.** The offers are per-tier and priced differently, so a Signature and
 * a Premium bowl are not a pair at either price.
 *
 * **Dearest first.** Units are sorted by price descending and paired off the top. With three
 * Signature bowls at 169, 159 and 149, pairing the two dearest saves ₹29 where pairing 169 with 149
 * saves ₹19 — and the third bowl is charged normally either way. Sorting descending is what makes
 * the customer's saving the largest available, which is what they would expect from an offer.
 *
 * **A pair is only applied when it beats paying separately.** This is not defensive: two Death By
 * Chocolate bowls cost ₹298 and the Signature combo is ₹299, so applying it blindly would *charge a
 * rupee more* for accepting an offer. The same holds for two Tiramisu at ₹398 against a ₹399
 * Premium combo. The customer is charged the lower of the two, always.
 *
 * **Quantity is expanded into units.** Two of the same bowl is a valid "any two" — it is the same
 * two bowls leaving the shop either way.
 *
 * Pure and total: no dates, no randomness, no IO. Given the same cart it returns the same answer,
 * which is what lets the cart preview it in the browser and the server charge it, with no risk of
 * the two disagreeing.
 */
export function applyCombos(
  candidates: readonly ComboCandidate[],
  offers: readonly ComboOffer[],
): ComboResult {
  if (candidates.length < 2 || offers.length === 0) {
    return EMPTY;
  }

  const matches: MatchedCombo[] = [];

  for (const offer of offers) {
    const units = candidates
      .filter((candidate) => candidate.categoryId === offer.categoryId)
      // Dearest first, so the pairs formed are the ones that save the most.
      .sort((a, b) => b.unitPrice - a.unitPrice);

    for (let i = 0; i + 1 < units.length; i += 2) {
      const first = units[i];
      const second = units[i + 1];

      if (first === undefined || second === undefined) {
        break;
      }

      const pairSubtotal = Money.round(first.unitPrice + second.unitPrice);
      const saving = Money.round(pairSubtotal - offer.pairPrice);

      /*
       * Stop at the first pair that does not save.
       *
       * Not `continue`: the units are sorted descending, so once a pair is too cheap to benefit,
       * every pair after it is cheaper still. Carrying on would only re-derive the same answer more
       * slowly.
       */
      if (saving <= 0) {
        break;
      }

      matches.push({
        label: offer.label,
        pairPrice: offer.pairPrice,
        products: [first.productName, second.productName],
        pairSubtotal,
        saving,
      });
    }
  }

  return {
    matches,
    discount: Money.round(Money.sum(matches.map((match) => match.saving))),
  };
}

/**
 * Expands priced order lines into one candidate per unit.
 *
 * Separate from `applyCombos` so the pairing rule can be tested on a flat list of units without
 * constructing order lines, and so the caller decides where category comes from.
 */
export function toComboCandidates(
  lines: readonly {
    productId: string;
    productName: string;
    unitPrice: number;
    quantity: number;
  }[],
  categoryOf: (productId: string) => string | undefined,
): ComboCandidate[] {
  const candidates: ComboCandidate[] = [];

  for (const line of lines) {
    const categoryId = categoryOf(line.productId);

    /*
     * A product whose category could not be resolved simply does not take part.
     *
     * Failing open matters here: the worst outcome of a missing category is that the customer pays
     * the full price they can already see on the menu, which is correct if unlucky. Throwing would
     * refuse the whole order over a pricing *bonus*.
     */
    if (categoryId === undefined) {
      continue;
    }

    for (let unit = 0; unit < line.quantity; unit++) {
      candidates.push({
        productId: line.productId,
        productName: line.productName,
        categoryId,
        unitPrice: line.unitPrice,
      });
    }
  }

  return candidates;
}
