import { Prisma, type PrismaClient } from '../../../generated/prisma/client.js';
import type { DailySalesEntry } from '../../../core/domain/entities/daily-sales-entry.entity.js';
import {
  ALL_SALES_CHANNELS,
  DailySalesRevisionAction,
  SalesPaymentMode,
  type SalesChannel,
} from '../../../core/domain/enums/sales.enum.js';
import { ConflictError, NotFoundError } from '../../../core/domain/errors/domain-error.js';
import type {
  DailySalesFilter,
  DailySalesLineData,
  DailySalesSummary,
  IDailySalesRepository,
  RecordDailySalesData,
  UpdateDailySalesData,
} from '../../../core/domain/repositories/daily-sales.repository.js';
import { createPage, toSkipTake, type Page, type PageRequest } from '../../../shared/pagination.js';
import {
  DailySalesPrismaMapper,
  DAILY_SALES_ENTRY_DETAIL_INCLUDE,
  DAILY_SALES_ENTRY_INCLUDE,
} from '../mappers/daily-sales.prisma-mapper.js';
import { decimalToNumber } from '../mappers/inventory-item.prisma-mapper.js';

/** Postgres unique-violation code, surfaced by Prisma as P2002. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Daily sales persistence.
 *
 * Simpler than the stock repositories, and deliberately: a day's takings touches no
 * inventory, so there is nothing to lock and no ordering to get right. What it does have
 * to get right is the one-entry-per-day rule and the revision trail, both of which are
 * enforced inside a transaction.
 */
export class DailySalesPrismaRepository implements IDailySalesRepository {
  constructor(private readonly client: PrismaClient) {}

  async findById(id: string): Promise<DailySalesEntry | null> {
    const row = await this.client.dailySalesEntry.findFirst({
      where: { id, deletedAt: null },
      include: DAILY_SALES_ENTRY_DETAIL_INCLUDE,
    });

    return row === null ? null : DailySalesPrismaMapper.toDomain(row);
  }

  async findByDate(entryDate: Date): Promise<DailySalesEntry | null> {
    const row = await this.client.dailySalesEntry.findFirst({
      where: { entryDate: this.dateOnly(entryDate), deletedAt: null },
      include: DAILY_SALES_ENTRY_INCLUDE,
    });

    return row === null ? null : DailySalesPrismaMapper.toDomain(row);
  }

  async findMany(filter: DailySalesFilter, page: PageRequest): Promise<Page<DailySalesEntry>> {
    const where = this.buildWhere(filter);
    const { skip, take } = toSkipTake(page);

    // One transaction so the count and the slice describe the same snapshot — otherwise
    // an entry written between the two makes the last page look short.
    const [rows, total] = await this.client.$transaction([
      this.client.dailySalesEntry.findMany({
        where,
        skip,
        take,
        orderBy: this.buildOrderBy(filter),
        include: DAILY_SALES_ENTRY_INCLUDE,
      }),
      this.client.dailySalesEntry.count({ where }),
    ]);

    return createPage(DailySalesPrismaMapper.toDomainList(rows), total, page);
  }

