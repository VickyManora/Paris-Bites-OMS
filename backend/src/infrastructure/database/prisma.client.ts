import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { env, isDevelopment, isProduction } from '../../config/env.js';

/**
 * How many connections this process may hold.
 *
 * The development default of **1 is a correctness requirement, not a tuning choice**.
 * `prisma dev` runs PGlite and multiplexes every connection onto one backend session, so a
 * transaction opened on one connection and a query issued on another interleave inside
 * that single session and corrupt it — measured at roughly 45% of non-transactional
 * requests failing under four-way concurrency. Serialising onto one connection makes the
 * overlap impossible, and costs about nothing locally.
 *
 * `DATABASE_POOL_MAX` in `env.ts` carries the full reasoning and is the override for
 * anyone running a real local Postgres, which isolates sessions properly and needs no such
 * restraint.
 *
 * In production, size this against the database's own ceiling — on Neon that is small, and
 * interactive transactions pin a connection for their whole duration.
 *
 * Exported so startup can report it: a pool of 1 is surprising enough that it must never
 * be a silent default.
 */
export function poolSize(): number {
  return env.DATABASE_POOL_MAX ?? (isProduction ? 10 : 1);
}

/**
 * Single Prisma instance for the process.
 *
 * Prisma 7 connects through a driver adapter rather than a bundled engine
 * binary, so the Postgres driver is supplied explicitly below. One benefit is
 * that pool sizing is now ours to control — which matters on Neon, where the
 * connection budget is small.
 *
 * The client is reused across requests because it owns that pool; constructing
 * one per request would exhaust Postgres almost immediately.
 */
function createPrismaClient(): PrismaClient {
  const max = poolSize();

  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max,
    idleTimeoutMillis: 30_000,
    /*
     * Also bounds how long a query waits for a free connection, which matters far more at
     * `max: 1`: every request queues behind the one in flight. Ten seconds is generous for
     * a local database and still fails loudly rather than hanging a request forever.
     */
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter,
    log: isProduction ? ['error', 'warn'] : ['query', 'info', 'warn', 'error'],
  });
}

/**
 * In development, `tsx watch` reloads the module graph on every save. Caching
 * the client on `globalThis` prevents a new pool per reload, which otherwise
 * surfaces as "too many connections" after a few minutes of editing.
 */
const globalForPrisma = globalThis as typeof globalThis & {
  __parisBitesPrisma?: PrismaClient;
};

export const prisma: PrismaClient = globalForPrisma.__parisBitesPrisma ?? createPrismaClient();

if (isDevelopment) {
  globalForPrisma.__parisBitesPrisma = prisma;
}

/** Verifies the database is reachable. Called by the readiness probe. */
export async function checkDatabaseConnection(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
