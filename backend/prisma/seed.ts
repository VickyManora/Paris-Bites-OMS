// Runs standalone via tsx, so it must load .env itself — unlike the API, which
// gets it through src/config/env.ts.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { PrismaClient, type Role } from '../src/generated/prisma/client.js';
import { seedInventory } from './seed-inventory.js';

/**
 * Brings a database to a usable baseline: one account per role, and the inventory
 * master list.
 *
 * Idempotent throughout. Accounts are keyed on email and never overwritten, so
 * re-running neither duplicates them nor resets a live password. The inventory step
 * refreshes item *definitions* and leaves counted stock alone — see
 * `seed-inventory.ts` for why that distinction matters.
 *
 * Passwords come from the environment and are never defaulted — a seeded admin
 * with a known password is a backdoor, and seeds have a habit of being run
 * against staging.
 */
const connectionString = process.env['DATABASE_URL'];

if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATABASE_URL must be set before seeding.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const SALT_ROUNDS = 12;

interface SeedUser {
  readonly envKey: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: Role;
}

const SEED_USERS: readonly SeedUser[] = [
  {
    envKey: 'SEED_ADMIN_PASSWORD',
    email: (process.env['SEED_ADMIN_EMAIL'] ?? 'admin@parisbites.local').toLowerCase(),
    firstName: 'Paris',
    lastName: 'Admin',
    role: 'ADMIN',
  },
  {
    envKey: 'SEED_MANAGER_PASSWORD',
    email: (process.env['SEED_MANAGER_EMAIL'] ?? 'manager@parisbites.local').toLowerCase(),
    firstName: 'Store',
    lastName: 'Manager',
    role: 'STORE_MANAGER',
  },
];

async function seedUser(user: SeedUser): Promise<void> {
  const password = process.env[user.envKey];

  if (password === undefined || password.length < 10) {
    process.stdout.write(
      `Skipped ${user.role} (${user.email}): set ${user.envKey} to at least 10 characters.\n`,
    );
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email: user.email } });

  if (existing !== null) {
    process.stdout.write(`Unchanged ${user.role}: ${user.email} already exists.\n`);
    return;
  }

  await prisma.user.create({
    data: {
      email: user.email,
      passwordHash: await bcrypt.hash(password, SALT_ROUNDS),
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: 'ACTIVE',
    },
  });

  process.stdout.write(`Created ${user.role}: ${user.email}\n`);
}

async function main(): Promise<void> {
  for (const user of SEED_USERS) {
    await seedUser(user);
  }

  const total = await prisma.user.count({ where: { deletedAt: null } });

  if (total === 0) {
    throw new Error(
      'No users were created. Set SEED_ADMIN_PASSWORD (and optionally ' +
        'SEED_MANAGER_PASSWORD) before seeding.',
    );
  }

  // After the users, so items created by the seed could be attributed to one later if
  // that is ever wanted. They are attributed to nobody today, which is honest: no person
  // added them.
  await seedInventory(prisma);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Seed failed: ${String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
