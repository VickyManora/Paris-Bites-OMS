import { NotFoundError } from '../../../domain/errors/domain-error.js';
import type { IStockTransferRepository } from '../../../domain/repositories/stock-transfer.repository.js';
import { createPage, toPageRequest, type Page } from '../../../../shared/pagination.js';
import type {
  ListStockTransfersInput,
  StockTransferDto,
  TransferSummaryDto,
} from '../../dtos/stock-transfer.dto.js';
import { StockTransferMapper } from '../../mappers/stock-transfer.mapper.js';
import type { IUseCase } from '../../ports/use-case.port.js';

/**
 * Paginated, filtered, sorted transfer list — all applied in SQL.
 *
 * Newest first by default: a transfer list is a work queue, and the thing needing a decision
 * is the most recent one.
 */
export class ListStockTransfersUseCase implements IUseCase<
  ListStockTransfersInput,
  Page<StockTransferDto>
> {
  constructor(private readonly transfers: IStockTransferRepository) {}

  async execute(input: ListStockTransfersInput): Promise<Page<StockTransferDto>> {
    const pageRequest = toPageRequest(input.page, input.pageSize);

    const page = await this.transfers.findMany(
      { status: input.status, search: input.search },
      pageRequest,
      { field: input.sortField, direction: input.sortDirection },
    );

    return createPage(StockTransferMapper.toDtoList(page.items), page.total, pageRequest);
  }
}

/** One transfer with its lines — the "Transfer Details" view. */
export class GetStockTransferUseCase implements IUseCase<{ id: string }, StockTransferDto> {
  constructor(private readonly transfers: IStockTransferRepository) {}

  async execute({ id }: { id: string }): Promise<StockTransferDto> {
    const transfer = await this.transfers.findById(id);

    if (transfer === null) {
      throw new NotFoundError('Stock transfer', id);
    }

    return StockTransferMapper.toDto(transfer);
  }
}

/** Counts per status, for the list header and the dashboard. */
export class GetTransferSummaryUseCase implements IUseCase<void, TransferSummaryDto> {
  constructor(private readonly transfers: IStockTransferRepository) {}

  async execute(): Promise<TransferSummaryDto> {
    return StockTransferMapper.toSummaryDto(await this.transfers.summary());
  }
}
