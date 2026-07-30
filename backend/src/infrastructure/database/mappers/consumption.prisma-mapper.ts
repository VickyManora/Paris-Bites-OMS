import type {
  ConsumptionEntry as PrismaConsumptionEntry,
  ConsumptionEntryRevision as PrismaRevision,
  ConsumptionLine as PrismaLine,
} from '../../../generated/prisma/client.js';
import { ConsumptionEntry } from '../../../core/domain/entities/consumption-entry.entity.js';
import { ConsumptionRevisionAction } from '../../../core/domain/enums/consumption.enum.js';
import {
  toDomainLocationFromString,
  toDomainUnitFromString,
  decimalToNumber,
} from './inventory-item.prisma-mapper.js';

/** Everything a consumption entry needs to render, in one query. */
export const CONSUMPTION_ENTRY_INCLUDE = {
  lines: { orderBy: { itemName: 'asc' } },
  revisions: {
    orderBy: { revision: 'desc' },
    include: { actor: { select: { firstName: true, lastName: true } } },
  },
  recordedBy: { select: { firstName: true, lastName: true } },
  voidedBy: { select: { firstName: true, lastName: true } },
} as const;

type PersonRow = { readonly firstName: string; readonly lastName: string } | null;

export type ConsumptionEntryRow = PrismaConsumptionEntry & {
  readonly lines: readonly PrismaLine[];
  readonly revisions?: readonly (PrismaRevision & { readonly actor?: PersonRow })[];
  readonly recordedBy?: PersonRow;
  readonly voidedBy?: PersonRow;
};

function fullName(person: PersonRow | undefined): string | null {
  return person == null ? null : `${person.firstName} ${person.lastName}`;
}

/**
 * Bridges Prisma rows to the domain entity.
 *
 * The exhaustive switch exists so adding a value to the Prisma enum without adding it to
 * the domain stops compiling here, rather than producing an invalid entity at runtime.
 */
function toDomainRevisionAction(action: PrismaRevision['action']): ConsumptionRevisionAction {
  switch (action) {
    case 'CREATED':
      return ConsumptionRevisionAction.CREATED;
    case 'UPDATED':
      return ConsumptionRevisionAction.UPDATED;
    case 'VOIDED':
      return ConsumptionRevisionAction.VOIDED;
  }
}

export const ConsumptionPrismaMapper = {
  toDomain(row: ConsumptionEntryRow): ConsumptionEntry {
    return ConsumptionEntry.fromPersistence({
      id: row.id,
      entryDate: row.entryDate,
      location: toDomainLocationFromString(row.location),
      notes: row.notes,
      revision: row.revision,
      recordedById: row.recordedById,
      recordedByName: fullName(row.recordedBy),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
      voidedByName: fullName(row.voidedBy),
      voidReason: row.voidReason,
      lines: row.lines.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        itemName: line.itemName,
        unit: toDomainUnitFromString(line.unit),
        quantity: decimalToNumber(line.quantity),
        notes: line.notes,
      })),
      revisions: (row.revisions ?? []).map((revision) => ({
        id: revision.id,
        revision: revision.revision,
        action: toDomainRevisionAction(revision.action),
        snapshot: revision.snapshot,
        note: revision.note,
        actorName: fullName(revision.actor),
        createdAt: revision.createdAt,
      })),
    });
  },

  toDomainList(rows: readonly ConsumptionEntryRow[]): ConsumptionEntry[] {
    return rows.map((row) => ConsumptionPrismaMapper.toDomain(row));
  },
} as const;
