import { NotFoundError } from '../../../domain/errors/domain-error.js';
import type { IInventoryItemRepository } from '../../../domain/repositories/inventory-item.repository.js';
import type { InventoryItemDto } from '../../dtos/inventory.dto.js';
import { InventoryMapper } from '../../mappers/inventory.mapper.js';
import type { IUseCase } from '../../ports/use-case.port.js';

export class GetInventoryItemUseCase implements IUseCase<{ id: string }, InventoryItemDto> {
  constructor(private readonly items: IInventoryItemRepository) {}

  async execute({ id }: { id: string }): Promise<InventoryItemDto> {
    const item = await this.items.findById(id);

    // A soft-deleted item is a 404 to the API: it no longer exists as far as any
    // caller is concerned, and saying "deleted" would leak that it once did.
    if (item === null || item.isDeleted) {
      throw new NotFoundError('Inventory item', id);
    }

    return InventoryMapper.toDto(item);
  }
}
