/**
 * Inventory vocabulary, owned by the domain.
 *
 * Deliberately not re-exported from Prisma's generated enums: the domain must not
 * depend on the persistence layer. `InventoryItemPrismaMapper` bridges the two with
 * exhaustive switches that stop compiling if the two ever diverge.
 */

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

export const InventoryLocation = {
  HOME_WAREHOUSE: 'HOME_WAREHOUSE',
  CART: 'CART',
} as const;

export type InventoryLocation = (typeof InventoryLocation)[keyof typeof InventoryLocation];

export const ALL_INVENTORY_LOCATIONS: readonly InventoryLocation[] = [
  InventoryLocation.HOME_WAREHOUSE,
  InventoryLocation.CART,
];

export const INVENTORY_LOCATION_LABELS: Readonly<Record<InventoryLocation, string>> = {
  [InventoryLocation.HOME_WAREHOUSE]: 'Home Warehouse',
  [InventoryLocation.CART]: 'Cart',
};

export function isInventoryLocation(value: unknown): value is InventoryLocation {
  return typeof value === 'string' && Object.hasOwn(INVENTORY_LOCATION_LABELS, value);
}

// ---------------------------------------------------------------------------
// Unit of measure
// ---------------------------------------------------------------------------

export const InventoryUnit = {
  KG: 'KG',
  GRAMS: 'GRAMS',
  LITERS: 'LITERS',
  PIECES: 'PIECES',
  BOXES: 'BOXES',
  PACKETS: 'PACKETS',
  SHEETS: 'SHEETS',
  BOTTLES: 'BOTTLES',
} as const;

export type InventoryUnit = (typeof InventoryUnit)[keyof typeof InventoryUnit];

export const ALL_INVENTORY_UNITS: readonly InventoryUnit[] = [
  InventoryUnit.KG,
  InventoryUnit.GRAMS,
  InventoryUnit.LITERS,
  InventoryUnit.PIECES,
  InventoryUnit.BOXES,
  InventoryUnit.PACKETS,
  InventoryUnit.SHEETS,
  InventoryUnit.BOTTLES,
];

/** Short form for display beside a number, e.g. "12.5 kg". */
export const INVENTORY_UNIT_ABBREVIATIONS: Readonly<Record<InventoryUnit, string>> = {
  [InventoryUnit.KG]: 'kg',
  [InventoryUnit.GRAMS]: 'g',
  [InventoryUnit.LITERS]: 'L',
  [InventoryUnit.PIECES]: 'pcs',
  [InventoryUnit.BOXES]: 'boxes',
  [InventoryUnit.PACKETS]: 'packets',
  [InventoryUnit.SHEETS]: 'sheets',
  [InventoryUnit.BOTTLES]: 'bottles',
};

export const INVENTORY_UNIT_LABELS: Readonly<Record<InventoryUnit, string>> = {
  [InventoryUnit.KG]: 'Kilograms',
  [InventoryUnit.GRAMS]: 'Grams',
  [InventoryUnit.LITERS]: 'Liters',
  [InventoryUnit.PIECES]: 'Pieces',
  [InventoryUnit.BOXES]: 'Boxes',
  [InventoryUnit.PACKETS]: 'Packets',
  [InventoryUnit.SHEETS]: 'Sheets',
  [InventoryUnit.BOTTLES]: 'Bottles',
};

/**
 * Units that cannot be fractional.
 *
 * Half a piece is not a thing, and allowing it produces quantities like "3.5
 * boxes" that nobody can act on. Enforced in `InventoryQuantity`.
 *
 * Packets, sheets and bottles join the list for the same reason: they are things
 * bought and consumed whole. "2.5 packets of Oreos" is not a measurement anyone can
 * act on — the half-packet is either open (and still one packet on the shelf) or it
 * is not.
 */
const DISCRETE_UNITS: readonly InventoryUnit[] = [
  InventoryUnit.PIECES,
  InventoryUnit.BOXES,
  InventoryUnit.PACKETS,
  InventoryUnit.SHEETS,
  InventoryUnit.BOTTLES,
];

export function isDiscreteUnit(unit: InventoryUnit): boolean {
  return DISCRETE_UNITS.includes(unit);
}

export function isInventoryUnit(value: unknown): value is InventoryUnit {
  return typeof value === 'string' && Object.hasOwn(INVENTORY_UNIT_LABELS, value);
}

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

