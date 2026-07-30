import { NotFoundError } from '../../../domain/errors/domain-error.js';
import type { IConsumptionRepository } from '../../../domain/repositories/consumption.repository.js';
import type { Page } from '../../../../shared/pagination.js';
import type {
  ConsumptionEntryDto,
  ConsumptionSummaryDto,
  GetConsumptionInput,
  ListConsumptionInput,
} from '../../dtos/consumption.dto.js';
import { ConsumptionMapper } from '../../mappers/consumption.mapper.js';
import type { IUseCase } from '../../ports/use-case.port.js';

export class ListConsumptionUseCase implements IUseCase<
  ListConsumptionInput,
  Page<ConsumptionEntryDto>
> {
  constructor(private readonly consumption: IConsumptionRepository) {}

  async execute(input: ListConsumptionInput): Promise<Page<ConsumptionEntryDto>> {
    const page = await this.consumption.findMany(
      input.filter,
      { page: input.page, pageSize: input.pageSize },
      input.sort,
    );

    return { ...page, items: ConsumptionMapper.toDtoList(page.items) };
  }
}

/**
 * Totals for the **same filter** as the list.
 *
 * A count that ignored the filters would say 40 entries next to five visible rows, and
 * the reader would have no way to tell which number answered their question.
 */
export class GetConsumptionSummaryUseCase implements IUseCase<
  ListConsumptionInput,
  ConsumptionSummaryDto
> {
  constructor(private readonly consumption: IConsumptionRepository) {}

  async execute(input: ListConsumptionInput): Promise<ConsumptionSummaryDto> {
    return ConsumptionMapper.toSummaryDto(await this.consumption.summary(input.filter));
  }
}

/** One entry, with its full revision history — which is what the detail screen renders. */
export class GetConsumptionUseCase implements IUseCase<GetConsumptionInput, ConsumptionEntryDto> {
  constructor(private readonly consumption: IConsumptionRepository) {}

  async execute(input: GetConsumptionInput): Promise<ConsumptionEntryDto> {
    const entry = await this.consumption.findById(input.id);

    if (entry === null) {
      throw new NotFoundError('Consumption entry', input.id);
    }

    return ConsumptionMapper.toDto(entry);
  }
}
