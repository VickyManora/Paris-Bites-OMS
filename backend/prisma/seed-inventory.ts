import type { PrismaClient } from '../src/generated/prisma/client.js';
import {
  findDuplicateMasterNames,
  MASTER_INVENTORY,
  MASTER_LOCATIONS,
  type MasterInventoryItem,
} from './inventory-master.js';

/**
 * Makes the inventory match `inventory-master.ts` exactly.
 *
 * Idempotent, and safe to run against a live database. Two properties make that true:
 *
 * 1. **Definitions are replaced; stock levels are not.** An item already present keeps
 *    its `currentQuantity` and `openingQuantity` and has everything else refreshed. A
 *    seed that reset counted stock to zero on every deploy would be a data-loss bug
 *    wearing the costume of a fixture.
 * 2. **Removal degrades rather than fails.** See `purgeItem` below.
 *
 * Every change is written to `inventory_item_history` with a null actor, so the ledger
 * says the system did this and reads continuously across the switch-over rather than
 * showing forty items appearing from nowhere.
 */

/** What the seed did, for the summary it prints. */
interface SeedReport {
  created: number;
  refreshed: number;
  unchanged: number;
  hardDeleted: number;
  softDeleted: string[];
}

/**
 * Removes one item that is not on the master list.
 *
 * Hard delete when nothing references it — the row and its history go, which is what
 * "delete the old inventory" means for the test and sample data this replaces.
 *
 * **Soft delete when a stock transfer or a purchase invoice references it.** Those lines
 * are `ON DELETE RESTRICT` on purpose: a completed transfer or a filed invoice is a
 * record of goods that physically moved, and erasing the item would either fail loudly
 * or, worse, take the financial record with it. Soft-deleting instead removes the item
 * from every list, filter, dashboard and API response — it is gone as far as the
 * application is concerned — while the documents that name it stay readable.
 *
 * The alternative, deleting the transfers and invoices too, was rejected: they are not
 * inventory data, and this task is not licensed to remove them.
 */
async function purgeItem(
  prisma: PrismaClient,
  item: { id: string; name: string; deletedAt: Date | null },
): Promise<'hard' | 'soft' | 'already-gone'> {
  const [transferLines, purchaseLines, recipeLines] = await Promise.all([
    prisma.stockTransferLine.count({ where: { itemId: item.id } }),
    prisma.purchaseLine.count({ where: { itemId: item.id } }),
    prisma.recipeIngredient.count({ where: { itemId: item.id } }),
  ]);

  if (transferLines === 0 && purchaseLines === 0 && recipeLines === 0) {
    // History cascades with the row.
    await prisma.inventoryItem.delete({ where: { id: item.id } });
    return 'hard';
  }

  if (item.deletedAt !== null) {
    return 'already-gone';
  }

  await prisma.inventoryItem.update({
    where: { id: item.id },
    data: {
      deletedAt: new Date(),
      // Also flipped to INACTIVE so anything reading the row directly — a report over
      // historical data, a future restore screen — sees a retired item rather than an
      // active one that merely happens to be hidden.
      status: 'INACTIVE',
      lowStockAlertEnabled: false,
    },
  });

  await prisma.inventoryItemHistory.create({
    data: {
      itemId: item.id,
      action: 'DELETED',
      note: 'Removed by the inventory master-list seed. Retained because transfer or purchase records reference it.',
    },
  });

  return 'soft';
}

/** The definition fields the master list owns. Stock levels are deliberately absent. */
function definitionOf(item: MasterInventoryItem) {
  return {
    category: item.category,
    unit: item.unit,
    minimumQuantity: item.minimumQuantity,
    status: 'ACTIVE' as const,
    lowStockAlertEnabled: true,
    notes: item.notes ?? null,
  };
}

