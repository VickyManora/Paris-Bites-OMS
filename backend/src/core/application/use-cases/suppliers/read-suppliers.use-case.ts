import { NotFoundError } from '../../../domain/errors/domain-error.js';
import type { ISupplierRepository } from '../../../domain/repositories/supplier.repository.js';
import { createPage, toPageRequest, type Page } from '../../../../shared/pagination.js';
import type {
  ListSuppliersInput,
  SupplierDto,
  SupplierOptionDto,
} from '../../dtos/supplier.dto.js';
import { SupplierMapper } from '../../mappers/supplier.mapper.js';
import type { IUseCase } from '../../ports/use-case.port.js';

/** Paginated, filtered, sorted supplier list — all applied in SQL. */
export class ListSuppliersUseCase implements IUseCase<ListSuppliersInput, Page<SupplierDto>> {
  constructor(private readonly suppliers: ISupplierRepository) {}

  async execute(input: ListSuppliersInput): Promise<Page<SupplierDto>> {
    const pageRequest = toPageRequest(input.page, input.pageSize);

    const page = await this.suppliers.findMany(
      { search: input.search, isActive: input.isActive, stateCode: input.stateCode },
      pageRequest,
      { field: input.sortField, direction: input.sortDirection },
    );

    return createPage(SupplierMapper.toDtoList(page.items), page.total, pageRequest);
  }
}

export class GetSupplierUseCase implements IUseCase<{ id: string }, SupplierDto> {
  constructor(private readonly suppliers: ISupplierRepository) {}

  async execute({ id }: { id: string }): Promise<SupplierDto> {
    const supplier = await this.suppliers.findById(id);

    if (supplier === null || supplier.isDeleted) {
      throw new NotFoundError('Supplier', id);
    }

    return SupplierMapper.toDto(supplier);
  }
}

/**
 * Every supplier the purchase form may offer, unpaginated.
 *
 * Unpaginated because a dropdown that pages is a dropdown the user cannot find their
 * vendor in. Safe here — the row count is bounded by how many suppliers a dessert business
 * has, and the payload is the trimmed option shape rather than the full DTO.
 */
export class ListSupplierOptionsUseCase implements IUseCase<void, readonly SupplierOptionDto[]> {
  constructor(private readonly suppliers: ISupplierRepository) {}

  async execute(): Promise<readonly SupplierOptionDto[]> {
    return SupplierMapper.toOptionList(await this.suppliers.findSelectable());
  }
}
