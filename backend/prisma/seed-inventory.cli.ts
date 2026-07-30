// Runs standalone via tsx, so it must load .env itself — unlike the API, which gets it
// through src/config/env.ts.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedInventory } from './seed-inventory.js';

/**
 * Applies the inventory master list on its own: `npm run prisma:seed:inventory`.
 *
 * Separate from `prisma:seed` so the inventory can be refreshed after editing
 * `inventory-master.ts` without touching accounts, and so the full seed stays the thing
 * that sets up a database from empty.
 */
const connectionString = process.env['DATABASE_URL'];

if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATABASE_URL must be set before seeding.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

seedInventory(prisma)
  .catch((error: unknown) => {
    process.stderr.write(`Inventory seed failed: ${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