export async function seedInventory(prisma: PrismaClient): Promise<void> {
  const duplicates = findDuplicateMasterNames();

  if (duplicates.length > 0) {
    throw new Error(
      `The inventory master list has duplicate names: ${duplicates.join(', ')}. ` +
        'Fix inventory-master.ts before seeding — the database would reject the second one ' +
        'halfway through and leave the inventory in neither state.',
    );
  }

  const report: SeedReport = {
    created: 0,
    refreshed: 0,
    unchanged: 0,
    hardDeleted: 0,
    softDeleted: [],
  };

  // Keyed the way the partial unique index is: case-insensitive name, per location.
  const keyOf = (name: string, location: string): string =>
    `${name.trim().toLowerCase()}::${location}`;

  // Every master item, once per location: the list defines what the business stocks, and
  // both the warehouse and the cart stock all of it.
  const wanted = new Map(
    MASTER_LOCATIONS.flatMap((location) =>
      MASTER_INVENTORY.map((item) => [keyOf(item.name, location), item] as const),
    ),
  );

  const existing = await prisma.inventoryItem.findMany({
    select: {
      id: true,
      name: true,
      location: true,
      category: true,
      unit: true,
      minimumQuantity: true,
      status: true,
      lowStockAlertEnabled: true,
      notes: true,
      deletedAt: true,
    },
  });

  // --- 1. Remove everything the master list does not name -------------------
  //
  // Done before the upserts, so a name freed by a removal is available to a master item
  // that wants it. Running the two in the other order would hit the unique index.
  for (const item of existing) {
    if (wanted.has(keyOf(item.name, item.location))) {
      continue;
    }

    const outcome = await purgeItem(prisma, item);

    if (outcome === 'hard') {
      report.hardDeleted += 1;
    } else if (outcome === 'soft') {
      report.softDeleted.push(item.name);
    }
  }

  // A soft-deleted row keeps its name out of the *live* index only; a master item may
  // legitimately reuse a name a retired item still holds, which the partial index allows.
  const live = new Map(
    existing
      .filter((item) => item.deletedAt === null)
      .map((item) => [keyOf(item.name, item.location), item] as const),
  );

  // --- 2. Create or refresh every master item, at every location ------------
  for (const location of MASTER_LOCATIONS) {
    for (const item of MASTER_INVENTORY) {
      const name = item.name.trim();
      const current = live.get(keyOf(name, location));
      const definition = definitionOf(item);

      if (current === undefined) {
        const created = await prisma.inventoryItem.create({
          data: {
            name,
            location,
            // Both zero: a new item has nothing on the shelf until someone puts it there
            // through a purchase or an adjustment.
            currentQuantity: 0,
            openingQuantity: 0,
            ...definition,
          },
        });

        await prisma.inventoryItemHistory.create({
          data: {
            itemId: created.id,
            action: 'CREATED',
            // Recorded as a change from nothing, matching the manual create path, so the
            // ledger reads continuously from creation rather than starting mid-story.
            quantityAfter: 0,
            note: 'Created from the inventory master list.',
            changes: {
              name: { from: null, to: name },
              category: { from: null, to: definition.category },
              unit: { from: null, to: definition.unit },
              minimumQuantity: { from: null, to: definition.minimumQuantity },
              location: { from: null, to: location },
            },
          },
        });

        report.created += 1;
        continue;
      }

      // Only genuinely changed fields, so a no-op re-run writes no history — the same rule
      // the update use case follows.
      // Typed as the history column's own shape rather than `unknown`, so the JSON write
      // below type-checks without a cast.
      const changes: Record<
        string,
        { from: string | number | boolean | null; to: string | number | boolean | null }
      > = {};

      if (current.category !== definition.category) {
        changes['category'] = { from: current.category, to: definition.category };
      }
      if (current.unit !== definition.unit) {
        changes['unit'] = { from: current.unit, to: definition.unit };
      }
      if (Number(current.minimumQuantity) !== definition.minimumQuantity) {
        changes['minimumQuantity'] = {
          from: Number(current.minimumQuantity),
          to: definition.minimumQuantity,
        };
      }
      if (current.status !== definition.status) {
        changes['status'] = { from: current.status, to: definition.status };
      }
      if (current.lowStockAlertEnabled !== definition.lowStockAlertEnabled) {
        changes['lowStockAlertEnabled'] = {
          from: current.lowStockAlertEnabled,
          to: definition.lowStockAlertEnabled,
        };
      }
      if ((current.notes ?? null) !== definition.notes) {
        changes['notes'] = { from: current.notes, to: definition.notes };
      }
      // Casing-only corrections count: the index treats "oreo cookies" and "Oreo Cookies"
      // as the same item, but the master list decides how it is spelled.
      if (current.name !== name) {
        changes['name'] = { from: current.name, to: name };
      }

      if (Object.keys(changes).length === 0) {
        report.unchanged += 1;
        continue;
      }

      await prisma.inventoryItem.update({
        where: { id: current.id },
        data: { name, ...definition },
      });

      await prisma.inventoryItemHistory.create({
        data: {
          itemId: current.id,
          action: 'UPDATED',
          changes,
          note: 'Replaced with the definition from the inventory master list.',
        },
      });

      report.refreshed += 1;
    }
  }

  const total = await prisma.inventoryItem.count({ where: { deletedAt: null } });

  process.stdout.write(
    `Inventory master list applied: ${String(report.created)} created, ` +
      `${String(report.refreshed)} refreshed, ${String(report.unchanged)} unchanged, ` +
      `${String(report.hardDeleted)} removed.\n` +
      `Live inventory items: ${String(total)}.\n`,
  );

  if (report.softDeleted.length > 0) {
    // Named rather than counted: these rows are still in the table, and someone
    // reconciling the item count against the master list needs to know why.
    process.stdout.write(
      `Retained as deleted (referenced by transfer or purchase records, hidden from the app): ` +
        `${report.softDeleted.join(', ')}.\n`,
    );
  }
}
