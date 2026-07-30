import type { StockTransfer } from '../../domain/entities/stock-transfer.entity.js';
import {
  INVENTORY_CATEGORY_LABELS,
  INVENTORY_LOCATION_LABELS,
  INVENTORY_UNIT_ABBREVIATIONS,
} from '../../domain/enums/inventory.enum.js';
import {
  canTransition,
  StockTransferStatus,
  TRANSFER_STATUS_LABELS,
} from '../../domain/enums/stock-transfer.enum.js';
import type { TransferSummary } from '../../domain/repositories/stock-transfer.repository.js';
import type {
  StockTransferDto,
  StockTransferLineDto,
  TransferSummaryDto,
} from '../dtos/stock-transfer.dto.js';

/**
 * Domain entity to outbound DTO.
 *
 * The `canApprove` / `canReject` / `canComplete` flags come from the same
 * `canTransition` table the entity guards with, so the UI's available actions and the
 * server's accepted ones cannot disagree. A client that re-derived them from the status
 * string would drift the first time a transition changed.
 */
export const StockTransferMapper = {
  toDto(transfer: StockTransfer): StockTransferDto {
    const status = transfer.status;

    return {
      id: transfer.id,
      reference: transfer.reference,
      fromLocation: transfer.fromLocation,
      fromLocationLabel: INVENTORY_LOCATION_LABELS[transfer.fromLocation],
      toLocation: transfer.toLocation,
      toLocationLabel: INVENTORY_LOCATION_LABELS[transfer.toLocation],
      status,
      statusLabel: TRANSFER_STATUS_LABELS[status],
      notes: transfer.notes,

      canApprove: canTransition(status, StockTransferStatus.APPROVED),
      canReject: canTransition(status, StockTransferStatus.REJECTED),
      canComplete: canTransition(status, StockTransferStatus.COMPLETED),
      isInTransit: transfer.isInTransit,

      lineCount: transfer.lineCount,
      lines: transfer.lines.map((line): StockTransferLineDto => {
        const abbreviation = INVENTORY_UNIT_ABBREVIATIONS[line.unit];

        return {
          id: line.id,
          itemId: line.itemId,
          itemName: line.itemName,
          quantity: line.quantity,
          unit: line.unit,
          unitAbbreviation: abbreviation,
          category: line.category,
          categoryLabel: INVENTORY_CATEGORY_LABELS[line.category],
          displayQuantity: `${line.quantity} ${abbreviation}`,
        };
      }),

      requestedByName: transfer.toProps().requestedByName,
      requestedAt: transfer.requestedAt.toISOString(),
      reviewedByName: transfer.toProps().reviewedByName,
      reviewedAt: transfer.toProps().reviewedAt?.toISOString() ?? null,
      reviewNote: transfer.toProps().reviewNote,
      completedByName: transfer.toProps().completedByName,
      completedAt: transfer.toProps().completedAt?.toISOString() ?? null,
    };
  },

  toDtoList(transfers: readonly StockTransfer[]): StockTransferDto[] {
    return transfers.map((transfer) => StockTransferMapper.toDto(transfer));
  },

  toSummaryDto(summary: TransferSummary): TransferSummaryDto {
    return {
      pending: summary.pending,
      inTransit: summary.inTransit,
      completed: summary.completed,
      rejected: summary.rejected,
    };
  },
} as const;
