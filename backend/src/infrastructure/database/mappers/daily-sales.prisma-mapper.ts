import type { Prisma } from '../../../generated/prisma/client.js';
import {
  DailySalesEntry,
  type DailySalesLineProps,
  type DailySalesRevisionProps,
} from '../../../core/domain/entities/daily-sales-entry.entity.js';
import {
  DailySalesRevisionAction,
  SalesChannel,
  SalesPaymentMode,
} from '../../../core/domain/enums/sales.enum.js';
import { decimalToNumber } from './inventory-item.prisma-mapper.js';

/** Joined on every read: a day is meaningless without its buckets. */
export const DAILY_SALES_ENTRY_INCLUDE = {
  lines: { orderBy: [{ channel: 'asc' }, { paymentMode: 'asc' }] },
  recordedBy: { select: { firstName: true, lastName: true } },
} as const satisfies Prisma.DailySalesEntryInclude;

/** Adds the revision trail. Only the detail view asks for it. */
export const DAILY_SALES_ENTRY_DETAIL_INCLUDE = {
  ...DAILY_SALES_ENTRY_INCLUDE,
  revisions: {
    orderBy: { revision: 'desc' },
    include: { actor: { select: { firstName: true, lastName: true } } },
  },
} as const satisfies Prisma.DailySalesEntryInclude;

export type DailySalesEntryRow = Prisma.DailySalesEntryGetPayload<{
  include: typeof DAILY_SALES_ENTRY_DETAIL_INCLUDE;
}>;

type PartialRow = Prisma.DailySalesEntryGetPayload<{ include: typeof DAILY_SALES_ENTRY_INCLUDE }>;

/**
 * Prisma enums to domain enums.
 *
 * Exhaustive switches with no `default`, so a value added to the Prisma enum without a
 * domain counterpart stops the build — which is the whole reason the domain keeps its own
 * copy rather than re-exporting Prisma's.
 */
function toChannel(value: PartialRow['lines'][number]['channel']): SalesChannel {
  switch (value) {
    case 'WALK_IN':
      return SalesChannel.WALK_IN;
    case 'ZOMATO':
      return SalesChannel.ZOMATO;
    case 'SWIGGY':
      return SalesChannel.SWIGGY;
  }
}

function toPaymentMode(value: PartialRow['lines'][number]['paymentMode']): SalesPaymentMode {
  switch (value) {
    case 'CASH':
      return SalesPaymentMode.CASH;
    case 'ONLINE':
      return SalesPaymentMode.ONLINE;
  }
}

function toRevisionAction(value: 'CREATED' | 'UPDATED'): DailySalesRevisionAction {
  switch (value) {
    case 'CREATED':
      return DailySalesRevisionAction.CREATED;
    case 'UPDATED':
      return DailySalesRevisionAction.UPDATED;
  }
}

function fullName(person: { firstName: string; lastName: string } | null | undefined): string | null {
  return person == null ? null : `${person.firstName} ${person.lastName}`;
}

export const DailySalesPrismaMapper = {
  toDomain(row: DailySalesEntryRow | PartialRow): DailySalesEntry {
    const lines: DailySalesLineProps[] = row.lines.map((line) => ({
      id: line.id,
      channel: toChannel(line.channel),
      paymentMode: toPaymentMode(line.paymentMode),
      amount: decimalToNumber(line.amount),
    }));

    const revisions: DailySalesRevisionProps[] =
      'revisions' in row
        ? row.revisions.map((revision) => ({
            id: revision.id,
            revision: revision.revision,
            action: toRevisionAction(revision.action),
            snapshot: revision.snapshot,
            note: revision.note,
            actorName: fullName(revision.actor),
            createdAt: revision.createdAt,
          }))
        : [];

    return DailySalesEntry.fromPersistence({
      id: row.id,
      entryDate: row.entryDate,
      totalAmount: decimalToNumber(row.totalAmount),
      notes: row.notes,
      revision: row.revision,
      recordedById: row.recordedById,
      recordedByName: fullName(row.recordedBy),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
      lines,
      revisions,
    });
  },

  toDomainList(rows: readonly (DailySalesEntryRow | PartialRow)[]): DailySalesEntry[] {
    return rows.map((row) => DailySalesPrismaMapper.toDomain(row));
  },
} as const;
