import type { IInventoryItemHistoryRepository } from '../../../domain/repositories/inventory-item-history.repository.js';
import type { IInventoryItemRepository } from '../../../domain/repositories/inventory-item.repository.js';
import type { InventoryHistoryEntryDto, InventorySummaryDto } from '../../dtos/inventory.dto.js';
import { InventoryMapper } from '../../mappers/inventory.mapper.js';
import type { IUseCase } from '../../ports/use-case.port.js';

export interface InventoryDashboardDto {
  readonly summary: InventorySummaryDto;
  readonly recentActivity: readonly InventoryHistoryEntryDto[];
}

/**
 * Aggregate figures plus recent activity, for the dashboard.
 *
 * One endpoint rather than several because the dashboard needs all of it to render
 * anything useful; separate calls would produce a visibly staggered load and let the
 * counts and the activity list describe different moments.
 *
 * Counted in SQL, not by fetching every item and reducing in memory — that would break
 * the moment the inventory outgrew one page.
 */
export class GetInventoryDashboardUseCase implements IUseCase<void, InventoryDashboardDto> {
  private static readonly RECENT_ACTIVITY_LIMIT = 8;

  constructor(
    private readonly items: IInventoryItemRepository,
    private readonly history: IInventoryItemHistoryRepository,
  ) {}

  async execute(): Promise<InventoryDashboardDto> {
    // Independent queries, so run them concurrently rather than in sequence.
    const [summary, recent] = await Promise.all([
      this.items.summary(),
      this.history.findRecent(GetInventoryDashboardUseCase.RECENT_ACTIVITY_LIMIT),
    ]);

    return {
      summary: InventoryMapper.toSummaryDto(summary),
      recentActivity: InventoryMapper.toHistoryDtoList(recent),
    };
  }
}
