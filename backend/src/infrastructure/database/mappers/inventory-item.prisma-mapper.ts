import type {
  Prisma,
  InventoryItem as PrismaInventoryItem,
} from '../../../generated/prisma/client.js';
import { InventoryItem } from '../../../core/domain/entities/inventory-item.entity.js';
import {
  InventoryCategory,
  InventoryHistoryAction,
  InventoryItemStatus,
  InventoryLocation,
  InventoryUnit,
  isInventoryLocation,
  isInventoryUnit,
} from '../../../core/domain/enums/inventory.enum.js';
import type { FieldChange } from '../../../core/domain/repositories/inventory-item-history.repository.js';

/**
 * Translates Prisma rows into domain entities.
 *
 * The only place allowed to know both shapes. The exhaustive switches exist so that
 * adding a value to a Prisma enum without adding it to the domain stops compiling here,
 * rather than producing an invalid entity at runtime.
 */

/**
 * `Decimal(12,3)` columns arrive as a Prisma `Decimal`, or as a string from some driver
 * paths. Both are converted here so nothing downstream has to care.
 *
 * Safe for this schema: 12 digits with 3 decimal places is far inside the range a
 * double represents exactly enough, and `InventoryQuantity` rounds to the same scale
 * on the way in.
 */
export function decimalToNumber(value: Prisma.Decimal | string | number | null): number {
  if (value === null) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return Number.parseFloat(value);
  }
  return value.toNumber();
}

export function nullableDecimalToNumber(
  value: Prisma.Decimal | string | number | null,
): number | null {
  return value === null ? null : decimalToNumber(value);
}

function toDomainCategory(category: PrismaInventoryItem['category']): InventoryCategory {
  switch (category) {
    case 'FLOUR_AND_GRAINS':
      return InventoryCategory.FLOUR_AND_GRAINS;
    case 'DAIRY':
      return InventoryCategory.DAIRY;
    case 'CHOCOLATE':
      return InventoryCategory.CHOCOLATE;
    case 'FRUIT':
      return InventoryCategory.FRUIT;
    case 'NUTS_AND_SEEDS':
      return InventoryCategory.NUTS_AND_SEEDS;
    case 'SUGAR_AND_SWEETENERS':
      return InventoryCategory.SUGAR_AND_SWEETENERS;
    case 'FATS_AND_OILS':
      return InventoryCategory.FATS_AND_OILS;
    case 'EGGS':
      return InventoryCategory.EGGS;
    case 'FLAVOURING':
      return InventoryCategory.FLAVOURING;
    case 'DECORATION':
      return InventoryCategory.DECORATION;
    case 'PACKAGING':
      return InventoryCategory.PACKAGING;
    case 'EQUIPMENT':
      return InventoryCategory.EQUIPMENT;
    case 'OTHER':
      return InventoryCategory.OTHER;
    case 'WAFFLE_PREMIX':
      return InventoryCategory.WAFFLE_PREMIX;
    case 'BOWL_PREMIX':
      return InventoryCategory.BOWL_PREMIX;
    case 'CHOCOLATE_FILLINGS':
      return InventoryCategory.CHOCOLATE_FILLINGS;
    case 'SPREADS_AND_SAUCES':
      return InventoryCategory.SPREADS_AND_SAUCES;
    case 'TOPPINGS_AND_FLAVOURS':
      return InventoryCategory.TOPPINGS_AND_FLAVOURS;
    case 'KITCHEN_ESSENTIALS':
      return InventoryCategory.KITCHEN_ESSENTIALS;
    case 'CLEANING_AND_HYGIENE':
      return InventoryCategory.CLEANING_AND_HYGIENE;
  }
}

function toDomainUnit(unit: PrismaInventoryItem['unit']): InventoryUnit {
  switch (unit) {
    case 'KG':
      return InventoryUnit.KG;
    case 'GRAMS':
      return InventoryUnit.GRAMS;
    case 'LITERS':
      return InventoryUnit.LITERS;
    case 'PIECES':
      return InventoryUnit.PIECES;
    case 'BOXES':
      return InventoryUnit.BOXES;
    case 'PACKETS':
      return InventoryUnit.PACKETS;
    case 'SHEETS':
      return InventoryUnit.SHEETS;
    case 'BOTTLES':
      return InventoryUnit.BOTTLES;
  }
}

/**
 * Location conversion for callers that hold the value as a plain string — raw SQL reads,
 * and the transfer mapper. Throws rather than defaulting: a location the domain does not
 * know would silently misroute stock.
 */
export function toDomainLocationFromString(location: string): InventoryLocation {
  if (!isInventoryLocation(location)) {
    throw new Error(`Unrecognised inventory location from database: "${location}"`);
  }
  return location;
}

