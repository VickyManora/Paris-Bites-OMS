import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMBO_OFFER_POLICY } from '../../src/core/domain/entities/combo-pricing.js';

/**
 * The combo prices exist in two places, and this is the test that stops them drifting.
 *
 * The server is authoritative — it decides what a customer is charged. The frontend holds the same
 * numbers so the cart can total itself while the cashier builds it; without that, two Blueberry
 * bowls would read ₹478 on screen and be charged ₹399 when the order landed, and the cashier would
 * say the wrong figure out loud.
 *
 * That duplication is a deliberate trade, but an unguarded one is a trap: change a pair price on the
 * server only, and the POS quietly quotes the old one for as long as nobody notices. Nothing in the
 * type system connects the two files, so this reads the frontend source as text and compares.
 *
 * **If this fails, the fix is to make the two files agree** — not to relax the test. The message
 * names both sides so the drift is obvious.
 */
const FRONTEND_SOURCE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../frontend/src/app/features/pos/models/combo-pricing.ts',
);

interface ParsedOffer {
  readonly categoryName: string;
  readonly pairPrice: number;
}

/**
 * Pulls the offer triples out of the frontend file.
 *
 * A regex over source rather than an import, because the two apps are separate packages with their
 * own tsconfigs — importing across the boundary would drag Angular into the backend's test run.
 * Deliberately strict: it matches the literal shape the file uses, so a rewrite that this can no
 * longer read fails the test rather than silently matching nothing.
 */
function parseFrontendOffers(source: string): ParsedOffer[] {
  const pattern = /categoryName:\s*'([^']+)'\s*,\s*pairPrice:\s*(\d+(?:\.\d+)?)/g;
  const offers: ParsedOffer[] = [];

  for (const match of source.matchAll(pattern)) {
    const [, categoryName, price] = match;

    if (categoryName !== undefined && price !== undefined) {
      offers.push({ categoryName, pairPrice: Number(price) });
    }
  }

  return offers;
}

const key = (offer: ParsedOffer) => `${offer.categoryName} = ${String(offer.pairPrice)}`;

describe('combo offer parity between server and POS', () => {
  const source = readFileSync(FRONTEND_SOURCE, 'utf8');
  const frontend = parseFrontendOffers(source);

  it('can still read the frontend offers', () => {
    /*
     * Guards the guard. A regex that matches nothing would make every assertion below pass
     * vacuously, which is the failure mode of every test that parses source.
     */
    expect(frontend.length).toBeGreaterThan(0);
  });

  it('declares the same number of offers on both sides', () => {
    expect(frontend).toHaveLength(COMBO_OFFER_POLICY.length);
  });

  it('prices every offer identically', () => {
    const server = COMBO_OFFER_POLICY.map((offer) => ({
      categoryName: offer.categoryName,
      pairPrice: offer.pairPrice,
    }));

    expect(frontend.map(key).sort()).toEqual(server.map(key).sort());
  });

  it('is actually an offer — the dearest pair in each tier saves money', () => {
    /*
     * Checks the offer is worth having, which is not the same as checking it always applies.
     *
     * The first version of this test asserted the combo must beat a pair of the *cheapest* bowl,
     * and it failed on correct pricing: two Death By Chocolate are ₹298 against a ₹299 Signature
     * combo, and two Tiramisu are ₹398 against ₹399 Premium. Both are deliberate — the combo is
     * priced for the tier, not for its floor, and `applyCombos` simply declines to apply it to
     * those two pairs so the customer is never overcharged. The test was encoding a rule the
     * business does not have.
     *
     * What is worth asserting is the other end: if a pair price ever rose above **twice the
     * dearest** bowl in its tier, the offer would save nothing for anybody and the whole feature
     * would be dead code that still looked alive.
     */
    const dearestInTier: Readonly<Record<string, number>> = {
      'Signature Bowls': 169,
      'Premium Bowls': 239,
    };

    for (const offer of COMBO_OFFER_POLICY) {
      const dearest = dearestInTier[offer.categoryName];

      if (dearest === undefined) {
        continue;
      }

      expect(
        offer.pairPrice,
        `${offer.categoryName}: even the dearest pair costs ₹${String(dearest * 2)}, so a ₹${String(offer.pairPrice)} combo would never save anyone anything`,
      ).toBeLessThan(dearest * 2);
    }
  });
});
