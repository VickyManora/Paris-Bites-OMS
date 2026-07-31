import type { PrismaClient } from '../../../generated/prisma/client.js';
import { NotFoundError } from '../../../core/domain/errors/domain-error.js';
import type {
  IProductRepository,
  ProductCategoryRow,
  ProductRow,
} from '../../../core/domain/repositories/pos.repository.js';
import { decimalToNumber } from '../mappers/inventory-item.prisma-mapper.js';

/** Shape shared by every product read here. */
const PRODUCT_SELECT = {
  id: true,
  name: true,
  description: true,
  price: true,
  imageUrl: true,
  isAvailable: true,
  displayOrder: true,
  // Needed by the "any 2" combo rule, which pairs bowls within one tier. Selected on every read
  // rather than only the order path, so a product's tier is never a second query.
  categoryId: true,
  category: { select: { name: true } },
} as const;

function toProduct(row: {
  id: string;
  name: string;
  description: string | null;
  price: unknown;
  imageUrl: string | null;
  isAvailable: boolean;
  displayOrder: number;
  categoryId: string;
  category: { name: string } | null;
}): ProductRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: decimalToNumber(row.price as never),
    imageUrl: row.imageUrl,
    isAvailable: row.isAvailable,
    displayOrder: row.displayOrder,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? '',
  };
}

/**
 * The sellable catalogue.
 *
 * Read-heavy and tiny — sixteen products across four categories — so the menu is fetched
 * whole in one query. Paging it would cost a round trip per category on a tablet over mobile
 * data for no benefit.
 */
export class ProductPrismaRepository implements IProductRepository {
  constructor(private readonly client: PrismaClient) {}

  async findMenu(includeUnavailable: boolean): Promise<readonly ProductCategoryRow[]> {
    const categories = await this.client.productCategory.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        icon: true,
        displayOrder: true,
        products: {
          where: { deletedAt: null, ...(includeUnavailable ? {} : { isAvailable: true }) },
          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
          select: PRODUCT_SELECT,
        },
      },
    });

    // Categories with nothing in them are dropped: an empty tab on a POS is a dead end the
    // person at the counter has to discover by tapping it.
    return categories
      .filter((category) => category.products.length > 0)
      .map(
        (category): ProductCategoryRow => ({
          id: category.id,
          name: category.name,
          icon: category.icon,
          displayOrder: category.displayOrder,
          products: category.products.map(toProduct),
        }),
      );
  }

  /**
   * Only live, available products.
   *
   * A caller detects a withdrawn product by comparing the returned count against what it
   * asked for — which is how an order for something taken off the menu mid-order is refused
   * rather than silently priced.
   */
  async findForOrder(productIds: readonly string[]): Promise<readonly ProductRow[]> {
    if (productIds.length === 0) {
      return [];
    }

    const rows = await this.client.product.findMany({
      where: { id: { in: [...productIds] }, deletedAt: null, isAvailable: true },
      select: PRODUCT_SELECT,
    });

    return rows.map(toProduct);
  }

  async setAvailability(id: string, isAvailable: boolean): Promise<ProductRow> {
    const existing = await this.client.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });

    if (existing === null) {
      throw new NotFoundError('Product', id);
    }

    const updated = await this.client.product.update({
      where: { id },
      data: { isAvailable },
      select: PRODUCT_SELECT,
    });

    return toProduct(updated);
  }
}
