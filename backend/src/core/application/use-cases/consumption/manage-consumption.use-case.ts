import { MAX_CONSUMPTION_LINES } from '../../../domain/enums/consumption.enum.js';
import { BusinessRuleError, NotFoundError } from '../../../domain/errors/domain-error.js';
import type { IAuditLogRepository } from '../../../domain/repositories/audit-log.repository.js';
import type {
  ConsumptionLineData,
  IConsumptionRepository,
} from '../../../domain/repositories/consumption.repository.js';
import type {
  ConsumptionLineInput,
  ConsumptionResultDto,
  RecordConsumptionInput,
  UpdateConsumptionInput,
  VoidConsumptionInput,
} from '../../dtos/consumption.dto.js';
import { ConsumptionMapper } from '../../mappers/consumption.mapper.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';
import { CONSUMPTION_ENTITY_TYPE, ConsumptionAuditAction } from './consumption-audit.js';

/**
 * Shared line checks that do not need the database.
 *
 * The duplicate check is the one worth having here rather than leaving to the unique
 * index: the index would reject the write with a constraint name, while this can say
 * which item was listed twice — and "combine them into one line" is the fix, not a retry.
 */
function assertLinesAreSane(lines: readonly ConsumptionLineInput[]): void {
  if (lines.length === 0) {
    throw new BusinessRuleError('Add at least one item to the sheet.', {
      lines: ['Add at least one item.'],
    });
  }

  if (lines.length > MAX_CONSUMPTION_LINES) {
    throw new BusinessRuleError(
      `A consumption sheet can hold at most ${String(MAX_CONSUMPTION_LINES)} items.`,
      { lines: [`At most ${String(MAX_CONSUMPTION_LINES)} items.`] },
    );
  }

  const seen = new Set<string>();

  for (const line of lines) {
    if (seen.has(line.itemId)) {
      throw new BusinessRuleError(
        'The same item is on the sheet twice. Combine the quantities into one line.',
        { lines: ['An item appears more than once.'] },
      );
    }
    seen.add(line.itemId);
  }
}

function toLineData(lines: readonly ConsumptionLineInput[]): ConsumptionLineData[] {
  return lines.map((line) => ({
    itemId: line.itemId,
    quantity: line.quantity,
    notes: line.notes,
  }));
}

/**
 * Records a day's usage and deducts it from stock.
 *
 * The deduction happens inside the repository's transaction, so an entry never exists
 * without its stock movement and vice versa.
 */
export class RecordConsumptionUseCase implements IUseCase<
  RecordConsumptionInput,
  ConsumptionResultDto
> {
  constructor(
    private readonly consumption: IConsumptionRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: RecordConsumptionInput): Promise<ConsumptionResultDto> {
    assertLinesAreSane(input.lines);

    const result = await this.consumption.record({
      entryDate: input.entryDate,
      location: input.location,
      notes: input.notes?.trim(),
      recordedById: input.actorId,
      lines: toLineData(input.lines),
    });

    await this.auditLog.record({
      actorId: input.actorId,
      action: ConsumptionAuditAction.RECORDED,
      entityType: CONSUMPTION_ENTITY_TYPE,
      entityId: result.entry.id,
      ip: input.ipAddress,
      metadata: {
        entryDate: result.entry.entryDate.toISOString().slice(0, 10),
        location: result.entry.location,
        lineCount: result.entry.lineCount,
      },
    });

    this.logger.info('Consumption recorded', {
      entryId: result.entry.id,
      lineCount: result.entry.lineCount,
      actorId: input.actorId,
    });

    return {
      entry: ConsumptionMapper.toDto(result.entry),
      effects: result.effects,
    };
  }
}

/**
 * Corrects an entry, re-applying the difference to stock.
 *
 * Editable, unlike a purchase, because a consumption sheet is our own observation of what
 * the kitchen used rather than a document someone else issued. "We used 1.2 kg, not 2.1"
 * is a correction to that observation, and forcing it through a compensating stock
 * adjustment instead would leave the sheet permanently wrong.
 */
export class UpdateConsumptionUseCase implements IUseCase<
  UpdateConsumptionInput,
  ConsumptionResultDto
> {
  constructor(
    private readonly consumption: IConsumptionRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: UpdateConsumptionInput): Promise<ConsumptionResultDto> {
    assertLinesAreSane(input.lines);

    const existing = await this.consumption.findById(input.id);

    if (existing === null) {
      throw new NotFoundError('Consumption entry', input.id);
    }

    // A voided entry has already had its stock returned; editing it would re-apply
    // consumption that the business has decided did not happen.
    if (existing.isVoided) {
      throw new BusinessRuleError(
        'This entry has been voided and can no longer be edited. Record a new sheet instead.',
      );
    }

    const result = await this.consumption.update(input.id, {
      entryDate: input.entryDate,
      location: input.location,
      notes: input.notes?.trim(),
      lines: toLineData(input.lines),
      actorId: input.actorId,
      note: input.note?.trim(),
    });

    await this.auditLog.record({
      actorId: input.actorId,
      action: ConsumptionAuditAction.UPDATED,
      entityType: CONSUMPTION_ENTITY_TYPE,
      entityId: input.id,
      ip: input.ipAddress,
      metadata: {
        revision: result.entry.revision,
        // The items whose stock actually moved — the useful part of an edit for anyone
        // reading the system-wide trail.
        affected: result.effects.map((effect) => ({
          itemName: effect.itemName,
          before: effect.quantityBefore,
          after: effect.quantityAfter,
        })),
      },
    });

    this.logger.info('Consumption updated', {
      entryId: input.id,
      revision: result.entry.revision,
      affected: result.effects.length,
      actorId: input.actorId,
    });

    return {
      entry: ConsumptionMapper.toDto(result.entry),
      effects: result.effects,
    };
  }
}

/**
 * Reverses an entry, returning its stock.
 *
 * The row survives, marked voided with a reason. An entry that simply vanished would
 * leave an unattributed stock increase in the item history, which is exactly the kind of
 * unexplained movement an inventory audit exists to catch.
 */
export class VoidConsumptionUseCase implements IUseCase<
  VoidConsumptionInput,
  ConsumptionResultDto
> {
  constructor(
    private readonly consumption: IConsumptionRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: VoidConsumptionInput): Promise<ConsumptionResultDto> {
    const reason = input.reason.trim();

    if (reason.length === 0) {
      throw new BusinessRuleError('Give a reason for voiding this entry.', {
        reason: ['A reason is required.'],
      });
    }

    const result = await this.consumption.void(input.id, {
      actorId: input.actorId,
      reason,
    });

    await this.auditLog.record({
      actorId: input.actorId,
      action: ConsumptionAuditAction.VOIDED,
      entityType: CONSUMPTION_ENTITY_TYPE,
      entityId: input.id,
      ip: input.ipAddress,
      metadata: {
        reason,
        returned: result.effects.map((effect) => ({
          itemName: effect.itemName,
          before: effect.quantityBefore,
          after: effect.quantityAfter,
        })),
      },
    });

    this.logger.info('Consumption voided', {
      entryId: input.id,
      returned: result.effects.length,
      actorId: input.actorId,
    });

    return {
      entry: ConsumptionMapper.toDto(result.entry),
      effects: result.effects,
    };
  }
}
