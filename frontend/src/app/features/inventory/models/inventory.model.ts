/**
 * Mirrors the inventory DTOs and enums from the API.
 *
 * The labels below duplicate the server's, which is a deliberate trade: the server sends
 * `categoryLabel` and `locationLabel` on every item so lists never guess, but the
 * *filter dropdowns* need labels for values no item may currently have. Only those
 * option lists use these maps.
 */

import type { BadgeTone } from '../../../shared/components/status-badge/status-badge.component';

export const InventoryLocation = {
  HOME_WAREHOUSE: 'HOME_WAREHOUSE',
  CART: 'CART',
} as const;

export type InventoryLocation = (typeof InventoryLocation)[keyof typeof InventoryLocation];

export const INVENTORY_LOCATION_LABELS: Readonly<Record<InventoryLocation, string>> = {
  HOME_WAREHOUSE: 'Home Warehouse',
  CART: 'Cart',
};

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

export const INVENTORY_UNIT_LABELS: Readonly<Record<InventoryUnit, string>> = {
  KG: 'Kilograms (kg)',
  GRAMS: 'Grams (g)',
  LITERS: 'Liters (L)',
  PIECES: 'Pieces (pcs)',
  BOXES: 'Boxes',
  PACKETS: 'Packets',
  SHEETS: 'Sheets',
  BOTTLES: 'Bottles',
};

export const INVENTORY_UNIT_ABBREVIATIONS: Readonly<Record<InventoryUnit, string>> = {
  KG: 'kg',
  GRAMS: 'g',
  LITERS: 'L',
  PIECES: 'pcs',
  BOXES: 'boxes',
  PACKETS: 'packets',
  SHEETS: 'sheets',
  BOTTLES: 'bottles',
};

/**
 * Units that cannot be fractional.
 *
 * Duplicated from the server so the form can set `step="1"` and reject `2.5` before a
 * round trip. The server re-validates — this is convenience, not the rule.
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
  FLOUR_AND_GRAINS: 'Flour & grains',
  DAIRY: 'Dairy',
  CHOCOLATE: 'Chocolate',
  FRUIT: 'Fruit',
  NUTS_AND_SEEDS: 'Nuts & seeds',
  SUGAR_AND_SWEETENERS: 'Sugar & sweeteners',
  FATS_AND_OILS: 'Fats & oils',
  EGGS: 'Eggs',
  FLAVOURING: 'Flavouring',
  DECORATION: 'Decoration',
  PACKAGING: 'Packaging',
  EQUIPMENT: 'Equipment',
  OTHER: 'Other',
  WAFFLE_PREMIX: 'Waffle premix',
  BOWL_PREMIX: 'Bowl premix',
  CHOCOLATE_FILLINGS: 'Chocolate fillings',
  SPREADS_AND_SAUCES: 'Spreads & sauces',
  TOPPINGS_AND_FLAVOURS: 'Toppings & flavours',
  KITCHEN_ESSENTIALS: 'Kitchen essentials',
  CLEANING_AND_HYGIENE: 'Cleaning & hygiene',
};

export const InventoryItemStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;

export type InventoryItemStatus = (typeof InventoryItemStatus)[keyof typeof InventoryItemStatus];

export const INVENTORY_ITEM_STATUS_LABELS: Readonly<Record<InventoryItemStatus, string>> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

/** Derived server-side and sent with every item — never computed here. */
export const StockStatus = {
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  LOW_STOCK: 'LOW_STOCK',
  IN_STOCK: 'IN_STOCK',
} as const;

export type StockStatus = (typeof StockStatus)[keyof typeof StockStatus];

export const STOCK_STATUS_LABELS: Readonly<Record<StockStatus, string>> = {
  OUT_OF_STOCK: 'Out of stock',
  LOW_STOCK: 'Low stock',
  IN_STOCK: 'In stock',
};

/**
 * The severity each stock status carries, for the badge in the list.
 *
 * Beside the labels rather than in the page, because these two answer one question — how is this
 * status drawn — and splitting them is how a fourth status ends up with a label and no tone.
 *
 * `IN_STOCK` is **success, not neutral**. In a column whose whole job is telling you what needs
 * attention, grey reads as "unknown" rather than as "fine", and the reader is left checking the
 * quantity to find out which.
 */
export const STOCK_STATUS_TONES: Readonly<Record<StockStatus, BadgeTone>> = {
  OUT_OF_STOCK: 'danger',
  LOW_STOCK: 'warning',
  IN_STOCK: 'success',
};