export const InventoryCategory = {
  FLOUR_AND_GRAINS: 'FLOUR_AND_GRAINS',
  DAIRY: 'DAIRY',
  CHOCOLATE: 'CHOCOLATE',
  FRUIT: 'FRUIT',
  NUTS_AND_SEEDS: 'NUTS_AND_SEEDS',
  SUGAR_AND_SWEETENERS: 'SUGAR_AND_SWEETENERS',
  FATS_AND_OILS: 'FATS_AND_OILS',
  EGGS: 'EGGS',
  FLAVOURING: 'FLAVOURING',
  DECORATION: 'DECORATION',
  PACKAGING: 'PACKAGING',
  EQUIPMENT: 'EQUIPMENT',
  OTHER: 'OTHER',
  WAFFLE_PREMIX: 'WAFFLE_PREMIX',
  BOWL_PREMIX: 'BOWL_PREMIX',
  CHOCOLATE_FILLINGS: 'CHOCOLATE_FILLINGS',
  SPREADS_AND_SAUCES: 'SPREADS_AND_SAUCES',
  TOPPINGS_AND_FLAVOURS: 'TOPPINGS_AND_FLAVOURS',
  KITCHEN_ESSENTIALS: 'KITCHEN_ESSENTIALS',
  CLEANING_AND_HYGIENE: 'CLEANING_AND_HYGIENE',
} as const;

export type InventoryCategory = (typeof InventoryCategory)[keyof typeof InventoryCategory];

export const INVENTORY_CATEGORY_LABELS: Readonly<Record<InventoryCategory, string>> = {
  [InventoryCategory.FLOUR_AND_GRAINS]: 'Flour & grains',
  [InventoryCategory.DAIRY]: 'Dairy',
  [InventoryCategory.CHOCOLATE]: 'Chocolate',
  [InventoryCategory.FRUIT]: 'Fruit',
  [InventoryCategory.NUTS_AND_SEEDS]: 'Nuts & seeds',
  [InventoryCategory.SUGAR_AND_SWEETENERS]: 'Sugar & sweeteners',
  [InventoryCategory.FATS_AND_OILS]: 'Fats & oils',
  [InventoryCategory.EGGS]: 'Eggs',
  [InventoryCategory.FLAVOURING]: 'Flavouring',
  [InventoryCategory.DECORATION]: 'Decoration',
  [InventoryCategory.PACKAGING]: 'Packaging',
  [InventoryCategory.EQUIPMENT]: 'Equipment',
  [InventoryCategory.OTHER]: 'Other',
  [InventoryCategory.WAFFLE_PREMIX]: 'Waffle premix',
  [InventoryCategory.BOWL_PREMIX]: 'Bowl premix',
  [InventoryCategory.CHOCOLATE_FILLINGS]: 'Chocolate fillings',
  [InventoryCategory.SPREADS_AND_SAUCES]: 'Spreads & sauces',
  [InventoryCategory.TOPPINGS_AND_FLAVOURS]: 'Toppings & flavours',
  [InventoryCategory.KITCHEN_ESSENTIALS]: 'Kitchen essentials',
  [InventoryCategory.CLEANING_AND_HYGIENE]: 'Cleaning & hygiene',
};

export const ALL_INVENTORY_CATEGORIES: readonly InventoryCategory[] =
  Object.values(InventoryCategory);

export function isInventoryCategory(value: unknown): value is InventoryCategory {
  return typeof value === 'string' && Object.hasOwn(INVENTORY_CATEGORY_LABELS, value);
}

// ---------------------------------------------------------------------------
// Lifecycle status
// ---------------------------------------------------------------------------

export const InventoryItemStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;

export type InventoryItemStatus = (typeof InventoryItemStatus)[keyof typeof InventoryItemStatus];

export const INVENTORY_ITEM_STATUS_LABELS: Readonly<Record<InventoryItemStatus, string>> = {
  [InventoryItemStatus.ACTIVE]: 'Active',
  [InventoryItemStatus.INACTIVE]: 'Inactive',
};

export const ALL_INVENTORY_ITEM_STATUSES: readonly InventoryItemStatus[] = [
  InventoryItemStatus.ACTIVE,
  InventoryItemStatus.INACTIVE,
];

export function isInventoryItemStatus(value: unknown): value is InventoryItemStatus {
  return typeof value === 'string' && Object.hasOwn(INVENTORY_ITEM_STATUS_LABELS, value);
}

