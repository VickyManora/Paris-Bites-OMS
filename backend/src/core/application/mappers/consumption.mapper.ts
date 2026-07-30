import {
  ConsumptionEntry,
  type ConsumptionLineProps,
  type ConsumptionRevisionProps,
} from '../../domain/entities/consumption-entry.entity.js';
import { CONSUMPTION_REVISION_ACTION_LABELS } from '../../domain/enums/consumption.enum.js';
import {
  INVENTORY_LOCATION_LABELS,
  INVENTORY_UNIT_ABBREVIATIONS,
} from '../../domain/enums/inventory.enum.js';
import type { ConsumptionSummary } from '../../domain/repositories/consumption.repository.js';
import type {
  ConsumptionEntryDto,
  ConsumptionLineDto,
  ConsumptionRevisionDto,
  ConsumptionSummaryDto,
} from '../dtos/consumption.dto.js';

/**
 * `YYYY-MM-DD`, never a full ISO timestamp.
 *
 * `entryDate` is a Postgres `date`, which the driver hands back as midnight UTC.
 * Serialising that as an instant would let a client in a negative-offset zone render it
 * as the previous day — which on a *daily* consumption sheet would put the whole day's
 * usage under the wrong heading.
 */
function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Domain entity to outbound DTO.
 *
 * Labels are resolved here rather than on the client so that every consumer — web, a
 * future export — shows the same wording.
 */
export const ConsumptionMapper = {
  toLineDto(line: ConsumptionLineProps): ConsumptionLineDto {
    return {
      id: line.id,
      itemId: line.itemId,
      itemName: line.itemName,
      unit: line.unit,
      unitAbbreviation: INVENTORY_UNIT_ABBREVIATIONS[line.unit],
      quantity: line.quantity,
      displayQuantity: ConsumptionEntry.displayQuantity(line),
      notes: line.notes,
    };
  },

  toRevisionDto(revision: ConsumptionRevisionProps): ConsumptionRevisionDto {
    return {
      id: revision.id,
      revision: revision.revision,
      action: revision.action,
      actionLabel: CONSUMPTION_REVISION_ACTION_LABELS[revision.action],
      snapshot: revision.snapshot,
      note: revision.note,
      actorName: revision.actorName,
      createdAt: revision.createdAt.toISOString(),
    };
  },

  toDto(entry: ConsumptionEntry): ConsumptionEntryDto {
    return {
      id: entry.id,
      entryDate: toDateOnly(entry.entryDate),
      location: entry.location,
      locationLabel: INVENTORY_LOCATION_LABELS[entry.location],
      notes: entry.notes,

      revision: entry.revision,
      isEdited: entry.isEdited,
      isVoided: entry.isVoided,
      voidedByName: entry.voidedByName,
      voidReason: entry.voidReason,

      lineCount: entry.lineCount,
      lines: entry.lines.map((line) => ConsumptionMapper.toLineDto(line)),
      summary: entry.summarise(),

      revisions: entry.revisions.map((revision) => ConsumptionMapper.toRevisionDto(revision)),

      recordedByName: entry.recordedByName,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    };
  },

  toDtoList(entries: readonly ConsumptionEntry[]): ConsumptionEntryDto[] {
    return entries.map((entry) => ConsumptionMapper.toDto(entry));
  },

  toSummaryDto(summary: ConsumptionSummary): ConsumptionSummaryDto {
    return {
      entryCount: summary.entryCount,
      lineCount: summary.lineCount,
      itemCount: summary.itemCount,
      voidedCount: summary.voidedCount,
    };
  },
} as const;
