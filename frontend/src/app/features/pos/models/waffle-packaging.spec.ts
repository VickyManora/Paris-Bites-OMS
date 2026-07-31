import type { MenuCategory, Product } from './pos.model';
import { findPackagingProduct, waffleProductIds } from './waffle-packaging';

function product(id: string, name: string, price = 129, isAvailable = true): Product {
  return { id, name, description: null, price, imageUrl: null, isAvailable };
}

function category(id: string, name: string, products: readonly Product[]): MenuCategory {
  return { id, name, icon: null, products };
}

/** The live menu's shape, trimmed to what these functions look at. */
const MENU: readonly MenuCategory[] = [
  category('c-sig', 'Signature Bowls', [product('p-dbc', 'Death By Chocolate', 149)]),
  category('c-waf', 'Belgian Waffles', [
    product('p-w1', 'Death By Chocolate Waffle', 129),
    product('p-w2', 'Nutella Indulgence Waffle', 169),
  ]),
  category('c-ext', 'Extras', [product('p-box', 'Waffle Packaging', 10)]),
];

/**
 * These two functions decide whether a ₹10 charge is offered, and they work by matching names
 * against a menu that someone edits from a seed file. Both failure directions cost money — a miss
 * gives away a box, and a false positive charges for one that was never used.
 */
describe('waffle-packaging', () => {
  describe('waffleProductIds', () => {
    it('collects every product in the waffle category', () => {
      expect(waffleProductIds(MENU)).toEqual(new Set(['p-w1', 'p-w2']));
    });

    it('does not treat the packaging product as a waffle', () => {
      // The box's own name contains "Waffle". Matching on the product name rather than the
      // category would make it prompt for a box for itself, forever.
      expect(waffleProductIds(MENU).has('p-box')).toBe(false);
    });

    it('does not treat a bowl as a waffle', () => {
      expect(waffleProductIds(MENU).has('p-dbc')).toBe(false);
    });

    it('matches the category name case-insensitively', () => {
      const shouted = [category('c-waf', 'BELGIAN WAFFLES', [product('p-w1', 'Waffle')])];
      expect(waffleProductIds(shouted).has('p-w1')).toBe(true);
    });

    it('is empty when the menu has no waffle category', () => {
      expect(waffleProductIds([MENU[0]!]).size).toBe(0);
    });
  });

  describe('findPackagingProduct', () => {
    it('finds the packaging product', () => {
      expect(findPackagingProduct(MENU)?.id).toBe('p-box');
    });

    it('finds it wherever the menu files it', () => {
      // Which category holds it is presentation. A reorganised menu must not switch the charge off.
      const moved = [
        category('c-waf', 'Belgian Waffles', [product('p-box', 'Waffle Packaging', 10)]),
      ];
      expect(findPackagingProduct(moved)?.id).toBe('p-box');
    });

    it('returns null when it is sold out', () => {
      // No boxes left means nothing to offer, so the prompt must not appear at all.
      const soldOut = [
        category('c-ext', 'Extras', [product('p-box', 'Waffle Packaging', 10, false)]),
      ];
      expect(findPackagingProduct(soldOut)).toBeNull();
    });

    it('returns null when it is absent from the menu', () => {
      expect(findPackagingProduct([MENU[0]!, MENU[1]!])).toBeNull();
    });

    it('does not mistake a waffle for the packaging product', () => {
      expect(findPackagingProduct([MENU[1]!])).toBeNull();
    });
  });
});
