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
    /*
     * Mini Bowls, in the display slot the retired Combos category left free.
     *
     * Its own category rather than an entry in Signature Bowls: at ₹69 against ₹149–169 it would
     * read as a mispriced signature bowl sitting among them, and the POS renders categories as tabs
     * so a separate one costs a single tap. One product today, and it is the obvious place for mini
     * versions of the other flavours as they arrive.
     *
     * No `image` yet — the card falls back to the category emoji, which is why that fallback exists.
     */
    name: 'Mini Bowls',
    icon: '🍨',
    displayOrder: 3,
    products: [{ name: 'Mini Bowl', price: 69 }],
  },
  /*
   * The Combos category is gone, and on purpose.
   *
   * "Any 2 Signature Bowls" and "Any 2 Premium Bowls" used to be products the cashier added by
   * hand. That charged the right money and threw away the useful part: the order recorded *a
   * combo* rather than *which two bowls went out*, so stock and the top-sellers report never saw
   * the flavours, and the counter had to remember to switch to a different tab to ring one up.
   *
   * The offer now applies itself — see `COMBO_OFFER_POLICY` in `combo-pricing.ts`, which is the
   * single source of truth for the pair prices. Ring up the two bowls the customer actually chose
   * and the saving appears.
   *
   * The two product rows are **not deleted**: past orders reference them, and a receipt from last
   * week has to keep reading correctly. `seed-menu` soft-deletes them so they leave the menu
   * without leaving the database.
   */
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
  {
    /*
     * Extras — charges that are not a dessert.
     *
     * Waffle packaging is ₹10 the cashier adds when a waffle is packed to go, rather than ₹10 folded
     * into all six waffle prices. Two reasons it is a product and not a price rise:
     *
     * A dine-in waffle does not use a box, so raising the menu price would charge every customer for
     * packaging most of them do not take. And as its own line the order records *how many waffles
     * actually went out packed*, which is the figure that reconciles against the Waffle Box stock
     * being drawn down at ₹5.50 a box — a price rise would hide that inside revenue.
     *
     * Sits last in the tab order because it is never the first thing anyone rings up.
     */
    name: 'Extras',
    icon: '🥡',
    displayOrder: 5,
    products: [{ name: 'Waffle Packaging', price: 10 }],
  },
];

/**
 * Products that used to be on the menu and must now leave it.
 *
 * Removing a name from `MENU` is not enough on its own: the seed is deliberately non-destructive,
 * so a product it stops seeing is simply one it stops updating — the row stays live and the POS
 * keeps offering it. This list is the explicit instruction to retire one.
 *
 * **Soft-deleted, never deleted.** `sales_order_items` references products with `RESTRICT`, so a
 * product that has ever been sold cannot be removed without erasing the record of selling it. A
 * soft delete takes it off the menu — the menu query filters on `deletedAt` — while last week's
 * receipt still reads correctly.
 *
 * Declared here rather than run as a one-off script so that every environment ends up in the same
 * state. A database seeded from scratch never creates these; a database that already has them
 * retires them on the next seed.
 */
export const RETIRED_PRODUCTS: readonly string[] = [
  // Replaced by automatic "any 2" pricing — see the note where the Combos category used to be.
  'Any 2 Signature Bowls',
  'Any 2 Premium Bowls',
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