/**
 * Same conversion for a raw SQL read, where the enum arrives as a plain string.
 *
 * Throws on an unrecognised value rather than defaulting: a unit the domain does not
 * know would silently change how quantities are validated, and a loud failure is far
 * better than quietly accepting fractional boxes.
 */
export function toDomainUnitFromString(unit: string): InventoryUnit {
  if (!isInventoryUnit(unit)) {
    throw new Error(`Unrecognised inventory unit from database: "${unit}"`);
  }
  return unit;
}

function toDomainLocation(location: PrismaInventoryItem['location']): InventoryLocation {
  switch (location) {
    case 'HOME_WAREHOUSE':
      return InventoryLocation.HOME_WAREHOUSE;
    case 'CART':
      return InventoryLocation.CART;
  }
}

function toDomainStatus(status: PrismaInventoryItem['status']): InventoryItemStatus {
  switch (status) {
    case 'ACTIVE':
      return InventoryItemStatus.ACTIVE;
    case 'INACTIVE':
      return InventoryItemStatus.INACTIVE;
  }
}

export function toDomainHistoryAction(action: string): InventoryHistoryAction {
  switch (action) {
    case 'CREATED':
      return InventoryHistoryAction.CREATED;
    case 'UPDATED':
      return InventoryHistoryAction.UPDATED;
    case 'QUANTITY_ADJUSTED':
      return InventoryHistoryAction.QUANTITY_ADJUSTED;
    case 'STATUS_CHANGED':
      return InventoryHistoryAction.STATUS_CHANGED;
    case 'DELETED':
      return InventoryHistoryAction.DELETED;
    case 'RESTORED':
      return InventoryHistoryAction.RESTORED;
    case 'TRANSFER_OUT':
      return InventoryHistoryAction.TRANSFER_OUT;
    case 'TRANSFER_IN':
      return InventoryHistoryAction.TRANSFER_IN;
    case 'PURCHASED':
      return InventoryHistoryAction.PURCHASED;
    case 'RECIPE_CONSUMED':
      return InventoryHistoryAction.RECIPE_CONSUMED;
    case 'CONSUMED':
      return InventoryHistoryAction.CONSUMED;
    default:
      // Unreachable via Prisma's typed enum, but this method also serves raw SQL
      // reads where the value is a plain string.
      return InventoryHistoryAction.UPDATED;
  }
}

/** Narrows the `changes` JSON column, which Prisma types as `JsonValue`. */
export function toFieldChanges(value: unknown): Readonly<Record<string, FieldChange>> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const result: Record<string, FieldChange> = {};

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const { from, to } = entry as { from?: unknown; to?: unknown };

    result[key] = {
      from: (from ?? null) as string | number | null,
      to: (to ?? null) as string | number | null,
    };
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * An item row with its supplier's name joined in.
 *
 * The relation is optional so a query that has no reason to join — the locking read in
 * `adjustQuantity`, for one — is not forced to. An absent relation and a null supplier
 * both resolve to a null name, because "not loaded" and "no supplier" look identical to
 * a display field and neither is worth a distinct rendering.
 */
export type InventoryItemRow = PrismaInventoryItem & {
  readonly supplier?: { readonly name: string } | null;
};

/** What every item query must select so `supplierName` resolves. */
export const INVENTORY_ITEM_INCLUDE = {
  supplier: { select: { name: true } },
} as const;

export const InventoryItemPrismaMapper = {
  toDomain(row: InventoryItemRow): InventoryItem {
    return InventoryItem.fromPersistence({
      id: row.id,
      name: row.name,
      category: toDomainCategory(row.category),
      unit: toDomainUnit(row.unit),
      location: toDomainLocation(row.location),
      currentQuantity: decimalToNumber(row.currentQuantity),
      openingQuantity: decimalToNumber(row.openingQuantity),
      minimumQuantity: decimalToNumber(row.minimumQuantity),
      // Nullable, unlike the quantities: `decimalToNumber` maps null to 0, which for a
      // price would turn "not priced" into "free".
      purchasePrice: nullableDecimalToNumber(row.purchasePrice),
      supplierId: row.supplierId,
      supplierName: row.supplier?.name ?? null,
      lowStockAlertEnabled: row.lowStockAlertEnabled,
      batchNumber: row.batchNumber,
      expiryDate: row.expiryDate,
      status: toDomainStatus(row.status),
      notes: row.notes,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  },

  toDomainList(rows: readonly InventoryItemRow[]): InventoryItem[] {
    return rows.map((row) => InventoryItemPrismaMapper.toDomain(row));
  },
} as const;
