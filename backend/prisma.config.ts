import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 moved connection configuration out of `schema.prisma` and into this
 * file, so the CLI (migrate / studio / db pull) and the runtime client read the
 * same source of truth. The URL itself always comes from the environment —
 * never commit a real connection string.
 */
const databaseUrl = process.env['DATABASE_URL'];

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  /*
   * Omitted entirely when unset, rather than passed as `undefined`.
   *
   * `prisma generate` runs on postinstall and needs no database, so a fresh
   * clone must be installable before `.env` exists. Commands that do need a
   * connection (migrate, studio, db pull) fail with Prisma's own clear message.
   */
  ...(databaseUrl === undefined ? {} : { datasource: { url: databaseUrl } }),
});
