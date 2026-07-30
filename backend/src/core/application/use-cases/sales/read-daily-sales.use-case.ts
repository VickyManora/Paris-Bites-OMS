import { NotFoundError } from '../../../domain/errors/domain-error.js';
import type {
  DailySalesFilter,
  IDailySalesRepository,
} from '../../../domain/repositories/daily-sales.repository.js';
import type { Page } from '../../../../shared/pagination.js';
import type {
  DailySalesEntryDto,
  DailySalesSummaryDto,
  ListDailySalesInput,
} from '../../dtos/daily-sales.dto.js';
import { DailySalesMapper } from '../../mappers/daily-sales.mapper.js';
import type { IUseCase } from '../../ports/use-case.port.js';

export class ListDailySalesUseCase
  implements IUseCase<ListDailySalesInput, Page<DailySalesEntryDto>>
{
  constructor(private readonly sales: IDailySalesRepository) {}

  async execute(input: ListDailySalesInput): Promise<Page<DailySalesEntryDto>> {
    const page = await this.sales.findMany(
      {
        ...input.filter,
        sortField: input.sortField,
        sortDirection: input.sortDirection,
      },
      { page: input.page, pageSize: input.pageSize },
    );

    return { ...page, items: DailySalesMapper.toDtoList(page.items) };
  }
}

export class GetDailySalesUseCase implements IUseCase<string, DailySalesEntryDto> {
  constructor(private readonly sales: IDailySalesRepository) {}

  async execute(id: string): Promise<DailySalesEntryDto> {
    const entry = await this.sales.findById(id);

    if (entry === null) {
      throw new NotFoundError('Sales entry', id);
    }

    return DailySalesMapper.toDto(entry);
  }
}

/**
 * The entry for one calendar day, or null.
 *
 * Its own endpoint because the form asks the question every time the date changes: "have
 * we already done this day?" is what decides between recording and editing, and making
 * the client search the list for it would break the moment the day fell off page one.
 */
export class GetDailySalesByDateUseCase implements IUseCase<Date, DailySalesEntryDto | null> {
  constructor(private readonly sales: IDailySalesRepository) {}

  async execute(entryDate: Date): Promise<DailySalesEntryDto | null> {
    const entry = await this.sales.findByDate(entryDate);
    return entry === null ? null : DailySalesMapper.toDto(entry);
  }
}

/** Totals for the *same* filter as the list, so the two can never disagree. */
export class GetDailySalesSummaryUseCase
  implements IUseCase<DailySalesFilter, DailySalesSummaryDto>
{
  constructor(private readonly sales: IDailySalesRepository) {}

  async execute(filter: DailySalesFilter): Promise<DailySalesSummaryDto> {
    return DailySalesMapper.toSummaryDto(await this.sales.summary(filter));
  }
}
