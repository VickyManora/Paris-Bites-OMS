import type {
  InventoryCategory,
  InventoryLocation,
  InventoryUnit,
} from '../src/generated/prisma/enums.js';

/**
 * The Paris Bites inventory master list.
 *
 * The single source of truth for what the business stocks. `seed-inventory.ts` makes
 * the database match this file exactly: anything here is created or refreshed, and any
 * other item is removed.
 *
 * Kept as data, separate from the script that applies it, so that adding an item is a
 * one-line change nobody has to read imperative code to make.
 *
 * ## What a row does and does not say
 *
 * Every row carries the item's *definition*: what it is, how it is measured, and when
 * to reorder it. It deliberately carries no stock level. Opening and current quantities
 * both start at zero and move only through the adjust, purchase and transfer paths, so
 * re-running the seed against a live database refreshes definitions without touching a
 * single figure staff have counted.
 *
 * Purchase price, supplier, batch number and expiry date are likewise absent: they are
 * facts about stock that has actually been bought, not about the item, and inventing
 * them here would put numbers on a valuation report that nobody entered.
 *
 * ## Location
 *
 * Every row is set up at **both** locations. An item is per-location, so the same
 * ingredient in the warehouse and on the cart are two rows with independent quantities
 * and thresholds; seeding only the warehouse left the cart able to hold a thing only
 * after a transfer had first sent it there, which is backwards — the cart stocks the
 * whole list, whether or not any has arrived yet. The cart copies open at zero, so an
 * empty one costs a row and says something true.
 */

export interface MasterInventoryItem {
  readonly name: string;
  readonly category: InventoryCategory;
  readonly unit: InventoryUnit;
  readonly minimumQuantity: number;
  readonly notes?: string;
}

/** Where the master list is set up — every item, at every location. See the note above. */
export const MASTER_LOCATIONS: readonly InventoryLocation[] = ['HOME_WAREHOUSE', 'CART'];

/**
 * Units and reorder levels for the cleaning and hygiene supplies.
 *
 * The master list names these seven items but specifies neither, unlike every other
 * category. The values below are defaults chosen to be usable immediately — a packet of
 * gloves, a bottle of sanitiser — and are flagged in each item's notes so whoever owns
 * the stock room can correct them rather than discover them silently in place.
 */
const CLEANING_DEFAULTS_NOTE =
  'Consumable supply. Unit and minimum stock are defaults — confirm against how this is actually bought.';

