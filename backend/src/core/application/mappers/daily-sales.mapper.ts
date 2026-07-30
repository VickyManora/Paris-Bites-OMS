import type { DailySalesEntry } from '../../domain/entities/daily-sales-entry.entity.js';
import {
  bucketKey,
  DAILY_SALES_BUCKETS,
  DailySalesRevisionAction,
  SALES_CHANNEL_LABELS,
  SALES_PAYMENT_MODE_LABELS,
} from '../../domain/enums/sales.enum.js';
import type { DailySalesSummary } from '../../domain/repositories/daily-sales.repository.js';
import type {
  DailySalesEntryDto,
  DailySalesLineDto,
  DailySalesRevisionDto,
  DailySalesSummaryDto,
} from '../dtos/daily-sales.dto.js';

const REVISION_LABELS: Readonly<Record<DailySalesRevisionAction, string>> = {
  [DailySalesRevisionAction.CREATED]: 'Recorded',
  [DailySalesRevisionAction.UPDATED]: 'Corrected',
};

export const DailySalesMapper = {
  toDto(entry: DailySalesEntry): DailySalesEntryDto {
    const props = entry.toProps();

    const lines: DailySalesLineDto[] = props.lines.map((line) => ({
      id: line.id,
      channel: line.channel,
      channelLabel: SALES_CHANNEL_LABELS[line.channel],
      paymentMode: line.paymentMode,
      paymentModeLabel: SALES_PAYMENT_MODE_LABELS[line.paymentMode],
      bucket: bucketKey(line.channel, line.paymentMode),
      amount: line.amount,
    }));

    /*
     * Every bucket is present, including the ones that took nothing.
     *
     * Zero rows are not stored — see the repository — but the client needs a value for
     * each bucket to bind a form field and to render a table column. Filling them in here
     * means neither the form nor the table has to know that an absent line means zero.
     */
    const amounts = Object.fromEntries(
      DAILY_SALES_BUCKETS.map((bucket) => [
        bucketKey(bucket.channel, bucket.paymentMode),
        entry.amountFor(bucket.channel, bucket.paymentMode),
      ]),
    );

    const revisions: DailySalesRevisionDto[] = props.revisions.map((revision) => ({
      id: revision.id,
      revision: revision.revision,
      action: revision.action,
      actionLabel: REVISION_LABELS[revision.action],
      snapshot: revision.snapshot,
      note: revision.note,
      actorName: revision.actorName,
      createdAt: revision.createdAt.toISOString(),
    }));

    return {
      id: entry.id,
      entryDate: entry.entryDateIso,
      totalAmount: entry.totalAmount,
      notes: entry.notes,
      revision: entry.revision,
      isEdited: entry.isEdited,
      lines,
      amounts,
      walkInTotal: entry.walkInTotal,
      aggregatorTotal: entry.aggregatorTotal,
      cashTotal: entry.cashTotal,
      onlineTotal: entry.onlineTotal,
      aggregatorSharePercent: entry.aggregatorSharePercent,
      activeChannels: entry.activeChannelLabels,
      revisions,
      recordedByName: entry.recordedByName,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    };
  },

  toDtoList(entries: readonly DailySalesEntry[]): DailySalesEntryDto[] {
    return entries.map((entry) => DailySalesMapper.toDto(entry));
  },

  toSummaryDto(summary: DailySalesSummary): DailySalesSummaryDto {
    return {
      days: summary.days,
      totalAmount: summary.totalAmount,
      cashTotal: summary.cashTotal,
      onlineTotal: summary.onlineTotal,
      byChannel: summary.byChannel,
      averagePerDay: summary.averagePerDay,
      bestDay: summary.bestDay,
    };
  },
} as const;
