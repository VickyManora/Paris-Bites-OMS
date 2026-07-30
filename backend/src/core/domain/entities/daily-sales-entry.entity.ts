import {
  isAggregator,
  SALES_CHANNEL_LABELS,
  type DailySalesRevisionAction,
  type SalesChannel,
  type SalesPaymentMode,
} from '../enums/sales.enum.js';

export interface DailySalesLineProps {
  readonly id: string;
  readonly channel: SalesChannel;
  readonly paymentMode: SalesPaymentMode;
  /** Net takings for this bucket — after any discount given. */
  readonly amount: number;
}

export interface DailySalesRevisionProps {
  readonly id: string;
  readonly revision: number;
  readonly action: DailySalesRevisionAction;
  readonly snapshot: unknown;
  readonly note: string | null;
  readonly actorName: string | null;
  readonly createdAt: Date;
}

export interface DailySalesEntryProps {
  readonly id: string;
  /** The trading day, not the moment it was typed in. */
  readonly entryDate: Date;
  readonly totalAmount: number;
  readonly notes: string | null;
  readonly revision: number;
  readonly recordedById: string | null;
  readonly recordedByName: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  readonly lines: readonly DailySalesLineProps[];
  /** Newest first. Empty when the caller did not ask for them. */
  readonly revisions: readonly DailySalesRevisionProps[];
}

/**
 * One day's takings.
 *
 * A daily total per channel, not a record of each sale — see the schema comment on
 * `DailySalesEntry` for why, and for what that costs. The figure entered is **net**: what
 * was actually received, after any discount, because that is the only number that can be
 * reconciled against a bank statement or a cash count.
 *
 * Editable, like a consumption sheet and unlike a purchase. A purchase is a document
 * somebody else issued and we transcribe; a day's takings is our own reading of a till
 * and an aggregator dashboard, and "it was 4,200 not 4,020" is a correction to that
 * reading rather than a second day's trade. Every correction appends a revision.
 *
 * Behaviour that depends only on the entry's own state lives here, so the rules are
 * testable with no database and no HTTP.
 */
export class DailySalesEntry {
  private constructor(private readonly props: DailySalesEntryProps) {}

  /** Rehydrates from persistence. Assumes the data is already valid. */
  static fromPersistence(props: DailySalesEntryProps): DailySalesEntry {
    return new DailySalesEntry(props);
  }

  get id(): string {
    return this.props.id;
  }

  get entryDate(): Date {
    return this.props.entryDate;
  }

  /** `YYYY-MM-DD`. The wire format for a calendar day, never a timestamp. */
  get entryDateIso(): string {
    return this.props.entryDate.toISOString().slice(0, 10);
  }

  get totalAmount(): number {
    return this.props.totalAmount;
  }

  get notes(): string | null {
    return this.props.notes;
  }

  get revision(): number {
    return this.props.revision;
  }

  get recordedById(): string | null {
    return this.props.recordedById;
  }

  get recordedByName(): string | null {
    return this.props.recordedByName;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get deletedAt(): Date | null {
    return this.props.deletedAt;
  }

  get isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  get lines(): readonly DailySalesLineProps[] {
    return this.props.lines;
  }

  get revisions(): readonly DailySalesRevisionProps[] {
    return this.props.revisions;
  }

  /** True once the day has been corrected at least once. */
  get isEdited(): boolean {
    return this.props.revision > 1;
  }

  /** Takings for one channel, across payment modes. Zero when the channel had none. */
  amountForChannel(channel: SalesChannel): number {
    return round(
      this.props.lines
        .filter((line) => line.channel === channel)
        .reduce((sum, line) => sum + line.amount, 0),
    );
  }

  /** Takings for one bucket exactly. Zero when it was not entered. */
  amountFor(channel: SalesChannel, paymentMode: SalesPaymentMode): number {
    return round(
      this.props.lines
        .filter((line) => line.channel === channel && line.paymentMode === paymentMode)
        .reduce((sum, line) => sum + line.amount, 0),
    );
  }

  /**
   * Cash taken, across every channel.
   *
   * The figure someone counts at the end of the night, so it is worth having as its own
   * question rather than reassembled by each caller.
   */
  get cashTotal(): number {
    return round(
      this.props.lines
        .filter((line) => line.paymentMode === 'CASH')
        .reduce((sum, line) => sum + line.amount, 0),
    );
  }

  get onlineTotal(): number {
    return round(this.props.totalAmount - this.cashTotal);
  }

  /** Revenue through Zomato and Swiggy together. */
  get aggregatorTotal(): number {
    return round(
      this.props.lines
        .filter((line) => isAggregator(line.channel))
        .reduce((sum, line) => sum + line.amount, 0),
    );
  }

  get walkInTotal(): number {
    return round(this.props.totalAmount - this.aggregatorTotal);
  }

  /**
   * Share of the day that came through an aggregator, 0–100.
   *
   * Null on a zero day rather than 0: no trade at all is not the same statement as "none
   * of today's trade came from the platforms", and a chart plotting the second for a
   * closed day would invent a trend.
   */
  get aggregatorSharePercent(): number | null {
    if (this.props.totalAmount <= 0) {
      return null;
    }

    return round((this.aggregatorTotal / this.props.totalAmount) * 100);
  }

  /** e.g. "Zomato, Swiggy" — the channels that actually took money. */
  get activeChannelLabels(): string {
    const channels = [...new Set(this.props.lines.filter((l) => l.amount > 0).map((l) => l.channel))];
    return channels.map((channel) => SALES_CHANNEL_LABELS[channel]).join(', ');
  }

  /** Snapshot for mappers and repositories. Callers must not mutate it. */
  toProps(): DailySalesEntryProps {
    return this.props;
  }
}

/** Currency scale. Kept local: every figure here is money. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}
