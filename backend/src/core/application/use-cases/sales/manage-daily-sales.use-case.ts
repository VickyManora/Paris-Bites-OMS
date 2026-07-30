import type { DailySalesEntry } from '../../../domain/entities/daily-sales-entry.entity.js';
import { DAILY_SALES_BUCKETS, bucketKey } from '../../../domain/enums/sales.enum.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../../domain/errors/domain-error.js';
import type { IAuditLogRepository } from '../../../domain/repositories/audit-log.repository.js';
import type {
  DailySalesLineData,
  IDailySalesRepository,
} from '../../../domain/repositories/daily-sales.repository.js';
import type {
  DailySalesAmountInput,
  DailySalesEntryDto,
  RecordDailySalesInput,
  UpdateDailySalesInput,
} from '../../dtos/daily-sales.dto.js';
import { DailySalesMapper } from '../../mappers/daily-sales.mapper.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';

const ENTITY_TYPE = 'DailySalesEntry';

export const DailySalesAuditAction = {
  RECORDED: 'sales.recorded',
  UPDATED: 'sales.updated',
} as const;

/**
 * A day's takings cannot plausibly exceed this.
 *
 * A guard against a slipped decimal or a pasted phone number, not a business limit. The
 * damage from one is quiet and lasting: a single ₹45,00,000 day poisons every average,
 * chart axis and month-to-date figure in the app, and nobody notices until the shape of a
 * graph looks wrong weeks later.
 */
const MAX_BUCKET_AMOUNT = 10_000_000;

/** Validates the submitted buckets and turns them into line data. */
function toLines(amounts: readonly DailySalesAmountInput[]): DailySalesLineData[] {
  if (amounts.length === 0) {
    throw new BusinessRuleError('Enter at least one figure for the day.', {
      amounts: ['Enter the takings for at least one channel.'],
    });
  }

  const known = new Set(
    DAILY_SALES_BUCKETS.map((bucket) => bucketKey(bucket.channel, bucket.paymentMode)),
  );
  const seen = new Set<string>();

  for (const amount of amounts) {
    const key = bucketKey(amount.channel, amount.paymentMode);

    /*
     * The channel/payment pairs are a closed set, checked here rather than left to the
     * schema. Zomato paid in cash is not a combination this business has — accepting it
     * would put a figure in the database that no screen offers and no report expects.
     */
    if (!known.has(key)) {
      throw new BusinessRuleError(`${amount.channel} cannot be paid by ${amount.paymentMode}.`, {
        amounts: ['That channel and payment method are not a combination we record.'],
      });
    }

    if (seen.has(key)) {
      throw new BusinessRuleError('The same channel appears twice. Combine the amounts instead.', {
        amounts: ['Each channel may be entered once.'],
      });
    }

    seen.add(key);

    if (!Number.isFinite(amount.amount) || amount.amount < 0) {
      throw new BusinessRuleError('Takings cannot be negative.', {
        amounts: ['Enter zero or more.'],
      });
    }

    if (amount.amount > MAX_BUCKET_AMOUNT) {
      throw new BusinessRuleError('That figure looks like a slipped decimal point.', {
        amounts: [`Enter an amount below ${MAX_BUCKET_AMOUNT.toLocaleString('en-IN')}.`],
      });
    }
  }

  return amounts.map((amount) => ({
    channel: amount.channel,
    paymentMode: amount.paymentMode,
    amount: amount.amount,
  }));
}

/**
 * Rejects a day that has not happened yet.
 *
 * Compared against the end of today in UTC, so an entry dated "today" is never refused
 * because of a timezone offset. A future date is almost always a typo in the month, and
 * it silently corrupts every date-ranged sales figure until somebody notices.
 */
function assertNotInTheFuture(entryDate: Date): void {
  const now = new Date();
  const endOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999);

  if (entryDate.getTime() > endOfToday) {
    throw new BusinessRuleError('Sales cannot be recorded for a future date.', {
      entryDate: ['Pick today or an earlier day.'],
    });
  }
}

