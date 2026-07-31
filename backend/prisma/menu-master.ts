/**
 * The Paris Bites menu, as data.
 *
 * Separated from the seed script for the same reason `inventory-master.ts` is: this is the
 * business's menu and it changes on its own schedule, while the script that writes it does
 * not. Someone adding a winter special should be editing a list, not a loop.
 *
 * These are **finished goods** — what a customer buys. They are deliberately unrelated to
 * `inventory_items`, which holds the chocolate and bowls they are made from. Connecting the
 * two is what recipes are for, and that is a later phase.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface MenuProductSeed {
  readonly name: string;
  readonly price: number;
  /**
   * Path to the product photo under `frontend/public`, or omitted where none has been shot.
   *
   * Omitted is meaningful: the card falls back to the category emoji, so a partly
   * photographed menu looks deliberate rather than broken. Filenames are the lower-cased,
   * hyphenated product name, so the next photo's name is obvious without consulting a table.
   *
   * Lower-case extensions matter. The originals arrived as a mix of `.PNG`, `.JPG` and
   * `.jpg`; macOS serves those interchangeably and Linux does not, so a path that works in
   * development would 404 in production.
   */
  readonly image?: string;
}

export interface MenuCategorySeed {
  readonly name: string;
  readonly icon: string;
  readonly displayOrder: number;
  readonly products: readonly MenuProductSeed[];
}

export const MENU: readonly MenuCategorySeed[] = [
  {
    name: 'Signature Bowls',
    icon: '🍫',
    displayOrder: 1,
    products: [
      { name: 'Death By Chocolate', price: 149 , image: '/products/death-by-chocolate.jpg' },
      { name: 'Oreo Licious', price: 159 , image: '/products/oreo-licious.jpg' },
      { name: 'KitKat Break', price: 169 , image: '/products/kitkat-break.jpg' },
    ],
  },
  {
    name: 'Premium Bowls',
    icon: '🍫',
    displayOrder: 2,
    products: [
      { name: 'Tiramisu Indulgence', price: 199 , image: '/products/tiramisu-indulgence.jpg' },
      { name: 'Strawberry Bliss', price: 219 , image: '/products/strawberry-bliss.jpg' },
      { name: 'Biscoff Delight', price: 229 , image: '/products/biscoff-delight.jpg' },
      { name: 'Nutella Bliss', price: 239 , image: '/products/nutella-bliss.jpg' },
      { name: 'Blueberry Bliss', price: 239 , image: '/products/blueberry-bliss.jpg' },
    ],
  },
  {
    name: 'Combos',
    icon: '🍫',
    displayOrder: 3,
    products: [
      // Both combo shots show two bowls from the tier they sell, which is the clearest way to
      // photograph "any two" — a single bowl would look like one of the individual products.
      { name: 'Any 2 Signature Bowls', price: 299 , image: '/products/any-2-signature-bowls.jpg' },
      { name: 'Any 2 Premium Bowls', price: 399 , image: '/products/any-2-premium-bowls.jpg' },
    ],
  },
  {
    name: 'Belgian Waffles',
    icon: '🧇',
    displayOrder: 4,
    products: [
      /*
       * Four of these share a name with a bowl — "Death By Chocolate" is both a ₹149 bowl
       * and a ₹129 waffle. The product name is unique across the menu (a partial unique
       * index on `LOWER(name)`), so the waffles carry the suffix. Without it the seed would
       * fail on the fifth insert, and worse, a card reading just "Death By Chocolate" in the
       * waffle tab would be indistinguishable from the bowl on a receipt.
       */
      { name: 'Death By Chocolate Waffle', price: 129 , image: '/products/death-by-chocolate-waffle.jpg' },
      { name: 'KitKat Break Waffle', price: 139 , image: '/products/kitkat-break-waffle.jpg' },
      { name: 'Strawberry Bliss Waffle', price: 149 , image: '/products/strawberry-bliss-waffle.jpg' },
      { name: 'Blueberry Dream Waffle', price: 149 , image: '/products/blueberry-dream-waffle.jpg' },
      { name: 'Nutella Indulgence Waffle', price: 169 , image: '/products/nutella-indulgence-waffle.jpg' },
      { name: 'Biscoff Bliss Waffle', price: 169 , image: '/products/biscoff-bliss-waffle.jpg' },
    ],
  },
];

/** Guards the seed against a menu edit that duplicates a name. */
export function findDuplicateMenuNames(): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const category of MENU) {
    for (const product of category.products) {
      const key = product.name.trim().toLowerCase();

      if (seen.has(key)) {
        duplicates.push(product.name);
      }

      seen.add(key);
    }
  }

  return duplicates;
}

/**
 * Guards the seed against a photo path that points at nothing.
 *
 * A missing file is invisible on the server and shows as a broken card in the POS, mid-shift.
 * Cheaper to fail the seed. Paths are relative to `frontend/public`, which is the only place
 * the app serves static files from.
 */
export function findMissingMenuImages(publicDir: string): string[] {
  const missing: string[] = [];

  for (const category of MENU) {
    for (const product of category.products) {
      if (product.image === undefined) {
        continue;
      }

      if (!existsSync(join(publicDir, product.image))) {
        missing.push(`${product.name} -> ${product.image}`);
      }
    }
  }

  return missing;
}
