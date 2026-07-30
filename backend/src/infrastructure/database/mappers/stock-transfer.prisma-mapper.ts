import type { Prisma } from '../../../generated/prisma/client.js';
import { StockTransfer } from '../../../core/domain/entities/stock-transfer.entity.js';
import { StockTransferStatus } from '../../../core/domain/enums/stock-transfer.enum.js';
import { decimalToNumber, toDomainLocationFromString } from './inventory-item.prisma-mapper.js';

/**
 * The relations every transfer read needs.
 *
 * Declared once and shared so no query path accidentally omits the lines and produces a
 * transfer that looks empty. Actor names are selected rather than joined wholesale — a
 * transfer view needs a name, not a user record, and selecting the whole row would drag
 * `passwordHash` into memory.
 */
export const TRANSFER_INCLUDE = {
  lines: { orderBy: { itemName: 'asc' } },
  requestedBy: { select: { firstName: true, lastName: true } },
  reviewedBy: { select: { firstName: true, lastName: true } },
  completedBy: { select: { firstName: true, lastName: true } },
} as const satisfies Prisma.StockTransferInclude;

type TransferRow = Prisma.StockTransferGetPayload<{ include: typeof TRANSFER_INCLUDE }>;

function fullName(actor: { firstName: string; lastName: string } | null): string | null {
  return actor === null ? null : `${actor.firstName} ${actor.lastName}`.trim();
}

function toDomainStatus(status: TransferRow['status']): StockTransferStatus {
  switch (status) {
    case 'PENDING':
      return StockTransferStatus.PENDING;
    case 'APPROVED':
      return StockTransferStatus.APPROVED;
    case 'REJECTED':
      return StockTransferStatus.REJECTED;
    case 'COMPLETED':
      return StockTransferStatus.COMPLETED;
  }
}

export const StockTransferPrismaMapper = {
  toDomain(row: TransferRow): StockTransfer {
    return StockTransfer.fromPersistence({
      id: row.id,
      reference: row.reference,
      fromLocation: toDomainLocationFromString(row.fromLocation),
      toLocation: toDomainLocationFromString(row.toLocation),
      status: toDomainStatus(row.status),
      notes: row.notes,

      requestedById: row.requestedById,
      requestedByName: fullName(row.requestedBy),
      requestedAt: row.requestedAt,

      reviewedById: row.reviewedById,
      reviewedByName: fullName(row.reviewedBy),
      reviewedAt: row.reviewedAt,
      reviewNote: row.reviewNote,

      completedById: row.completedById,
      completedByName: fullName(row.completedBy),
      completedAt: row.completedAt,

      createdAt: row.createdAt,
      updatedAt: row.updatedAt,

      lines: row.lines.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        quantity: decimalToNumber(line.quantity),
        itemName: line.itemName,
        unit: line.unit,
        category: line.category,
      })),
    });
  },

  toDomainList(rows: readonly TransferRow[]): StockTransfer[] {
    return rows.map((row) => StockTransferPrismaMapper.toDomain(row));
  },
} as const;