/**
 * Records one day's takings.
 *
 * The whole day arrives in a single submission — the four figures together, once, at
 * close of business. That is the shape the business actually works in, and it is why
 * there is no "add a sale" endpoint: a partial day is not a state worth representing.
 */
export class RecordDailySalesUseCase implements IUseCase<RecordDailySalesInput, DailySalesEntryDto> {
  constructor(
    private readonly sales: IDailySalesRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: RecordDailySalesInput): Promise<DailySalesEntryDto> {
    assertNotInTheFuture(input.entryDate);
    const lines = toLines(input.amounts);

    /*
     * Checked before doing any work, purely for the error message: the partial unique
     * index is the real guard and is what holds if two submissions race. Without this
     * pre-check the user would see a constraint violation instead of "you have already
     * recorded that day" — which is the single most likely mistake here.
     */
    const existing = await this.sales.findByDate(input.entryDate);

    if (existing !== null) {
      throw new ConflictError(
        `Sales for ${existing.entryDateIso} have already been recorded. Edit that day instead.`,
      );
    }

    const entry = await this.sales.record({
      entryDate: input.entryDate,
      notes: input.notes?.trim(),
      recordedById: input.actorId,
      lines,
    });

    await this.auditLog.record({
      actorId: input.actorId,
      action: DailySalesAuditAction.RECORDED,
      entityType: ENTITY_TYPE,
      entityId: entry.id,
      ip: input.ipAddress,
      metadata: {
        entryDate: entry.entryDateIso,
        totalAmount: entry.totalAmount,
        channels: entry.activeChannelLabels,
      },
    });

    this.logger.info('Daily sales recorded', {
      entryId: entry.id,
      entryDate: entry.entryDateIso,
      totalAmount: entry.totalAmount,
      actorId: input.actorId,
    });

    return DailySalesMapper.toDto(entry);
  }
}

/**
 * Corrects a day already recorded.
 *
 * A reason is required. Sales figures are the numbers the business is judged on, and one
 * that changed with no explanation attached is worse than one that was never corrected —
 * the trail exists so a later reader can tell a reconciliation from a mistake.
 */
export class UpdateDailySalesUseCase implements IUseCase<UpdateDailySalesInput, DailySalesEntryDto> {
  constructor(
    private readonly sales: IDailySalesRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: UpdateDailySalesInput): Promise<DailySalesEntryDto> {
    const lines = toLines(input.amounts);
    const reason = input.reason.trim();

    if (reason.length === 0) {
      throw new BusinessRuleError('Say why the figure changed.', {
        reason: ['A reason is required when correcting a day.'],
      });
    }

    const existing = await this.sales.findById(input.id);

    if (existing === null) {
      throw new NotFoundError('Sales entry', input.id);
    }

    const previousTotal = existing.totalAmount;

    const entry = await this.sales.update(input.id, {
      notes: input.notes?.trim(),
      lines,
      actorId: input.actorId,
      note: reason,
    });

    await this.auditLog.record({
      actorId: input.actorId,
      action: DailySalesAuditAction.UPDATED,
      entityType: ENTITY_TYPE,
      entityId: entry.id,
      ip: input.ipAddress,
      metadata: {
        entryDate: entry.entryDateIso,
        // Both figures, so the audit entry alone explains the change without a join.
        from: previousTotal,
        to: entry.totalAmount,
        revision: entry.revision,
        reason,
      },
    });

    this.logger.info('Daily sales corrected', {
      entryId: entry.id,
      entryDate: entry.entryDateIso,
      from: previousTotal,
      to: entry.totalAmount,
      actorId: input.actorId,
    });

    return DailySalesMapper.toDto(entry);
  }
}

/** Exported for the tests, which pin the guards down without a database. */
export const dailySalesRules = { toLines, assertNotInTheFuture, MAX_BUCKET_AMOUNT };

export type { DailySalesEntry };
