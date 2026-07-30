import { stateNameFor } from '../enums/purchase.enum.js';

export interface SupplierProps {
  readonly id: string;
  readonly name: string;
  readonly gstin: string | null;
  readonly stateCode: string;

  readonly contactName: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly addressLine: string | null;
  readonly city: string | null;
  readonly notes: string | null;

  readonly isActive: boolean;

  readonly createdById: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

/**
 * A vendor.
 *
 * Thin by design: a supplier is master data, and the only judgement it owns is whether it
 * may be used on a new invoice. Everything interesting about a purchase — the tax split,
 * the totals — belongs to the `Purchase`, not here.
 */
export class Supplier {
  private constructor(private readonly props: SupplierProps) {}

  static fromPersistence(props: SupplierProps): Supplier {
    return new Supplier(props);
  }

  get id(): string {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
  }

  get gstin(): string | null {
    return this.props.gstin;
  }

  get stateCode(): string {
    return this.props.stateCode;
  }

  get stateName(): string {
    return stateNameFor(this.props.stateCode);
  }

  get isActive(): boolean {
    return this.props.isActive;
  }

  get isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  /** Whether this supplier has a GSTIN, and so whether its invoices can carry tax. */
  get isGstRegistered(): boolean {
    return this.props.gstin !== null && this.props.gstin.length > 0;
  }

  /**
   * Whether a new purchase may name this supplier.
   *
   * Deactivating is how a vendor is retired without touching history: existing invoices
   * still resolve and still print the name, but nobody can accidentally raise a new one
   * against a supplier the business no longer buys from.
   */
  get canBePurchasedFrom(): boolean {
    return this.props.isActive && !this.isDeleted;
  }

  toProps(): SupplierProps {
    return this.props;
  }
}
