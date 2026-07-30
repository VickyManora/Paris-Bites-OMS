/**
 * Gives every live inventory item a counterpart at the other location.
 *
 * An item is one thing at one location, so the same ingredient in the warehouse and on
 * the cart are two rows. This backfills whichever side is missing, so both locations
 * carry the full list and either can be counted, adjusted or transferred into without
 * someone first having to create the row by hand.
 *
 *   npm run inventory:mirror-locations            # apply
 *   npm run inventory:mirror-locations -- --dry   # report only, write nothing
 *
 * What a new row copies and what it does not:
 *
 * - **Definition is copied** — category, unit, reorder threshold, notes, status, the
 *   alert flag, and the usual supplier. Those describe the item, and the two sides
 *   describing it differently would be a mistake, not a distinction.
 * - **Stock is not.** `currentQuantity` and `openingQuantity` open at 0: nothing is on
 *   that shelf until someone puts it there through a purchase, transfer or adjustment.
 *   Copying the other location's count would invent stock and double the valuation.
 * - **Price, batch and expiry are left null.** They are facts about stock that was
 *   actually bought, and this row holds none.
 *
 * Idempotent — a second run finds nothing to do. Every creation is written to
 * `inventory_item_history` with a null actor, so the ledger says the system did it.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { PrismaPg } = await import(`${backend}/node_modules/@prisma/adapter-pg/dist/index.js`);
const { PrismaClient } = await import(`${backend}/src/generated/prisma/client.js`);

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL must be set. Run through `npm run inventory:mirror-locations`.');
}

const dryRun = process.argv.includes('--dry');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1 }) });

const LOCATIONS = ['HOME_WAREHOUSE', 'CART'];

// Keyed the way the partial unique index is: case-insensitive name, per location.
// Soft-deleted rows are excluded for the same reason the index excludes them — a retired
// row does not hold its name, and the missing side should be created regardless.
const keyOf = (name, location) => `${name.trim().toLowerCase()}::${location}`;

const live = await prisma.inventoryItem.findMany({
  where: { deletedAt: null },
  select: {
    name: true,
    location: true,
    category: true,
    unit: true,
    minimumQuantity: true,
    status: true,
    lowStockAlertEnabled: true,
    notes: true,
    supplierId: true,
  },
  orderBy: { name: 'asc' },
});

const present = new Set(live.map((item) => keyOf(item.name, item.location)));

const missing = live.flatMap((item) =>
  LOCATIONS.filter(
    (location) => location !== item.location && !present.has(keyOf(item.name, location)),
  ).map((location) => ({ source: item, location })),
);

if (missing.length === 0) {
  console.log(`Nothing to do: all ${live.length} items already exist at both locations.`);
} else if (dryRun) {
  console.log(`Would create ${missing.length} item(s):`);
  for (const { source, location } of missing) {
    console.log(`  ${source.name} -> ${location} (from ${source.location})`);
  }
} else {
  for (const { source, location } of missing) {
    const created = await prisma.inventoryItem.create({
      data: {
        name: source.name,
        location,
        category: source.category,
        unit: source.unit,
        minimumQuantity: source.minimumQuantity,
        status: source.status,
        lowStockAlertEnabled: source.lowStockAlertEnabled,
        notes: source.notes,
        supplierId: source.supplierId,
        currentQuantity: 0,
        openingQuantity: 0,
      },
    });

    await prisma.inventoryItemHistory.create({
      data: {
        itemId: created.id,
        action: 'CREATED',
        // Recorded as a change from nothing, matching the manual create path, so the
        // ledger reads continuously from creation rather than starting mid-story.
        quantityAfter: 0,
        note: `Created to mirror the ${source.location} item, so this item is stocked at both locations.`,
        changes: {
          name: { from: null, to: source.name },
          category: { from: null, to: source.category },
          unit: { from: null, to: source.unit },
          minimumQuantity: { from: null, to: Number(source.minimumQuantity) },
          location: { from: null, to: location },
        },
      },
    });

    console.log(`created  ${source.name} @ ${location}`);
  }

  console.log(`\nCreated ${missing.length} item(s).`);
}

const total = await prisma.inventoryItem.count({ where: { deletedAt: null } });
console.log(`Live inventory items: ${total}.`);

await prisma.$disconnect();