export type InventoryHistoryAction =
  | 'CREATED'
  | 'UPDATED'
  | 'QUANTITY_ADJUSTED'
  | 'STATUS_CHANGED'
  | 'DELETED'
  | 'RESTORED'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'PURCHASED'
  | 'RECIPE_CONSUMED';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface InventoryItem {
  readonly id: string;
  readonly name: string;
  readonly category: InventoryCategory;
  readonly categoryLabel: string;
  readonly unit: InventoryUnit;
  readonly unitAbbreviation: string;
  readonly location: InventoryLocation;
  readonly locationLabel: string;
  readonly currentQuantity: number;
  /** What the item held when it was set up. Frozen at creation, never edited. */
  readonly openingQuantity: number;
  readonly minimumQuantity: number;
  readonly purchasePrice: number | null;
  readonly supplierId: string | null;
  /** Resolved by the API, so the list needs no second request to name a supplier. */
  readonly supplierName: string | null;
  readonly lowStockAlertEnabled: boolean;
  readonly batchNumber: string | null;
  /** `YYYY-MM-DD`. A calendar day, not an instant — never parse it as local time. */
  readonly expiryDate: string | null;
  readonly status: InventoryItemStatus;
  readonly notes: string | null;

  /** Derived by the API, so the low-stock rule has one definition. */
  readonly stockStatus: StockStatus;
  readonly needsRestocking: boolean;
  /**
   * Whether the item should actually raise an alert.
   *
   * Distinct from `needsRestocking`: a silenced item is still low on stock and still
   * appears in the list and the restocking count — it simply does not shout.
   */
  readonly shouldAlertLowStock: boolean;
  readonly shortfall: number;
  readonly displayQuantity: string;
  readonly stockValue: number | null;

  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One entry of the supplier dropdown on the item form.
 *
 * Declared here rather than in a suppliers feature because none exists on the client
 * yet — the API has the endpoint, the inventory form is its only consumer. Move it out
 * the moment a second screen needs suppliers; until then a feature folder holding one
 * interface would be scaffolding, not structure.
 */
export interface SupplierOption {
  readonly id: string;
  readonly name: string;
}

export interface FieldChange {
  readonly from: string | number | null;
  readonly to: string | number | null;
}

export interface InventoryHistoryEntry {
  readonly id: string;
  readonly itemId: string;
  readonly action: InventoryHistoryAction;
  readonly actionLabel: string;
  readonly quantityBefore: number | null;
  readonly quantityAfter: number | null;
  readonly delta: number | null;
  readonly changes: Readonly<Record<string, FieldChange>> | null;
  readonly note: string | null;
  readonly actorName: string | null;
  readonly createdAt: string;
}

export interface InventorySummary {
  readonly totalItems: number;
  readonly activeItems: number;
  readonly lowStockItems: number;
  readonly outOfStockItems: number;
  readonly byLocation: Readonly<Record<InventoryLocation, number>>;
}

export interface InventoryDashboard {
  readonly summary: InventorySummary;
  readonly recentActivity: readonly InventoryHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface CreateInventoryItemRequest {
  readonly name: string;
  readonly category: InventoryCategory;
  readonly unit: InventoryUnit;
  readonly location: InventoryLocation;
  readonly currentQuantity: number;
  /** Omitted means "same as the current quantity", which the API applies. */
  readonly openingQuantity?: number;
  readonly minimumQuantity: number;
  readonly purchasePrice?: number;
  readonly supplierId?: string;
  readonly lowStockAlertEnabled?: boolean;
  readonly batchNumber?: string;
  /** `YYYY-MM-DD`. */
  readonly expiryDate?: string;
  readonly status?: InventoryItemStatus;
  readonly notes?: string;
}

/**
 * No `currentQuantity`: stock changes go through `adjustQuantity`. No `openingQuantity`
 * either — it describes the moment the item was set up, and editing it later would be a
 * rewrite of history rather than a correction.
 *
 * `null` clears an optional field; omitting it leaves the field untouched.
 */
export interface UpdateInventoryItemRequest {
  readonly name?: string;
  readonly category?: InventoryCategory;
  readonly unit?: InventoryUnit;
  readonly location?: InventoryLocation;
  readonly minimumQuantity?: number;
  readonly purchasePrice?: number | null;
  readonly supplierId?: string | null;
  readonly lowStockAlertEnabled?: boolean;
  readonly batchNumber?: string | null;
  /** `YYYY-MM-DD`, or null to clear. */
  readonly expiryDate?: string | null;
  readonly status?: InventoryItemStatus;
  readonly notes?: string | null;
}

/** Either `delta` or `quantity`, never both — the API rejects the ambiguity. */
export interface AdjustQuantityRequest {
  readonly delta?: number;
  readonly quantity?: number;
  readonly note?: string;
}

export const INVENTORY_SORT_FIELDS = [
  'name',
  'category',
  'location',
  'currentQuantity',
  'minimumQuantity',
  'status',
  'updatedAt',
  'createdAt',
] as const;

export type InventorySortField = (typeof INVENTORY_SORT_FIELDS)[number];

export interface InventoryQuery {
  readonly search?: string;
  readonly category?: InventoryCategory;
  readonly location?: InventoryLocation;
  readonly unit?: InventoryUnit;
  readonly status?: InventoryItemStatus;
  readonly needsRestocking?: boolean;
  readonly page: number;
  readonly pageSize: number;
  readonly sortField: InventorySortField;
  readonly sortDirection: 'asc' | 'desc';
}

/** Option lists for the filter and form dropdowns. */
export const INVENTORY_LOCATION_OPTIONS = (
  Object.keys(INVENTORY_LOCATION_LABELS) as InventoryLocation[]
).map((value) => ({ value, label: INVENTORY_LOCATION_LABELS[value] }));

export const INVENTORY_UNIT_OPTIONS = (Object.keys(INVENTORY_UNIT_LABELS) as InventoryUnit[]).map(
  (value) => ({ value, label: INVENTORY_UNIT_LABELS[value] }),
);

export const INVENTORY_CATEGORY_OPTIONS = (
  Object.keys(INVENTORY_CATEGORY_LABELS) as InventoryCategory[]
)
  .map((value) => ({ value, label: INVENTORY_CATEGORY_LABELS[value] }))
  // Alphabetical by label, so a user scanning a 20-item dropdown can find one.
  .sort((a, b) => a.label.localeCompare(b.label));

export const INVENTORY_STATUS_OPTIONS = (
  Object.keys(INVENTORY_ITEM_STATUS_LABELS) as InventoryItemStatus[]
).map((value) => ({ value, label: INVENTORY_ITEM_STATUS_LABELS[value] }));
