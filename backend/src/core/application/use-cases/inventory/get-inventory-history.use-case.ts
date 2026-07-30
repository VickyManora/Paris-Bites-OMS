import { NotFoundError } from '../../../domain/errors/domain-error.js';
import type { IInventoryItemHistoryRepository } from '../../../domain/repositories/inventory-item-history.repository.js';
import type { IInventoryItemRepository } from '../../../domain/repositories/inventory-item.repository.js';
import { createPage, toPageRequest, type Page } from '../../../../shared/pagination.js';
import type {
  GetInventoryHistoryInput,
  InventoryHistoryEntryDto,
} from '../../dtos/inventory.dto.js';
import { InventoryMapper } from '../../mappers/inventory.mapper.js';
import type { IUseCase } from '../../ports/use-case.port.js';

/**
 * Paginated change history for one item.
 *
 * Reads the item first so an unknown id is a 404 rather than an empty list — an empty
 * page would be indistinguishable from "this item has no history yet".
 *
 * Includes soft-deleted items on purpose: the history of a deleted item is exactly what
 * someone investigating a discrepancy needs.
 */
export class GetInventoryHistoryUseCase implements IUseCase<
  GetInventoryHistoryInput,
  Page<InventoryHistoryEntryDto>
> {
  constructor(
    private readonly items: IInventoryItemRepository,
    private readonly history: IInventoryItemHistoryRepository,
  ) {}

  async execute(input: GetInventoryHistoryInput): Promise<Page<InventoryHistoryEntryDto>> {
    const item = await this.items.findById(input.itemId);

    if (item === null) {
      throw new NotFoundError('Inventory item', input.itemId);
    }

    const pageRequest = toPageRequest(input.page, input.pageSize);
    const page = await this.history.findByItem(input.itemId, pageRequest);

    return createPage(InventoryMapper.toHistoryDtoList(page.items), page.total, pageRequest);
  }
}
