import type { InventoryItem } from '../../domain/entities/inventory-item.entity.js';
import {
  INVENTORY_CATEGORY_LABELS,
  INVENTORY_HISTORY_ACTION_LABELS,
  INVENTORY_LOCATION_LABELS,
  INVENTORY_UNIT_ABBREVIATIONS,
} from '../../domain/enums/inventory.enum.js';
import type { InventoryHistoryEntry } from '../../domain/repositories/inventory-item-history.repository.js';
import type { InventorySummary } from '../../domain/repositories/inventory-item.repository.js';
import type {
  InventoryHistoryEntryDto,
  InventoryItemDto,
  InventorySummaryDto,
} from '../dtos/inventory.dto.js';

/**
 * `YYYY-MM-DD`, never a full ISO timestamp.
 *
 * Expiry is stored as a Postgres `date`, which the driver hands back as midnight UTC.
 * Serialising that as an instant would let a client in a negative-offset zone render it
 * as the previous day — the one bug a date-only field exists to avoid. Sliced from the
 * UTC form for the same reason: reading local components would reintroduce it.
 */
function toDateOnly(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

/**
 * Domain entity to outbound DTO.
 *
 * Human-readable labels are resolved here rather than on the client so that renaming
 * a category is a server-side change and every consumer — web, a future mobile app, a
 * CSV export — shows the same wording.
 */
export const InventoryMapper = {
  toDto(item: InventoryItem): InventoryItemDto {
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      categoryLabel: INVENTORY_CATEGORY_LABELS[item.category],
      unit: item.unit,
      unitAbbreviation: INVENTORY_UNIT_ABBREVIATIONS[item.unit],
      location: item.location,
      locationLabel: INVENTORY_LOCATION_LABELS[item.location],
      currentQuantity: item.currentQuantity,
      openingQuantity: item.openingQuantity,
      minimumQuantity: item.minimumQuantity,
      purchasePrice: item.purchasePrice,
      supplierId: item.supplierId,
      supplierName: item.supplierName,
      lowStockAlertEnabled: item.lowStockAlertEnabled,
      batchNumber: item.batchNumber,
      expiryDate: toDateOnly(item.expiryDate),
      status: item.status,
      notes: item.notes,

      stockStatus: item.stockStatus,
      needsRestocking: item.needsRestocking,
      shouldAlertLowStock: item.shouldAlertLowStock,
      shortfall: item.shortfall,
      displayQuantity: item.displayQuantity,
      stockValue: item.stockValue,

      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  },

  toDtoList(items: readonly InventoryItem[]): InventoryItemDto[] {
    return items.map((item) => InventoryMapper.toDto(item));
  },

  toHistoryDto(entry: InventoryHistoryEntry): InventoryHistoryEntryDto {
    // Computed here rather than stored: it is a pure function of the two quantities,
    // and a stored copy could contradict them.
    const delta =
      entry.quantityBefore !== null && entry.quantityAfter !== null
        ? Math.round((entry.quantityAfter - entry.quantityBefore) * 1000) / 1000
        : null;

    return {
      id: entry.id,
      itemId: entry.itemId,
      action: entry.action,
      actionLabel: INVENTORY_HISTORY_ACTION_LABELS[entry.action],
      quantityBefore: entry.quantityBefore,
      quantityAfter: entry.quantityAfter,
      delta,
      changes: entry.changes,
      note: entry.note,
      actorName: entry.actorName,
      createdAt: entry.createdAt.toISOString(),
    };
  },

  toHistoryDtoList(entries: readonly InventoryHistoryEntry[]): InventoryHistoryEntryDto[] {
    return entries.map((entry) => InventoryMapper.toHistoryDto(entry));
  },

  toSummaryDto(summary: InventorySummary): InventorySummaryDto {
    return {
      totalItems: summary.totalItems,
      activeItems: summary.activeItems,
      lowStockItems: summary.lowStockItems,
      outOfStockItems: summary.outOfStockItems,
      byLocation: summary.byLocation,
    };
  },
} as const;
