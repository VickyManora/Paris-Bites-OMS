import { INVENTORY_LOCATION_LABELS } from '../../../domain/enums/inventory.enum.js';
import { ConflictError } from '../../../domain/errors/domain-error.js';
import { InventoryHistoryAction } from '../../../domain/enums/inventory.enum.js';
import type { IInventoryItemHistoryRepository } from '../../../domain/repositories/inventory-item-history.repository.js';
import type { IInventoryItemRepository } from '../../../domain/repositories/inventory-item.repository.js';
import type { ISupplierRepository } from '../../../domain/repositories/supplier.repository.js';
import { InventoryQuantity } from '../../../domain/value-objects/inventory-quantity.js';
import type { CreateInventoryItemInput, InventoryItemDto } from '../../dtos/inventory.dto.js';
import { InventoryMapper } from '../../mappers/inventory.mapper.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';
import { resolveSupplierId } from './supplier-reference.js';

export class CreateInventoryItemUseCase implements IUseCase<
  CreateInventoryItemInput,
  InventoryItemDto
> {
  constructor(
    private readonly items: IInventoryItemRepository,
    private readonly history: IInventoryItemHistoryRepository,
    private readonly suppliers: ISupplierRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: CreateInventoryItemInput): Promise<InventoryItemDto> {
    const name = input.name.trim();

    /*
     * Checked here for a good error message, and enforced by a partial unique index
     * in the database for correctness. Two concurrent creates would both pass this
     * check; the index is what actually prevents the duplicate, and the resulting
     * P2002 is translated by the error middleware.
     */
    const existing = await this.items.findByNameAndLocation(name, input.location);

    if (existing !== null) {
      throw new ConflictError(
        `"${name}" already exists in ${INVENTORY_LOCATION_LABELS[input.location]}.`,
        { name: ['An item with this name already exists at this location.'] },
      );
    }

    // Validated against the unit, so "2.5 boxes" is rejected rather than stored.
    const currentQuantity = InventoryQuantity.normalise(
      input.currentQuantity,
      input.unit,
      'currentQuantity',
    );
    const minimumQuantity = InventoryQuantity.normalise(
      input.minimumQuantity,
      input.unit,
      'minimumQuantity',
    );
    /*
     * Defaults to the current figure rather than to 0.
     *
     * At creation the two describe the same moment: whatever is on the shelf now is
     * what this item opened with. Defaulting to 0 instead would record an opening of
     * nothing for every item entered with stock already in hand, and the variance
     * column of every report built on it would be wrong from the first day.
     */
    const openingQuantity =
      input.openingQuantity === undefined
        ? currentQuantity
        : InventoryQuantity.normalise(input.openingQuantity, input.unit, 'openingQuantity');

    const supplierId = await resolveSupplierId(this.suppliers, input.supplierId);

    const item = await this.items.create({
      name,
      category: input.category,
      unit: input.unit,
      location: input.location,
      currentQuantity,
      openingQuantity,
      minimumQuantity,
      purchasePrice: input.purchasePrice ?? null,
      supplierId: supplierId ?? null,
      // Alerting on by default: an item nobody has thought about is exactly the one
      // worth being told about when it runs out.
      lowStockAlertEnabled: input.lowStockAlertEnabled ?? true,
      batchNumber: input.batchNumber?.trim() ?? null,
      expiryDate: input.expiryDate ?? null,
      status: input.status ?? 'ACTIVE',
      notes: input.notes?.trim() ?? null,
      createdById: input.actorId,
    });

    await this.history.record({
      itemId: item.id,
      action: InventoryHistoryAction.CREATED,
      // Recorded as a quantity change from nothing, so the ledger reads
      // continuously from creation rather than starting mid-story.
      quantityAfter: currentQuantity,
      actorId: input.actorId,
      changes: {
        name: { from: null, to: name },
        category: { from: null, to: input.category },
        location: { from: null, to: input.location },
      },
    });

    this.logger.info('Inventory item created', {
      itemId: item.id,
      name: item.name,
      location: item.location,
      actorId: input.actorId,
    });

    return InventoryMapper.toDto(item);
  }
}
