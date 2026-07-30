import type { PrismaClient } from '../src/generated/prisma/client.js';
import { findDuplicateMenuNames, MENU } from './menu-master.js';

export interface MenuSeedResult {
  readonly categoriesCreated: number;
  readonly categoriesUpdated: number;
  readonly productsCreated: number;
  readonly productsUpdated: number;
}

/**
 * Writes the menu.
 *
 * **Idempotent and non-destructive.** Re-running it refreshes prices and display order but
 * never deletes a product, because `sales_order_items` reference products with `RESTRICT`:
 * a product that has ever been sold cannot be removed without erasing the record of selling
 * it. A product dropped from the menu should be marked unavailable, which is what the POS
 * toggle does.
 *
 * Matching is by lower-cased name, mirroring the partial unique index, so a re-run updates
 * rather than duplicating.
 */
export async function seedMenu(client: PrismaClient): Promise<MenuSeedResult> {
  const duplicates = findDuplicateMenuNames();

  if (duplicates.length > 0) {
    throw new Error(`The menu lists these products twice: ${duplicates.join(', ')}`);
  }

  let categoriesCreated = 0;
  let categoriesUpdated = 0;
  let productsCreated = 0;
  let productsUpdated = 0;

  for (const category of MENU) {
    const existingCategory = await client.productCategory.findFirst({
      where: { name: { equals: category.name, mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });

    const categoryId =
      existingCategory?.id ??
      (
        await client.productCategory.create({
          data: {
            name: category.name,
            icon: category.icon,
            displayOrder: category.displayOrder,
          },
          select: { id: true },
        })
      ).id;

    if (existingCategory === null) {
      categoriesCreated += 1;
    } else {
      await client.productCategory.update({
        where: { id: categoryId },
        data: { icon: category.icon, displayOrder: category.displayOrder, isActive: true },
      });
      categoriesUpdated += 1;
    }

    for (const [index, product] of category.products.entries()) {
      const existing = await client.product.findFirst({
        where: { name: { equals: product.name, mode: 'insensitive' }, deletedAt: null },
        select: { id: true },
      });

      if (existing === null) {
        await client.product.create({
          data: {
            categoryId,
            name: product.name,
            price: product.price,
            displayOrder: index,
            imageUrl: product.image ?? null,
          },
        });
        productsCreated += 1;
        continue;
      }

      /*
       * Price and category are refreshed; `isAvailable` is deliberately left alone.
       *
       * Availability is an operational switch the counter flips when something sells out.
       * Re-running the seed at the start of a shift must not silently put a sold-out bowl
       * back on the menu.
       */
      /*
       * `imageUrl` is written as `?? null` rather than left `undefined`, so deleting a photo
       * from the master actually clears it. Passing `undefined` to Prisma means "leave alone",
       * which would strand a path pointing at a file no longer on disk.
       */
      await client.product.update({
        where: { id: existing.id },
        data: {
          categoryId,
          price: product.price,
          displayOrder: index,
          imageUrl: product.image ?? null,
        },
      });
      productsUpdated += 1;
    }
  }

  return { categoriesCreated, categoriesUpdated, productsCreated, productsUpdated };
}
