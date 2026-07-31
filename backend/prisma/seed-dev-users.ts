// Runs standalone via tsx, so it must load .env itself — unlike the API, which
// gets it through src/config/env.ts.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { PrismaClient, type Role } from '../src/generated/prisma/client.js';

/**
 * Creates the two throwaway accounts used while developing, with passwords equal to their own
 * names: `admin`/`admin` and `sunil`/`sunil`.
 *
 * Paired with `DEV_LOGIN_DOMAIN=parisbites.local` in `.env`, which is what lets the login form
 * accept the bare name — see `loginIdentifierSchema`.
 *
 * ## Why this is a separate file from `seed.ts`
 *
 * `seed.ts` deliberately refuses to do any of this: it takes passwords only from the
 * environment, requires ten characters, and never overwrites an existing account, on the
 * grounds that a seeded account with a known password is a backdoor and seeds get run against
 * staging by accident. That reasoning is correct and this script does not weaken it — it sits
 * beside it, does the opposite on purpose, and pays for the privilege with the two guards
 * below. `npm run prisma:seed` is unchanged and still safe to point anywhere.
 *
 * ## The guards
 *
 * Refuses to run unless **both** hold:
 *
 * 1. `NODE_ENV` is not `production`.
 * 2. `DATABASE_URL` points at a loopback host.
 *
 * Two checks rather than one because they fail independently and the second is the one that
 * actually matters. `NODE_ENV` is unset or `development` on a laptop *and* in a hundred CI and
 * container images that have a real database URL, so on its own it would not stop the accident
 * this script is most likely to cause: running it with a staging `DATABASE_URL` still in the
 * shell. The host check is what makes "this cannot touch a shared database" true rather than
 * merely likely.
 *
 * Unlike `seed.ts` this one **upserts**, resetting the password of an account that already
 * exists. That is the point — a local database whose admin password has drifted is exactly the
 * situation you run this to fix — and it is also precisely why it must never reach a real
 * deployment.
 */
const connectionString = process.env['DATABASE_URL'];

if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATABASE_URL must be set before seeding.');
}

if (process.env['NODE_ENV'] === 'production') {
  throw new Error('seed-dev-users refuses to run with NODE_ENV=production.');
}

/**
 * True when the connection string names a loopback host.
 *
 * Parsed with `URL` rather than matched with a regex: a substring test for "localhost" would
 * pass happily on `postgres://user@prod.example.com/db?host=localhost`, which is the sort of
 * near-miss a guard like this exists to catch. An unparseable string is treated as *not* local,
 * because the safe answer to "I cannot tell where this points" is to refuse.
 */
function isLoopback(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

if (!isLoopback(connectionString)) {
  throw new Error(
    'seed-dev-users refuses to run: DATABASE_URL does not point at localhost.\n' +
      'These accounts have guessable passwords and must never exist on a shared database.',
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// Matches `seed.ts`. Kept high even though these are throwaway accounts, so a local login
// exercises the same hashing cost as a real one and a slow bcrypt cannot hide until production.
const SALT_ROUNDS = 12;

interface DevUser {
  readonly username: string;
  readonly password: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: Role;
}

/** The domain must agree with `DEV_LOGIN_DOMAIN`, or the bare name will not resolve. */
const DEV_DOMAIN = (process.env['DEV_LOGIN_DOMAIN'] ?? 'parisbites.local').toLowerCase();

const DEV_USERS: readonly DevUser[] = [
  {
    username: 'admin',
    password: 'admin',
    firstName: 'Paris',
    lastName: 'Admin',
    role: 'ADMIN',
  },
  {
    username: 'sunil',
    password: 'sunil',
    firstName: 'Sunil',
    lastName: 'Counter',
    role: 'STORE_MANAGER',
  },
];

async function seedDevUser(user: DevUser): Promise<void> {
  const email = `${user.username}@${DEV_DOMAIN}`;
  const passwordHash = await bcrypt.hash(user.password, SALT_ROUNDS);

  await prisma.user.upsert({
    where: { email },
    // Resets the password and clears a soft delete or suspension, so the account is usable
    // whatever state a previous experiment left it in.
    update: {
      passwordHash,
      role: user.role,
      status: 'ACTIVE',
      deletedAt: null,
    },
    create: {
      email,
      passwordHash,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: 'ACTIVE',
    },
  });

  process.stdout.write(
    `${user.role.padEnd(13)} ${user.username.padEnd(6)} / ${user.password.padEnd(6)}  (${email})\n`,
  );
}

async function main(): Promise<void> {
  process.stdout.write('\nDevelopment accounts — username / password:\n\n');

  for (const user of DEV_USERS) {
    await seedDevUser(user);
  }

  process.stdout.write(
    `\nSet DEV_LOGIN_DOMAIN=${DEV_DOMAIN} in backend/.env to sign in with the bare name.\n\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Dev user seed failed: ${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
