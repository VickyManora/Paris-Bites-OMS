import { Permission } from '../../../domain/enums/permission.enum.js';
import { NotFoundError } from '../../../domain/errors/domain-error.js';
import type {
  IPosOrderRepository,
  IProductRepository,
} from '../../../domain/repositories/pos.repository.js';
import type { Page } from '../../../../shared/pagination.js';
import type {
  ListOrdersInput,
  MenuCategoryDto,
  OrderDto,
  PosDaySummaryDto,
} from '../../dtos/pos.dto.js';
import { PosMapper } from '../../mappers/pos.mapper.js';
import type { IUseCase } from '../../ports/use-case.port.js';

export interface MenuQuery {
  /** Include sold-out items. The counter wants them shown greyed out, not hidden. */
  readonly includeUnavailable: boolean;
}

export class GetMenuUseCase implements IUseCase<MenuQuery, readonly MenuCategoryDto[]> {
  constructor(private readonly products: IProductRepository) {}

  async execute(query: MenuQuery): Promise<readonly MenuCategoryDto[]> {
    return PosMapper.toMenuDto(await this.products.findMenu(query.includeUnavailable));
  }
}

export interface ScopedListOrdersInput extends ListOrdersInput {
  readonly actorId: string;
  readonly permissions: readonly Permission[];
}

/**
 * Lists orders, scoped by what the caller may see.
 *
 * Someone without `POS_ORDER_READ_ALL` gets **their own orders from today** — not a filtered
 * view of everything they could widen by editing the query. The restriction is applied here,
 * over whatever filter arrived, so no combination of parameters can escape it.
 */
export class ListOrdersUseCase implements IUseCase<ScopedListOrdersInput, Page<OrderDto>> {
  constructor(private readonly orders: IPosOrderRepository) {}

  async execute(input: ScopedListOrdersInput): Promise<Page<OrderDto>> {
    const readAll = input.permissions.includes(Permission.POS_ORDER_READ_ALL);
    const today = new Date();

    const page = await this.orders.findMany(
      {
        ...input.filter,
        sortField: input.sortField,
        sortDirection: input.sortDirection,
        // Overrides anything the caller sent, deliberately.
        ...(readAll
          ? {}
          : { placedById: input.actorId, fromDate: today, toDate: today }),
      },
      { page: input.page, pageSize: input.pageSize },
    );

    return { ...page, items: PosMapper.toOrderDtoList(page.items) };
  }
}

export interface GetOrderInput {
  readonly id: string;
  readonly actorId: string;
  readonly permissions: readonly Permission[];
}

export class GetOrderUseCase implements IUseCase<GetOrderInput, OrderDto> {
  constructor(private readonly orders: IPosOrderRepository) {}

  async execute(input: GetOrderInput): Promise<OrderDto> {
    const order = await this.orders.findById(input.id);

    /*
     * Someone else's order reports "not found" rather than "forbidden".
     *
     * The two are deliberately indistinguishable: a 403 on a real id and a 404 on a fake one
     * would let anyone enumerate which orders exist.
     */
    if (
      order === null ||
      (!input.permissions.includes(Permission.POS_ORDER_READ_ALL) &&
        order.toProps().placedById !== input.actorId)
    ) {
      throw new NotFoundError('Order', input.id);
    }

    return PosMapper.toOrderDto(order);
  }
}

export interface PosSummaryInput {
  readonly day: Date;
  readonly actorId: string;
  readonly permissions: readonly Permission[];
}

/** The POS home figures, scoped the same way the list is. */
export class GetPosSummaryUseCase implements IUseCase<PosSummaryInput, PosDaySummaryDto> {
  constructor(private readonly orders: IPosOrderRepository) {}

  async execute(input: PosSummaryInput): Promise<PosDaySummaryDto> {
    const readAll = input.permissions.includes(Permission.POS_ORDER_READ_ALL);
    const summary = await this.orders.summaryFor(input.day, readAll ? undefined : input.actorId);

    return PosMapper.toSummaryDto(summary, readAll ? 'all' : 'own');
  }
}