  async record(data: RecordDailySalesData): Promise<DailySalesEntry> {
    const entryDate = this.dateOnly(data.entryDate);
    const lines = this.normalise(data.lines);
    const totalAmount = this.sum(lines);

    try {
      const created = await this.client.$transaction(async (tx) => {
        const entry = await tx.dailySalesEntry.create({
          data: {
            entryDate,
            totalAmount,
            notes: data.notes ?? null,
            recordedById: data.recordedById,
            lines: { create: lines.map((line) => ({ ...line })) },
          },
          include: DAILY_SALES_ENTRY_INCLUDE,
        });

        // Revision 1 is the original, written in the same transaction so a day can never
        // exist without the record of how it came to exist.
        await tx.dailySalesEntryRevision.create({
          data: {
            entryId: entry.id,
            revision: 1,
            action: DailySalesRevisionAction.CREATED,
            snapshot: this.snapshot(lines, totalAmount, null),
            note: null,
            actorId: data.recordedById,
          },
        });

        return entry;
      });

      return DailySalesPrismaMapper.toDomain(created);
    } catch (error) {
      /*
       * The partial unique index on (entry_date) WHERE deleted_at IS NULL is what
       * actually holds when two submissions race. The use case pre-checks only so the
       * common case gets a sentence instead of a constraint violation.
       */
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        throw new ConflictError(
          `Sales for ${entryDate.toISOString().slice(0, 10)} have already been recorded. Edit that day instead.`,
        );
      }

      throw error;
    }
  }

  async update(id: string, data: UpdateDailySalesData): Promise<DailySalesEntry> {
    const lines = this.normalise(data.lines);
    const totalAmount = this.sum(lines);

    const updated = await this.client.$transaction(async (tx) => {
      const existing = await tx.dailySalesEntry.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, revision: true, totalAmount: true },
      });

      if (existing === null) {
        throw new NotFoundError('Sales entry', id);
      }

      const nextRevision = existing.revision + 1;

      /*
       * Replace rather than diff. A day's takings is one statement about that day, and
       * the lines are four small rows — reconciling them individually would be more code
       * for no gain, and would make a half-applied edit representable.
       */
      await tx.dailySalesLine.deleteMany({ where: { entryId: id } });

      const entry = await tx.dailySalesEntry.update({
        where: { id },
        data: {
          totalAmount,
          notes: data.notes ?? null,
          revision: nextRevision,
          lines: { create: lines.map((line) => ({ ...line })) },
        },
        include: DAILY_SALES_ENTRY_INCLUDE,
      });

      await tx.dailySalesEntryRevision.create({
        data: {
          entryId: id,
          revision: nextRevision,
          action: DailySalesRevisionAction.UPDATED,
          // The previous total is kept alongside the new lines: "what did this day say
          // before it was corrected" is the question a revision trail exists to answer.
          snapshot: this.snapshot(lines, totalAmount, decimalToNumber(existing.totalAmount)),
          note: data.note,
          actorId: data.actorId,
        },
      });

      return entry;
    });

    return DailySalesPrismaMapper.toDomain(updated);
  }

  async softDelete(id: string): Promise<void> {
    const result = await this.client.dailySalesEntry.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundError('Sales entry', id);
    }
  }

  /**
   * Totals over the whole filter, not a page.
   *
   * The day count, the grand total and the per-bucket sums go in **one transaction**, so
   * they describe the same snapshot — a "cash" figure that does not add up with the
   * "online" one beside it is worse than no figure at all.
   *
   * The best-day lookup deliberately sits outside it: it is a label, not part of the
   * arithmetic, and the worst a concurrent write can do is name a day that has just
   * overtaken the one the totals were computed from.
   */
  async summary(filter: DailySalesFilter): Promise<DailySalesSummary> {
    const where = this.buildWhere(filter);

    const [entries, lines] = await this.client.$transaction([
      this.client.dailySalesEntry.aggregate({
        where,
        _count: { _all: true },
        _sum: { totalAmount: true },
        _max: { totalAmount: true },
      }),
      // `orderBy` is required by Prisma's groupBy typing even when the order is
      // irrelevant — the rows are reduced in memory immediately below.
      this.client.dailySalesLine.groupBy({
        by: ['channel', 'paymentMode'],
        where: { entry: where },
        _sum: { amount: true },
        orderBy: [{ channel: 'asc' }],
      }),
    ]);

    const days = entries._count._all;
    const totalAmount = decimalToNumber(entries._sum.totalAmount ?? 0);

    const byChannel = Object.fromEntries(
      ALL_SALES_CHANNELS.map((channel) => [
        channel,
        round(
          lines
            .filter((line) => line.channel === channel)
            .reduce((sum, line) => sum + decimalToNumber(line._sum?.amount ?? 0), 0),
        ),
      ]),
    ) as Record<SalesChannel, number>;

    const cashTotal = round(
      lines
        .filter((line) => line.paymentMode === SalesPaymentMode.CASH)
        .reduce((sum, line) => sum + decimalToNumber(line._sum?.amount ?? 0), 0),
    );

    // The best day is a second query only because `_max` gives the amount without saying
    // which day it was, and the date is the useful half of that answer.
    const best =
      days === 0
        ? null
        : await this.client.dailySalesEntry.findFirst({
            where,
            orderBy: [{ totalAmount: 'desc' }, { entryDate: 'desc' }],
            select: { entryDate: true, totalAmount: true },
          });

    return {
      days,
      totalAmount,
      cashTotal,
      onlineTotal: round(totalAmount - cashTotal),
      byChannel,
      // Per **recorded** day, not per calendar day in the range: dividing by calendar
      // days would silently report a lower average for anyone who did not trade daily.
      averagePerDay: days === 0 ? null : round(totalAmount / days),
      bestDay:
        best === null
          ? null
          : {
              date: best.entryDate.toISOString().slice(0, 10),
              amount: decimalToNumber(best.totalAmount),
            },
    };
  }

  /**
   * Drops empty buckets and rejects duplicates.
   *
   * A zero is not stored: "no Swiggy orders today" and "Swiggy was not part of this
   * entry" are the same statement for a total, and keeping zero rows would make every
   * day carry four lines regardless of how the business actually traded.
   */
  private normalise(lines: readonly DailySalesLineData[]): DailySalesLineData[] {
    const seen = new Set<string>();
    const kept: DailySalesLineData[] = [];

    for (const line of lines) {
      const key = `${line.channel}:${line.paymentMode}`;

      if (seen.has(key)) {
        throw new ConflictError(
          `${line.channel} / ${line.paymentMode} appears twice in one day. Combine the amounts instead.`,
        );
      }

      seen.add(key);

      if (line.amount > 0) {
        kept.push({ ...line, amount: round(line.amount) });
      }
    }

    return kept;
  }

  private sum(lines: readonly DailySalesLineData[]): number {
    return round(lines.reduce((total, line) => total + line.amount, 0));
  }

  private snapshot(
    lines: readonly DailySalesLineData[],
    totalAmount: number,
    previousTotal: number | null,
  ): Prisma.InputJsonValue {
    return {
      totalAmount,
      ...(previousTotal === null ? {} : { previousTotal }),
      lines: lines.map((line) => ({
        channel: line.channel,
        paymentMode: line.paymentMode,
        amount: line.amount,
      })),
    };
  }

  private buildWhere(filter: DailySalesFilter): Prisma.DailySalesEntryWhereInput {
    const where: Prisma.DailySalesEntryWhereInput = { deletedAt: null };

    if (filter.fromDate !== undefined || filter.toDate !== undefined) {
      where.entryDate = {
        ...(filter.fromDate === undefined ? {} : { gte: this.dateOnly(filter.fromDate) }),
        ...(filter.toDate === undefined ? {} : { lte: this.dateOnly(filter.toDate) }),
      };
    }

    if (filter.channel !== undefined) {
      // "Days that took money through this channel" — a zero-amount line is not stored,
      // so the existence of the line is the whole test.
      where.lines = { some: { channel: filter.channel } };
    }

    return where;
  }

  private buildOrderBy(filter: DailySalesFilter): Prisma.DailySalesEntryOrderByWithRelationInput[] {
    const direction = filter.sortDirection ?? 'desc';

    // `entryDate` is appended as a tiebreaker when sorting by amount: without a
    // deterministic total order, days with equal takings can appear on two pages or none.
    return filter.sortField === 'totalAmount'
      ? [{ totalAmount: direction }, { entryDate: 'desc' }]
      : [{ entryDate: direction }];
  }

  /**
   * Strips the time, in UTC.
   *
   * The column is a `DATE`, and a value carrying a local-midnight timestamp can land on
   * the previous day once Postgres casts it — which would file a Monday's takings under
   * Sunday for anyone east of UTC, including here.
   */
  private dateOnly(value: Date): Date {
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
