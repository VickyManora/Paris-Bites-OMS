import { NotFoundError } from '../../../domain/errors/domain-error.js';
import type {
  IPurchaseRepository,
  PurchaseFilter,
} from '../../../domain/repositories/purchase.repository.js';
import { createPage, toPageRequest, type Page } from '../../../../shared/pagination.js';
import type {
  ListPurchasesInput,
  PurchaseDto,
  PurchaseSummaryDto,
} from '../../dtos/purchase.dto.js';
import { PurchaseMapper } from '../../mappers/purchase.mapper.js';
import type { IUseCase } from '../../ports/use-case.port.js';

/** Shared so the list and its summary always describe the same filtered set. */
function toFilter(input: ListPurchasesInput): PurchaseFilter {
  return {
    search: input.search,
    supplierId: input.supplierId,
    gstTreatment: input.gstTreatment,
    fromDate: input.fromDate,
    toDate: input.toDate,
    hasInvoiceFile: input.hasInvoiceFile,
  };
}

/**
 * Purchase history: paginated, filtered, sorted, all in SQL.
 *
 * Newest invoice first by default. A purchase list is read to answer "what did we buy
 * recently", not to browse from the beginning of time.
 */
export class ListPurchasesUseCase implements IUseCase<ListPurchasesInput, Page<PurchaseDto>> {
  constructor(private readonly purchases: IPurchaseRepository) {}

  async execute(input: ListPurchasesInput): Promise<Page<PurchaseDto>> {
    const pageRequest = toPageRequest(input.page, input.pageSize);

    const page = await this.purchases.findMany(toFilter(input), pageRequest, {
      field: input.sortField,
      direction: input.sortDirection,
    });

    return createPage(PurchaseMapper.toDtoList(page.items), page.total, pageRequest);
  }
}

export class GetPurchaseUseCase implements IUseCase<{ id: string }, PurchaseDto> {
  constructor(private readonly purchases: IPurchaseRepository) {}

  async execute({ id }: { id: string }): Promise<PurchaseDto> {
    const purchase = await this.purchases.findById(id);

    if (purchase === null) {
      throw new NotFoundError('Purchase', id);
    }

    return PurchaseMapper.toDto(purchase);
  }
}

/**
 * Totals for the current filter, not for all time.
 *
 * Taking the same filter as the list is the point: a user who has narrowed to one supplier
 * and one month wants that period's spend, and a summary that ignored the filter would sit
 * above the table contradicting it.
 */
export class GetPurchaseSummaryUseCase implements IUseCase<
  ListPurchasesInput,
  PurchaseSummaryDto
> {
  constructor(private readonly purchases: IPurchaseRepository) {}

  async execute(input: ListPurchasesInput): Promise<PurchaseSummaryDto> {
    return PurchaseMapper.toSummaryDto(await this.purchases.summary(toFilter(input)));
  }
}
