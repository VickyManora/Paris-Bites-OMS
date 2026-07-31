import { describe, expect, it } from 'vitest';
import {
  applyCombos,
  toComboCandidates,
  type ComboCandidate,
  type ComboOffer,
} from '../../src/core/domain/entities/combo-pricing.js';

/** The real menu, because the interesting edge cases come from its actual prices. */
const SIGNATURE = 'cat-signature';
const PREMIUM = 'cat-premium';

const OFFERS: readonly ComboOffer[] = [
  { categoryId: SIGNATURE, pairPrice: 299, label: 'Any 2 Signature Bowls' },
  { categoryId: PREMIUM, pairPrice: 399, label: 'Any 2 Premium Bowls' },
];

const bowl = (name: string, unitPrice: number, categoryId: string): ComboCandidate => ({
  productId: name.toLowerCase().replace(/\s+/g, '-'),
  productName: name,
  categoryId,
  unitPrice,
});

const dbc = () => bowl('Death By Chocolate', 149, SIGNATURE);
const oreo = () => bowl('Oreo Licious', 159, SIGNATURE);
const kitkat = () => bowl('KitKat Break', 169, SIGNATURE);
const tiramisu = () => bowl('Tiramisu Indulgence', 199, PREMIUM);
const blueberry = () => bowl('Blueberry Bliss', 239, PREMIUM);
const nutella = () => bowl('Nutella Bliss', 239, PREMIUM);

describe('applyCombos', () => {
  it('does nothing to a single bowl', () => {
    expect(applyCombos([kitkat()], OFFERS)).toEqual({ matches: [], discount: 0 });
  });

  it('pairs two bowls from the same tier and charges the offer price', () => {
    // 169 + 159 = 328, offer 299.
    const result = applyCombos([kitkat(), oreo()], OFFERS);

    expect(result.discount).toBe(29);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.label).toBe('Any 2 Signature Bowls');
    expect(result.matches[0]?.pairSubtotal).toBe(328);
  });

  it('never charges more than paying separately — two Death By Chocolate', () => {
    /*
     * The case that makes the "only when it saves" rule necessary rather than defensive: two of the
     * cheapest Signature bowl come to ₹298, and the combo is ₹299. Applying it would charge a rupee
     * extra for accepting an offer.
     */
    expect(applyCombos([dbc(), dbc()], OFFERS)).toEqual({ matches: [], discount: 0 });
  });

  it('never charges more than paying separately — two Tiramisu', () => {
    // 199 + 199 = 398 against a ₹399 Premium combo.
    expect(applyCombos([tiramisu(), tiramisu()], OFFERS)).toEqual({ matches: [], discount: 0 });
  });

  it('does not pair across tiers', () => {
    // A Signature and a Premium bowl are not "any two" at either price.
    expect(applyCombos([kitkat(), blueberry()], OFFERS)).toEqual({ matches: [], discount: 0 });
  });

  it('pairs the dearest bowls together, which is the largest saving available', () => {
    // 169 + 159 = 328 (save 29), leaving 149 at full price.
    // Pairing 169 + 149 instead would save only 19.
    const result = applyCombos([kitkat(), oreo(), dbc()], OFFERS);

    expect(result.discount).toBe(29);
    expect(result.matches[0]?.products).toEqual(['KitKat Break', 'Oreo Licious']);
  });

  it('applies two combos to four bowls', () => {
    // (239 + 239) - 399 = 79, twice.
    const result = applyCombos([blueberry(), nutella(), blueberry(), nutella()], OFFERS);

    expect(result.matches).toHaveLength(2);
    expect(result.discount).toBe(158);
  });

  it('applies one combo per tier in a mixed cart', () => {
    const result = applyCombos([kitkat(), oreo(), blueberry(), nutella()], OFFERS);

    expect(result.matches).toHaveLength(2);
    // Signature 328 - 299 = 29, Premium 478 - 399 = 79.
    expect(result.discount).toBe(108);
    expect(result.matches.map((m) => m.label)).toEqual([
      'Any 2 Signature Bowls',
      'Any 2 Premium Bowls',
    ]);
  });

  it('stops pairing once a pair no longer saves, leaving the rest at full price', () => {
    /*
     * Sorted descending: 169, 149, 149, 149. First pair 169+149=318 saves 19. Second pair
     * 149+149=298 does not save, so it is not applied and those two are charged normally.
     */
    const result = applyCombos([kitkat(), dbc(), dbc(), dbc()], OFFERS);

    expect(result.matches).toHaveLength(1);
    expect(result.discount).toBe(19);
  });

  it('leaves an odd bowl out rather than half-pairing it', () => {
    const result = applyCombos([blueberry(), nutella(), tiramisu()], OFFERS);

    expect(result.matches).toHaveLength(1);
    expect(result.discount).toBe(79);
  });

  it('returns nothing when there are no offers', () => {
    expect(applyCombos([kitkat(), oreo()], [])).toEqual({ matches: [], discount: 0 });
  });
});

describe('toComboCandidates', () => {
  const categoryOf = (id: string) => (id.startsWith('sig-') ? SIGNATURE : undefined);

  it('expands quantity into one candidate per unit', () => {
    const candidates = toComboCandidates(
      [{ productId: 'sig-kitkat', productName: 'KitKat Break', unitPrice: 169, quantity: 3 }],
      categoryOf,
    );

    expect(candidates).toHaveLength(3);
    expect(candidates.every((c) => c.unitPrice === 169)).toBe(true);
  });

  it('two of the same bowl is a valid pair', () => {
    const candidates = toComboCandidates(
      [{ productId: 'sig-kitkat', productName: 'KitKat Break', unitPrice: 169, quantity: 2 }],
      categoryOf,
    );

    // 338 - 299 = 39.
    expect(applyCombos(candidates, OFFERS).discount).toBe(39);
  });

  it('skips a product whose category cannot be resolved rather than throwing', () => {
    /*
     * Failing open is the point: the worst case is the customer pays the menu price, which is
     * correct if unlucky. Refusing the order over a missing category would turn a pricing bonus
     * into an outage.
     */
    const candidates = toComboCandidates(
      [{ productId: 'unknown-x', productName: 'Mystery', unitPrice: 500, quantity: 2 }],
      categoryOf,
    );

    expect(candidates).toEqual([]);
  });
});
