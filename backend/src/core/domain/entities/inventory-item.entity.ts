import {
  deriveStockStatus,
  INVENTORY_UNIT_ABBREVIATIONS,
  isDiscreteUnit,
  type InventoryCategory,
  type InventoryItemStatus,
  type InventoryLocation,
  type InventoryUnit,
  type StockStatus,
} from '../enums/inventory.enum.js';

export interface InventoryItemProps {
  readonly id: string;
  readonly name: string;
  readonly category: InventoryCategory;
  readonly unit: InventoryUnit;
  readonly location: InventoryLocation;
  readonly currentQuantity: number;
  /** What the item held when it was set up. Frozen at creation. */
  readonly openingQuantity: number;
  readonly minimumQuantity: number;
  /** Cost per unit excluding tax, or null when nobody has priced it. */
  readonly purchasePrice: number | null;
  readonly supplierId: string | null;
  /**
   * Denormalised for display, exactly like `actorName` on a history entry.
   *
   * Read-only projection, not state the item owns: `supplierId` is the fact, this is
   * what it currently resolves to. Carried on the entity so that every consumer shows
   * the same wording without a second request — the same reason category and location
   * labels are resolved server-side.
   */
  readonly supplierName: string | null;
  /** Whether this item may raise a low-stock alert. */
  readonly lowStockAlertEnabled: boolean;
  readonly batchNumber: string | null;
  /** Calendar day, so "expires today" does not depend on the time of day. */
  readonly expiryDate: Date | null;
  readonly status: InventoryItemStatus;
  readonly notes: string | null;
  readonly createdById: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/**
 * An inventory item: one thing, measured in one unit, at one location.
 *
 * The same ingredient at two locations is two items — they have independent
 * quantities and independent reorder thresholds, which is the whole point of
 * tracking a warehouse and a cart separately.
 *
 * Behaviour that depends only on the item's own state lives here rather than in a use
 * case, so the rules are testable with no database and no HTTP.
 */
export class InventoryItem {
  private constructor(private readonly props: InventoryItemProps) {}

  /** Rehydrates from persistence. Assumes the data is already valid. */
  static fromPersistence(props: InventoryItemProps): InventoryItem {
    return new InventoryItem(props);
  }

  get id(): string {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get category(): InventoryCategory {
    return this.props.category;
  }

  get unit(): InventoryUnit {
    return this.props.unit;
  }

  get location(): InventoryLocation {
    return this.props.location;
  }

  get currentQuantity(): number {
    return this.props.currentQuantity;
  }

  get openingQuantity(): number {
    return this.props.openingQuantity;
  }

  get minimumQuantity(): number {
    return this.props.minimumQuantity;
  }

  get purchasePrice(): number | null {
    return this.props.purchasePrice;
  }

  get supplierId(): string | null {
    return this.props.supplierId;
  }

  get supplierName(): string | null {
    return this.props.supplierName;
  }

  get lowStockAlertEnabled(): boolean {
    return this.props.lowStockAlertEnabled;
  }

  get batchNumber(): string | null {
    return this.props.batchNumber;
  }

  get expiryDate(): Date | null {
    return this.props.expiryDate;
  }

  get status(): InventoryItemStatus {
    return this.props.status;
  }

  get notes(): string | null {
    return this.props.notes;
  }

  get createdById(): string | null {
    return this.props.createdById;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  get isActive(): boolean {
    return this.props.status === 'ACTIVE' && !this.isDeleted;
  }

  /** Derived on every read — see `deriveStockStatus`. */
  get stockStatus(): StockStatus {
    return deriveStockStatus(this.props.currentQuantity, this.props.minimumQuantity);
  }

  get isOutOfStock(): boolean {
    return this.stockStatus === 'OUT_OF_STOCK';
  }

  /**
   * True when the item needs restocking, i.e. low **or** already out.
   *
   * "Out of stock" is the worst case of needing stock, so a low-stock warning that
   * excluded it would hide the most urgent items.
   */
  get needsRestocking(): boolean {
    const status = this.stockStatus;
    return status === 'LOW_STOCK' || status === 'OUT_OF_STOCK';
  }

  /**
   * Whether this item should actually raise a low-stock alert.
   *
   * Deliberately separate from `needsRestocking`, which stays a pure statement about
   * quantities. A silenced item is still low on stock and must still say so in the
   * list and the reorder report; the flag only decides whether anyone gets told
   * about it. Collapsing the two would make switching off a noisy alert quietly
   * remove the item from the restocking figures as well.
   *
   * An inactive or deleted item never alerts: nobody is expected to restock
   * something the business has stopped carrying.
   */
  get shouldAlertLowStock(): boolean {
    return this.props.lowStockAlertEnabled && this.isActive && this.needsRestocking;
  }

  /**
   * Value of the stock on hand, or null when the item has no recorded price.
   *
   * Null rather than 0, because "worth nothing" and "we have not priced this" are
   * different facts and a valuation report must not silently total the second as the
   * first. Rounded to currency scale, since that is what any report prints.
   */
  get stockValue(): number | null {
    if (this.props.purchasePrice === null) {
      return null;
    }

    return Math.round(this.props.purchasePrice * this.props.currentQuantity * 100) / 100;
  }

  /**
   * Whether the held stock has passed its expiry date.
   *
   * Takes the reference day rather than reading the clock, so the rule is testable
   * and a report can ask the same question about any date. An item with no expiry
   * never expires — most of this inventory (bowls, spoons, stickers) genuinely does
   * not.
   *
   * Compared on the calendar day: stock expiring today is not yet expired.
   */
  isExpiredAsOf(reference: Date): boolean {
    const expiry = this.props.expiryDate;

    if (expiry === null) {
      return false;
    }

    return expiry.getTime() < Date.UTC(
      reference.getUTCFullYear(),
      reference.getUTCMonth(),
      reference.getUTCDate(),
    );
  }

  /**
   * How much to order to reach the threshold. Zero when no restock is needed.
   *
   * Uses the raw difference rather than a rounded-up figure, except for discrete
   * units where a fractional order makes no sense.
   */
  get shortfall(): number {
    if (!this.needsRestocking || this.props.minimumQuantity <= 0) {
      return 0;
    }

    const gap = this.props.minimumQuantity - this.props.currentQuantity;

    if (gap <= 0) {
      return 0;
    }

    return isDiscreteUnit(this.props.unit) ? Math.ceil(gap) : Math.round(gap * 1000) / 1000;
  }

  /** e.g. "12.5 kg". Formatting a bare number without its unit is a bug magnet. */
  get displayQuantity(): string {
    return `${this.props.currentQuantity} ${INVENTORY_UNIT_ABBREVIATIONS[this.props.unit]}`;
  }

  /** Snapshot for mappers and repositories. Callers must not mutate it. */
  toProps(): InventoryItemProps {
    return this.props;
  }
}