// ---------------------------------------------------------------------------
// Stock status — DERIVED, never stored
// ---------------------------------------------------------------------------

/**
 * Whether an item needs restocking.
 *
 * Computed from `currentQuantity` versus `minimumQuantity` on every read. Storing it
 * would create a second copy of a fact that is already recorded, and the two would
 * disagree the first time a quantity changed without the flag being recalculated.
 */
export const StockStatus = {
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  LOW_STOCK: 'LOW_STOCK',
  IN_STOCK: 'IN_STOCK',
} as const;

export type StockStatus = (typeof StockStatus)[keyof typeof StockStatus];

export const STOCK_STATUS_LABELS: Readonly<Record<StockStatus, string>> = {
  [StockStatus.OUT_OF_STOCK]: 'Out of stock',
  [StockStatus.LOW_STOCK]: 'Low stock',
  [StockStatus.IN_STOCK]: 'In stock',
};

/**
 * The single definition of the low-stock rule.
 *
 * `<=` rather than `<`: hitting the reorder threshold exactly is the moment to
 * reorder, not one unit later.
 *
 * A `minimumQuantity` of 0 means "no threshold set", so such an item is only ever
 * flagged when it reaches zero — otherwise every item without a threshold would sit
 * permanently in the low-stock list and the warning would stop meaning anything.
 */
export function deriveStockStatus(current: number, minimum: number): StockStatus {
  if (current <= 0) {
    return StockStatus.OUT_OF_STOCK;
  }

  if (minimum > 0 && current <= minimum) {
    return StockStatus.LOW_STOCK;
  }

  return StockStatus.IN_STOCK;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export const InventoryHistoryAction = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  QUANTITY_ADJUSTED: 'QUANTITY_ADJUSTED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  DELETED: 'DELETED',
  RESTORED: 'RESTORED',
  /// Stock left this item as part of a transfer (the source leg).
  TRANSFER_OUT: 'TRANSFER_OUT',
  /// Stock arrived at this item as part of a transfer (the destination leg).
  TRANSFER_IN: 'TRANSFER_IN',
  /**
   * Stock arrived by purchase from a supplier.
   *
   * Distinct from `TRANSFER_IN` because the origin is outside the business — which is
   * exactly the line a stock-in report has to draw between goods bought and goods moved
   * between our own locations.
   */
  PURCHASED: 'PURCHASED',
  /**
   * Stock left because a completed order consumed it through a recipe.
   *
   * Reserved for recipe-driven deduction, which has schema support but no code yet.
   * Its own action rather than a noted `QUANTITY_ADJUSTED`, because "what did selling
   * desserts consume" is a question a report groups by, and a free-text note is not
   * something it can group by.
   */
  RECIPE_CONSUMED: 'RECIPE_CONSUMED',
  /**
   * Stock the kitchen used, entered by hand on a daily consumption sheet.
   *
   * Distinct from `RECIPE_CONSUMED`, which a completed order will deduct automatically:
   * this is someone reporting what was actually used, and the two answer different
   * questions when they sit side by side — what the recipes say should have gone, versus
   * what went.
   *
   * One action covers recording, editing and voiding an entry. The signed before/after
   * already says which way the stock moved, so a correction nets off against the figure
   * it corrects when consumption is summed.
   */
  CONSUMED: 'CONSUMED',
} as const;

export type InventoryHistoryAction =
  (typeof InventoryHistoryAction)[keyof typeof InventoryHistoryAction];

export const INVENTORY_HISTORY_ACTION_LABELS: Readonly<Record<InventoryHistoryAction, string>> = {
  [InventoryHistoryAction.CREATED]: 'Created',
  [InventoryHistoryAction.UPDATED]: 'Details updated',
  [InventoryHistoryAction.QUANTITY_ADJUSTED]: 'Quantity adjusted',
  [InventoryHistoryAction.STATUS_CHANGED]: 'Status changed',
  [InventoryHistoryAction.DELETED]: 'Deleted',
  [InventoryHistoryAction.RESTORED]: 'Restored',
  [InventoryHistoryAction.TRANSFER_OUT]: 'Transferred out',
  [InventoryHistoryAction.TRANSFER_IN]: 'Transferred in',
  [InventoryHistoryAction.PURCHASED]: 'Purchased',
  [InventoryHistoryAction.RECIPE_CONSUMED]: 'Consumed by recipe',
  [InventoryHistoryAction.CONSUMED]: 'Consumed',
};
