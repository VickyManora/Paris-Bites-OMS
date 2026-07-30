import type { InventoryLocation, InventoryUnit } from '../enums/inventory.enum.js';
import { INVENTORY_UNIT_ABBREVIATIONS } from '../enums/inventory.enum.js';
import type { ConsumptionRevisionAction } from '../enums/consumption.enum.js';

export interface ConsumptionLineProps {
  readonly id: string;
  readonly itemId: string;
  /** Snapshot taken when the line was written, so a rename does not rewrite the past. */
  readonly itemName: string;
  readonly unit: InventoryUnit;
  /** Always in the item's own unit. */
  readonly quantity: number;
  readonly notes: string | null;
}

export interface ConsumptionRevisionProps {
  readonly id: string;
  readonly revision: number;
  readonly action: ConsumptionRevisionAction;
  readonly snapshot: unknown;
  readonly note: string | null;
  readonly actorName: string | null;
  readonly createdAt: Date;
}

export interface ConsumptionEntryProps {
  readonly id: string;
  /** The day the stock was used, not the moment it was typed in. */
  readonly entryDate: Date;
  readonly location: InventoryLocation;
  readonly notes: string | null;
  readonly revision: number;
  readonly recordedById: string | null;
  readonly recordedByName: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
  readonly voidedByName: string | null;
  readonly voidReason: string | null;
  readonly lines: readonly ConsumptionLineProps[];
  /** Newest first. Empty when the caller did not ask for them. */
  readonly revisions: readonly ConsumptionRevisionProps[];
}

/**
 * One day's recorded usage at one location.
 *
 * Editable, unlike a purchase. A purchase is a document someone else issued and we
 * transcribe; a consumption sheet is our own observation of what the kitchen used, and
 * "we used 1.2 kg, not 2.1" is a correction to that observation rather than a second
 * event. Every correction re-applies the difference to stock and appends a revision, so
 * the change is recorded rather than hidden.
 *
 * Behaviour that depends only on the entry's own state lives here, so the rules are
 * testable with no database and no HTTP.
 */
export class ConsumptionEntry {
  private constructor(private readonly props: ConsumptionEntryProps) {}

  /** Rehydrates from persistence. Assumes the data is already valid. */
  static fromPersistence(props: ConsumptionEntryProps): ConsumptionEntry {
    return new ConsumptionEntry(props);
  }

  get id(): string {
    return this.props.id;
  }

  get entryDate(): Date {
    return this.props.entryDate;
  }

  get location(): InventoryLocation {
    return this.props.location;
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

  get voidedByName(): string | null {
    return this.props.voidedByName;
  }

  get voidReason(): string | null {
    return this.props.voidReason;
  }

  get lines(): readonly ConsumptionLineProps[] {
    return this.props.lines;
  }

  get revisions(): readonly ConsumptionRevisionProps[] {
    return this.props.revisions;
  }

  get lineCount(): number {
    return this.props.lines.length;
  }

  /** Voided entries have had their stock returned; they are history, not consumption. */
  get isVoided(): boolean {
    return this.props.deletedAt !== null;
  }

  /**
   * True once the entry has been corrected at least once.
   *
   * Revision 1 is the original, so anything above it means someone changed their mind —
   * which is worth flagging in a list without opening the record.
   */
  get isEdited(): boolean {
    return this.props.revision > 1;
  }

  /**
   * A short summary of what was used, for a list row.
   *
   * Names only, and only the first few: a row has to say "chocolate and cream" at a
   * glance, and the full breakdown is what opening the entry is for.
   */
  summarise(limit = 3): string {
    if (this.props.lines.length === 0) {
      return 'No items';
    }

    const names = this.props.lines.slice(0, limit).map((line) => line.itemName);
    const remainder = this.props.lines.length - names.length;

    return remainder > 0 ? `${names.join(', ')} +${String(remainder)} more` : names.join(', ');
  }

  /** e.g. "1.2 kg". Formatting a bare number without its unit is a bug magnet. */
  static displayQuantity(line: ConsumptionLineProps): string {
    return `${String(line.quantity)} ${INVENTORY_UNIT_ABBREVIATIONS[line.unit]}`;
  }

  /** Snapshot for mappers and repositories. Callers must not mutate it. */
  toProps(): ConsumptionEntryProps {
    return this.props;
  }
}