export const MASTER_INVENTORY: readonly MasterInventoryItem[] = [
  // --- Chocolate ----------------------------------------------------------
  { name: 'Dark Chocolate', category: 'CHOCOLATE', unit: 'KG', minimumQuantity: 5 },
  { name: 'Milk Chocolate', category: 'CHOCOLATE', unit: 'KG', minimumQuantity: 5 },
  { name: 'White Chocolate', category: 'CHOCOLATE', unit: 'KG', minimumQuantity: 3 },

  // --- Waffle premix ------------------------------------------------------
  { name: 'Chocolate Waffle Premix', category: 'WAFFLE_PREMIX', unit: 'KG', minimumQuantity: 5 },
  { name: 'Vanilla Waffle Premix', category: 'WAFFLE_PREMIX', unit: 'KG', minimumQuantity: 5 },

  // --- Bowl premix --------------------------------------------------------
  { name: 'Chocolate Bowl Premix', category: 'BOWL_PREMIX', unit: 'KG', minimumQuantity: 5 },
  { name: 'Vanilla Bowl Premix', category: 'BOWL_PREMIX', unit: 'KG', minimumQuantity: 5 },

  // --- Chocolate fillings -------------------------------------------------
  {
    name: 'Dark Chocolate Filling',
    category: 'CHOCOLATE_FILLINGS',
    unit: 'KG',
    minimumQuantity: 3,
  },
  {
    name: 'Milk Chocolate Filling',
    category: 'CHOCOLATE_FILLINGS',
    unit: 'KG',
    minimumQuantity: 3,
  },
  {
    name: 'White Chocolate Filling',
    category: 'CHOCOLATE_FILLINGS',
    unit: 'KG',
    minimumQuantity: 3,
  },

  // --- Dairy --------------------------------------------------------------
  { name: 'Whipping Cream', category: 'DAIRY', unit: 'LITERS', minimumQuantity: 5 },
  { name: 'Amul Fresh Cream', category: 'DAIRY', unit: 'LITERS', minimumQuantity: 5 },
  { name: 'Cream Cheese', category: 'DAIRY', unit: 'KG', minimumQuantity: 2 },

  // --- Spreads & sauces ---------------------------------------------------
  { name: 'Lotus Biscoff Spread', category: 'SPREADS_AND_SAUCES', unit: 'KG', minimumQuantity: 2 },
  { name: 'Nutella', category: 'SPREADS_AND_SAUCES', unit: 'KG', minimumQuantity: 2 },
  {
    name: 'Strawberry Fruit Filling',
    category: 'SPREADS_AND_SAUCES',
    unit: 'KG',
    minimumQuantity: 2,
  },
  {
    name: 'Blueberry Fruit Filling',
    category: 'SPREADS_AND_SAUCES',
    unit: 'KG',
    minimumQuantity: 2,
  },

  // --- Toppings & flavours ------------------------------------------------
  {
    name: 'Lotus Biscoff Biscuits',
    category: 'TOPPINGS_AND_FLAVOURS',
    unit: 'PACKETS',
    minimumQuantity: 10,
  },
  { name: 'Oreo Cookies', category: 'TOPPINGS_AND_FLAVOURS', unit: 'PACKETS', minimumQuantity: 10 },
  { name: 'KitKat', category: 'TOPPINGS_AND_FLAVOURS', unit: 'PIECES', minimumQuantity: 50 },
  { name: 'Coffee Powder', category: 'TOPPINGS_AND_FLAVOURS', unit: 'KG', minimumQuantity: 1 },
  { name: 'Cocoa Powder', category: 'TOPPINGS_AND_FLAVOURS', unit: 'KG', minimumQuantity: 1 },
  {
    name: 'Chocolate Sprinkles',
    category: 'TOPPINGS_AND_FLAVOURS',
    unit: 'KG',
    minimumQuantity: 1,
  },
  { name: 'Choco Chips', category: 'TOPPINGS_AND_FLAVOURS', unit: 'KG', minimumQuantity: 2 },
  {
    name: 'Vanilla Essence',
    category: 'TOPPINGS_AND_FLAVOURS',
    unit: 'BOTTLES',
    minimumQuantity: 5,
  },

  // --- Kitchen essentials -------------------------------------------------
  { name: 'Cooking Oil', category: 'KITCHEN_ESSENTIALS', unit: 'LITERS', minimumQuantity: 5 },

  // --- Packaging ----------------------------------------------------------
  { name: 'Dessert Bowl', category: 'PACKAGING', unit: 'PIECES', minimumQuantity: 300 },
  { name: 'Bowl Lid', category: 'PACKAGING', unit: 'PIECES', minimumQuantity: 300 },
  { name: 'Wooden Spoon', category: 'PACKAGING', unit: 'PIECES', minimumQuantity: 300 },
  { name: 'Tissue Paper', category: 'PACKAGING', unit: 'PACKETS', minimumQuantity: 20 },
  {
    name: 'Butter Paper / Baking Paper',
    category: 'PACKAGING',
    unit: 'SHEETS',
    minimumQuantity: 300,
  },
  { name: 'Disposable Carry Bags', category: 'PACKAGING', unit: 'PIECES', minimumQuantity: 200 },
  {
    name: 'Paris Bites Logo Stickers',
    category: 'PACKAGING',
    unit: 'PIECES',
    minimumQuantity: 200,
  },

  // --- Cleaning & hygiene -------------------------------------------------
  // Units and minimums below are defaults — see CLEANING_DEFAULTS_NOTE.
  {
    name: 'Disposable Gloves',
    category: 'CLEANING_AND_HYGIENE',
    unit: 'PACKETS',
    minimumQuantity: 5,
    notes: CLEANING_DEFAULTS_NOTE,
  },
  {
    name: 'Hair Net',
    category: 'CLEANING_AND_HYGIENE',
    unit: 'PACKETS',
    minimumQuantity: 2,
    notes: CLEANING_DEFAULTS_NOTE,
  },
  {
    name: 'Food Wrap / Cling Film',
    category: 'CLEANING_AND_HYGIENE',
    unit: 'PIECES',
    minimumQuantity: 2,
    notes: `${CLEANING_DEFAULTS_NOTE} Counted in rolls.`,
  },
  {
    name: 'Hand Sanitizer',
    category: 'CLEANING_AND_HYGIENE',
    unit: 'BOTTLES',
    minimumQuantity: 2,
    notes: CLEANING_DEFAULTS_NOTE,
  },
  {
    name: 'Hand Wash',
    category: 'CLEANING_AND_HYGIENE',
    unit: 'BOTTLES',
    minimumQuantity: 2,
    notes: CLEANING_DEFAULTS_NOTE,
  },
  {
    name: 'Surface Cleaning Spray',
    category: 'CLEANING_AND_HYGIENE',
    unit: 'BOTTLES',
    minimumQuantity: 2,
    notes: CLEANING_DEFAULTS_NOTE,
  },
  {
    name: 'Cleaning Cloth',
    category: 'CLEANING_AND_HYGIENE',
    unit: 'PIECES',
    minimumQuantity: 5,
    notes: CLEANING_DEFAULTS_NOTE,
  },
];

/**
 * Guards the list against a duplicate name, which the partial unique index would
 * otherwise reject halfway through seeding — leaving the database in a state that is
 * neither the old inventory nor the new one.
 *
 * Case-insensitive, mirroring `LOWER(name)` in that index.
 */
export function findDuplicateMasterNames(): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const item of MASTER_INVENTORY) {
    const key = item.name.trim().toLowerCase();
    if (seen.has(key)) {
      duplicates.add(item.name);
    }
    seen.add(key);
  }

  return [...duplicates];
}
