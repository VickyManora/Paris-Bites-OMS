import {
  INVENTORY_LOCATION_LABELS,
  InventoryHistoryAction,
} from '../../../domain/enums/inventory.enum.js';
import { ConflictError, NotFoundError } from '../../../domain/errors/domain-error.js';
import type { FieldChange } from '../../../domain/repositories/inventory-item-history.repository.js';
import type { IInventoryItemHistoryRepository } from '../../../domain/repositories/inventory-item-history.repository.js';
import type {
  IInventoryItemRepository,
  UpdateInventoryItemData,
} from '../../../domain/repositories/inventory-item.repository.js';
import type { ISupplierRepository } from '../../../domain/repositories/supplier.repository.js';
import { InventoryQuantity } from '../../../domain/value-objects/inventory-quantity.js';
import type { InventoryItemDto, UpdateInventoryItemInput } from '../../dtos/inventory.dto.js';
import { InventoryMapper } from '../../mappers/inventory.mapper.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';
import { resolveSupplierId } from './supplier-reference.js';

/**
 * Edits an item's details.
 *
 * Does **not** change `currentQuantity` — see `AdjustInventoryQuantityUseCase`. Keeping
 * stock levels out of the edit form means the history always attributes a quantity
 * change to a deliberate adjustment, and the separate permission gate holds.
 */
export class UpdateInventoryItemUseCase implements IUseCase<
  UpdateInventoryItemInput,
  InventoryItemDto
> {
  constructor(
    private readonly items: IInventoryItemRepository,
    private readonly history: IInventoryItemHistoryRepository,
    private readonly suppliers: ISupplierRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: UpdateInventoryItemInput): Promise<InventoryItemDto> {
    const existing = await this.items.findById(input.id);

    if (existing === null || existing.isDeleted) {
      throw new NotFoundError('Inventory item', input.id);
    }

    const name = input.name?.trim();
    const nextLocation = input.location ?? existing.location;

    // Renaming or moving an item can collide with another live item at the target
    // location, so re-check whenever either changes.
    if (
      (name !== undefined && name.toLowerCase() !== existing.name.toLowerCase()) ||
      nextLocation !== existing.location
    ) {
      const clash = await this.items.findByNameAndLocation(name ?? existing.name, nextLocation);

      if (clash !== null && clash.id !== existing.id) {
        throw new ConflictError(
          `"${name ?? existing.name}" already exists in ${INVENTORY_LOCATION_LABELS[nextLocation]}.`,
          { name: ['An item with this name already exists at this location.'] },
        );
      }
    }

    /*
     * Changing the unit re-validates the *existing* quantities against it.
     *
     * Switching kilograms to boxes when 2.5 are in stock would otherwise leave a
     * fractional count of a discrete unit, so this rejects the change and asks the
     * user to adjust the quantity first.
     */
    const nextUnit = input.unit ?? existing.unit;

    if (nextUnit !== existing.unit) {
      InventoryQuantity.normalise(existing.currentQuantity, nextUnit, 'unit');
    }

    const minimumQuantity =
      input.minimumQuantity === undefined
        ? undefined
        : InventoryQuantity.normalise(input.minimumQuantity, nextUnit, 'minimumQuantity');

    const supplierId = await resolveSupplierId(this.suppliers, input.supplierId);

    const data: UpdateInventoryItemData = {
      ...(name !== undefined && { name }),
      ...(input.category !== undefined && { category: input.category }),
      ...(input.unit !== undefined && { unit: input.unit }),
      ...(input.location !== undefined && { location: input.location }),
      ...(minimumQuantity !== undefined && { minimumQuantity }),
      ...(input.purchasePrice !== undefined && { purchasePrice: input.purchasePrice }),
      ...(supplierId !== undefined && { supplierId }),
      ...(input.lowStockAlertEnabled !== undefined && {
        lowStockAlertEnabled: input.lowStockAlertEnabled,
      }),
      ...(input.batchNumber !== undefined && {
        // An empty string is a cleared field, not a batch called "". Normalising it to
        // null here means the column never holds a value that renders as blank but is
        // not absent — two states the UI could not tell apart.
        batchNumber: input.batchNumber === null ? null : input.batchNumber.trim() || null,
      }),
      ...(input.expiryDate !== undefined && { expiryDate: input.expiryDate }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.notes !== undefined && { notes: input.notes === null ? null : input.notes.trim() }),
    };

    const changes = this.diff({ ...existing.toProps() }, data);

    // Nothing actually changed — return the item untouched rather than writing a
    // meaningless history entry and bumping `updatedAt`.
    if (Object.keys(changes).length === 0) {
      return InventoryMapper.toDto(existing);
    }

    const updated = await this.items.update(input.id, data);

    // A status flip is worth its own action so it stands out in the timeline.
    const statusOnly = Object.keys(changes).length === 1 && changes['status'] !== undefined;

    await this.history.record({
      itemId: updated.id,
      action: statusOnly ? InventoryHistoryAction.STATUS_CHANGED : InventoryHistoryAction.UPDATED,
      changes,
      actorId: input.actorId,
    });

    this.logger.info('Inventory item updated', {
      itemId: updated.id,
      fields: Object.keys(changes),
      actorId: input.actorId,
    });

    return InventoryMapper.toDto(updated);
  }

  /**
   * Field-level before/after for the history entry.
   *
   * Only genuinely changed fields are included, so submitting an unmodified form does
   * not record a change that never happened.
   */
  private diff(
    before: Readonly<Record<string, unknown>>,
    after: UpdateInventoryItemData,
  ): Record<string, FieldChange> {
    const changes: Record<string, FieldChange> = {};

    for (const [key, value] of Object.entries(after)) {
      const previous = before[key];

      if (this.isSameValue(previous, value)) {
        continue;
      }

      changes[key] = {
        from: this.toRecordable(previous),
        to: this.toRecordable(value),
      };
    }

    return changes;
  }

  /**
   * Identity, except that two `Date`s are compared by their instant.
   *
   * `expiryDate` arrives as a freshly parsed object, so `===` would call every save a
   * change and fill the history with edits that changed nothing — the exact noise the
   * field-level diff exists to prevent.
   */
  private isSameValue(previous: unknown, next: unknown): boolean {
    if (previous instanceof Date && next instanceof Date) {
      return previous.getTime() === next.getTime();
    }

    return previous === next;
  }

  /**
   * History stores primitives only, so the JSON column stays readable and diffable.
   *
   * Every updatable field is a string, a number, an enum value or null, so the fallback
   * should be unreachable — it exists so that adding a field of some other type produces
   * a legible history entry rather than "[object Object]".
   */
  private toRecordable(value: unknown): string | number | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      return value;
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    return JSON.stringify(value) ?? null;
  }
}
