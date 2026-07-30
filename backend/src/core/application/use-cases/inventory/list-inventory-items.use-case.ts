import type { IInventoryItemRepository } from '../../../domain/repositories/inventory-item.repository.js';
import { createPage, toPageRequest, type Page } from '../../../../shared/pagination.js';
import type { InventoryItemDto, ListInventoryItemsInput } from '../../dtos/inventory.dto.js';
import { InventoryMapper } from '../../mappers/inventory.mapper.js';
import type { IUseCase } from '../../ports/use-case.port.js';

/**
 * Lists inventory items with filtering, sorting and pagination.
 *
 * All three are applied in SQL, never in memory. Filtering a page after fetching it
 * would return fewer rows than requested and report a total that does not match what
 * the filter actually selects — the paginator would then offer pages that are empty.
 */
export class ListInventoryItemsUseCase implements IUseCase<
  ListInventoryItemsInput,
  Page<InventoryItemDto>
> {
  constructor(private readonly items: IInventoryItemRepository) {}

  async execute(input: ListInventoryItemsInput): Promise<Page<InventoryItemDto>> {
    // Clamped here as well as by the validator, so a use case called from anywhere
    // else — a script, a job — cannot request the whole table.
    const pageRequest = toPageRequest(input.page, input.pageSize);

    const page = await this.items.findMany(input.filter, pageRequest, {
      field: input.sortField,
      direction: input.sortDirection,
    });

    return createPage(InventoryMapper.toDtoList(page.items), page.total, pageRequest);
  }
}
