import type {
  InventoryCategory,
  InventoryLocation,
  InventoryUnit,
} from '../enums/inventory.enum.js';
import {
  canTransition,
  isInTransit,
  isTerminalStatus,
  StockTransferStatus,
} from '../enums/stock-transfer.enum.js';
import { BusinessRuleError } from '../errors/domain-error.js';

export interface StockTransferLineProps {
  readonly id: string;
  readonly itemId: string;
  readonly quantity: number;
  /** Snapshot taken at request time — see the schema comment. */
  readonly itemName: string;
  readonly unit: InventoryUnit;
  readonly category: InventoryCategory;
}

export interface StockTransferProps {
  readonly id: string;
  readonly reference: string;
  readonly fromLocation: InventoryLocation;
  readonly toLocation: InventoryLocation;
  readonly status: StockTransferStatus;
  readonly notes: string | null;

  readonly requestedById: string;
  readonly requestedByName: string | null;
  readonly requestedAt: Date;

  readonly reviewedById: string | null;
  readonly reviewedByName: string | null;
  readonly reviewedAt: Date | null;
  readonly reviewNote: string | null;

  readonly completedById: string | null;
  readonly completedByName: string | null;
  readonly completedAt: Date | null;

  readonly createdAt: Date;
  readonly updatedAt: Date;

  readonly lines: readonly StockTransferLineProps[];
}

/**
 * A stock transfer document.
 *
 * Owns the state machine: every transition is requested through the guard methods below,
 * which throw a `BusinessRuleError` rather than returning false. A caller that forgets to
 * check therefore fails loudly instead of silently moving stock from the wrong state.
 *
 * The entity does **not** move stock — that requires a database transaction across several
 * rows and belongs in the repository. The entity decides whether a move is *permitted*.
 */
export class StockTransfer {
  private constructor(private readonly props: StockTransferProps) {}

  static fromPersistence(props: StockTransferProps): StockTransfer {
    return new StockTransfer(props);
  }

  get id(): string {
    return this.props.id;
  }

  get reference(): string {
    return this.props.reference;
  }

  get fromLocation(): InventoryLocation {
    return this.props.fromLocation;
  }

  get toLocation(): InventoryLocation {
    return this.props.toLocation;
  }

  get status(): StockTransferStatus {
    return this.props.status;
  }

  get notes(): string | null {
    return this.props.notes;
  }

  get lines(): readonly StockTransferLineProps[] {
    return this.props.lines;
  }

  get requestedById(): string {
    return this.props.requestedById;
  }

  get requestedAt(): Date {
    return this.props.requestedAt;
  }

  get isPending(): boolean {
    return this.props.status === StockTransferStatus.PENDING;
  }

  /** Source deducted, destination not yet credited. */
  get isInTransit(): boolean {
    return isInTransit(this.props.status);
  }

  get isTerminal(): boolean {
    return isTerminalStatus(this.props.status);
  }

  /** Total units across all lines. Only meaningful when every line shares a unit. */
  get totalQuantity(): number {
    const total = this.props.lines.reduce((sum, line) => sum + line.quantity, 0);
    return Math.round(total * 1000) / 1000;
  }

  get lineCount(): number {
    return this.props.lines.length;
  }

  // -------------------------------------------------------------------------
  // Transition guards
  // -------------------------------------------------------------------------

  /**
   * @throws BusinessRuleError when the transfer is not awaiting approval.
   *
   * The message names the current status, because "cannot approve" alone leaves the user
   * guessing whether someone else already did it.
   */
  assertCanApprove(): void {
    this.assertTransition(StockTransferStatus.APPROVED, 'approved');
  }

  assertCanReject(): void {
    this.assertTransition(StockTransferStatus.REJECTED, 'rejected');
  }

  assertCanComplete(): void {
    this.assertTransition(StockTransferStatus.COMPLETED, 'completed');
  }

  private assertTransition(target: StockTransferStatus, verb: string): void {
    if (canTransition(this.props.status, target)) {
      return;
    }

    // Already in the target state — almost always a double submit or a stale screen, so it
    // gets its own wording rather than the generic refusal.
    if (this.props.status === target) {
      throw new BusinessRuleError(`Transfer ${this.props.reference} has already been ${verb}.`, {
        status: [`Already ${verb}.`],
      });
    }

    throw new BusinessRuleError(
      `Transfer ${this.props.reference} cannot be ${verb} because it is ${this.props.status.toLowerCase()}.`,
      { status: [`Cannot be ${verb} from ${this.props.status.toLowerCase()}.`] },
    );
  }

  toProps(): StockTransferProps {
    return this.props;
  }
}
