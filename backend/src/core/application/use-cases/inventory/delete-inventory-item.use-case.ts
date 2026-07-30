import { InventoryHistoryAction } from '../../../domain/enums/inventory.enum.js';
import { NotFoundError } from '../../../domain/errors/domain-error.js';
import type { IInventoryItemHistoryRepository } from '../../../domain/repositories/inventory-item-history.repository.js';
import type { IInventoryItemRepository } from '../../../domain/repositories/inventory-item.repository.js';
import type { DeleteInventoryItemInput } from '../../dtos/inventory.dto.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';

/**
 * Soft-deletes an item.
 *
 * Soft, not hard: the item's history is a record of stock that physically existed, and
 * deleting the row would erase it. The partial unique index is scoped to live rows, so
 * the name becomes available again immediately — a deleted item does not hold its name
 * hostage.
 *
 * Idempotent: deleting an already-deleted item succeeds silently, so a double-click or
 * a retried request does not surface an error for an outcome the user already has.
 */
export class DeleteInventoryItemUseCase implements IUseCase<DeleteInventoryItemInput, void> {
  constructor(
    private readonly items: IInventoryItemRepository,
    private readonly history: IInventoryItemHistoryRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: DeleteInventoryItemInput): Promise<void> {
    const existing = await this.items.findById(input.id);

    if (existing === null) {
      throw new NotFoundError('Inventory item', input.id);
    }

    if (existing.isDeleted) {
      return;
    }

    await this.items.softDelete(input.id);

    await this.history.record({
      itemId: input.id,
      action: InventoryHistoryAction.DELETED,
      // The quantity at deletion is recorded, because "we deleted an item that still
      // had 8 kg on the shelf" is exactly the kind of thing an audit needs to show.
      quantityBefore: existing.currentQuantity,
      actorId: input.actorId,
    });

    this.logger.info('Inventory item deleted', {
      itemId: input.id,
      name: existing.name,
      quantityAtDeletion: existing.currentQuantity,
      actorId: input.actorId,
    });
  }
}
