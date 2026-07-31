// Runs standalone via tsx, so it must load .env itself — unlike the API, which gets it
// through src/config/env.ts.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { findMissingMenuImages } from './menu-master.js';
import { seedMenu } from './seed-menu.js';

/**
 * Applies the POS menu on its own: `npm run prisma:seed:menu`.
 *
 * Separate from `prisma:seed` for the same reason the inventory seed is — the menu is edited
 * far more often than accounts are created, and refreshing prices should not require
 * running everything else.
 */
const connectionString = process.env['DATABASE_URL'];

if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATABASE_URL must be set before seeding.');
}

/*
 * Photos are checked before anything is written. The seed is the last point where a bad path
 * is cheap to notice — after this it is a broken card at the counter during a shift.
 *
 * Skipped when the frontend is not checked out beside the backend, since the API can be
 * deployed on its own and a missing sibling directory is not a menu error.
 */
const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'public');
const missing = existsSync(publicDir) ? findMissingMenuImages(publicDir) : [];

if (missing.length > 0) {
  throw new Error(
    `These menu photos are missing from frontend/public:\n  ${missing.join('\n  ')}\n` +
      'Add the file, or drop the `image` from menu-master.ts to fall back to the emoji.',
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

seedMenu(prisma)
  .then((result) => {
    process.stdout.write(
      `Menu seeded: ${String(result.categoriesCreated)} categories created, ` +
        `${String(result.categoriesUpdated)} updated; ` +
        `${String(result.productsCreated)} products created, ` +
        `${String(result.productsUpdated)} updated, ` +
        `${String(result.productsRetired)} retired.\n`,
    );
  })
  .catch((error: unknown) => {
    process.stderr.write(`Menu seed failed: ${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
