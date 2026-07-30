import { computed, inject, Injectable, signal, type Signal } from '@angular/core';
import { AuthService } from '../../../core/auth/services/auth.service';
import { Permission } from '../../../core/models/permission.model';
import {
  DiscountType,
  STORE_MANAGER_MAX_DISCOUNT_PERCENT,
  type CartLine,
  type Product,
} from '../models/pos.model';

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The cart.
 *
 * Held in signals and **never round-tripped while being built**. Every tap — add, increase,
 * decrease, remove, discount — is local arithmetic, so the totals move at the speed of the
 * screen rather than the network. One request happens, on submit.
 *
 * The figures here are for display only. The server re-prices every line from the product
 * table and recomputes the total, so a stale menu price in this cart shows a wrong number for
 * a moment and cannot produce a wrong charge.
 *
 * Provided by the new-order page rather than at the root: a cart abandoned by navigating away
 * should be gone, not waiting when the next customer arrives.
 */
/** The whole of the cart's local state, for undo. See `PosCartStore.snapshot`. */
export interface CartSnapshot {
  readonly lines: readonly CartLine[];
  readonly discountType: DiscountType;
  readonly discountValue: number;
  readonly discountReason: string;
  readonly notes: string;
  readonly customerName: string;
  readonly customerPhone: string;
}

@Injectable()
export class PosCartStore {
  private readonly auth = inject(AuthService);

  private readonly linesState = signal<readonly CartLine[]>([]);
  private readonly discountTypeState = signal<DiscountType>(DiscountType.NONE);
  private readonly discountValueState = signal(0);
  private readonly discountReasonState = signal('');
  private readonly notesState = signal('');
  private readonly customerNameState = signal('');
  private readonly customerPhoneState = signal('');

  readonly lines: Signal<readonly CartLine[]> = this.linesState.asReadonly();
  readonly discountType: Signal<DiscountType> = this.discountTypeState.asReadonly();
  readonly discountValue: Signal<number> = this.discountValueState.asReadonly();
  readonly discountReason: Signal<string> = this.discountReasonState.asReadonly();
  readonly notes: Signal<string> = this.notesState.asReadonly();
  readonly customerName: Signal<string> = this.customerNameState.asReadonly();
  readonly customerPhone: Signal<string> = this.customerPhoneState.asReadonly();

  readonly isEmpty: Signal<boolean> = computed(() => this.linesState().length === 0);

  /** Units, not lines — "3 items" means three bowls. */
  readonly itemCount: Signal<number> = computed(() =>
    this.linesState().reduce((sum, line) => sum + line.quantity, 0),
  );

  readonly subtotal: Signal<number> = computed(() =>
    round(this.linesState().reduce((sum, line) => sum + line.product.price * line.quantity, 0)),
  );

  /**
   * The discount in rupees, clamped to the subtotal.
   *
   * Mirrors `computeTotals` on the server exactly — including the clamp, so the screen never
   * shows a negative total that the server would then reject.
   */
  readonly discountAmount: Signal<number> = computed(() => {
    const subtotal = this.subtotal();
    const value = this.discountValueState();

    const raw =
      this.discountTypeState() === DiscountType.PERCENTAGE
        ? (subtotal * value) / 100
        : this.discountTypeState() === DiscountType.FLAT
          ? value
          : 0;

    return round(Math.min(Math.max(raw, 0), subtotal));
  });

  readonly grandTotal: Signal<number> = computed(() =>
    round(this.subtotal() - this.discountAmount()),
  );

  /** The discount as a percentage, whichever way it was entered. */
  readonly discountPercent: Signal<number> = computed(() => {
    const subtotal = this.subtotal();
    return subtotal <= 0 ? 0 : round((this.discountAmount() / subtotal) * 100);
  });

  readonly canDiscountFreely: Signal<boolean> = computed(() =>
    this.auth.can(Permission.POS_DISCOUNT_UNLIMITED),
  );

  /**
   * Whether the discount exceeds what this user may give.
   *
   * Checked here only to disable the button and say why before a round trip. The server
   * enforces the real rule; this is a courtesy, not a control.
   */
  readonly discountExceedsLimit: Signal<boolean> = computed(
    () => !this.canDiscountFreely() && this.discountPercent() > STORE_MANAGER_MAX_DISCOUNT_PERCENT,
  );

  readonly needsDiscountReason: Signal<boolean> = computed(
    () => this.discountAmount() > 0 && this.discountReasonState().trim().length === 0,
  );

  /** Everything that must be true before the order can be sent. */
  readonly canSubmit: Signal<boolean> = computed(
    () => !this.isEmpty() && !this.discountExceedsLimit() && !this.needsDiscountReason(),
  );

  /**
   * Adds one, or raises the quantity if it is already there.
   *
   * Tapping the same card twice is how two bowls are ordered — a second line would make the
   * cart harder to read and would hit the unique index on (order, product) at the database.
   */
  add(product: Product): void {
    this.linesState.update((lines) => {
      const existing = lines.find((line) => line.product.id === product.id);

      return existing === undefined
        ? [...lines, { product, quantity: 1 }]
        : lines.map((line) =>
            line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
          );
    });
  }

  increase(productId: string): void {
    this.linesState.update((lines) =>
      lines.map((line) =>
        line.product.id === productId ? { ...line, quantity: line.quantity + 1 } : line,
      ),
    );
  }

  /** Decreasing past one removes the line — no confirm dialog for a two-tap correction. */
  decrease(productId: string): void {
    this.linesState.update((lines) =>
      lines.flatMap((line) => {
        if (line.product.id !== productId) {
          return [line];
        }

        return line.quantity <= 1 ? [] : [{ ...line, quantity: line.quantity - 1 }];
      }),
    );
  }

  remove(productId: string): void {
    this.linesState.update((lines) => lines.filter((line) => line.product.id !== productId));
  }

  quantityOf(productId: string): number {
    return this.linesState().find((line) => line.product.id === productId)?.quantity ?? 0;
  }

  setDiscount(type: DiscountType, value: number): void {
    this.discountTypeState.set(type);
    this.discountValueState.set(type === DiscountType.NONE ? 0 : Math.max(0, value));

    if (type === DiscountType.NONE) {
      this.discountReasonState.set('');
    }
  }

  setDiscountReason(reason: string): void {
    this.discountReasonState.set(reason);
  }

  setNotes(notes: string): void {
    this.notesState.set(notes);
  }

  setCustomer(name: string, phone: string): void {
    this.customerNameState.set(name);
    this.customerPhoneState.set(phone);
  }

  /**
   * Empties everything, ready for the next customer.
   *
   * Called after a successful order. Resetting the notes and customer too is deliberate:
   * "extra chocolate" carried onto the next person's order is worse than retyping it.
   */
  reset(): void {
    this.linesState.set([]);
    this.discountTypeState.set(DiscountType.NONE);
    this.discountValueState.set(0);
    this.discountReasonState.set('');
    this.notesState.set('');
    this.customerNameState.set('');
    this.customerPhoneState.set('');
  }

  /**
   * Everything `reset()` clears, as one value.
   *
   * Exists so a "Clear" can be undone exactly. Restoring by re-adding products would rebuild the lines
   * but lose the discount, the reason, the notes and the customer — an undo that returns *most* of what
   * it took is worse than no undo, because the user stops checking.
   */
  snapshot(): CartSnapshot {
    return {
      lines: this.linesState(),
      discountType: this.discountTypeState(),
      discountValue: this.discountValueState(),
      discountReason: this.discountReasonState(),
      notes: this.notesState(),
      customerName: this.customerNameState(),
      customerPhone: this.customerPhoneState(),
    };
  }

  /**
   * Puts a snapshot back.
   *
   * Only ever called with a value this store produced, so there is nothing to validate — and
   * deliberately no merge: an undo restores the cart as it was, it does not combine that with whatever
   * was tapped in the meantime.
   */
  restore(snapshot: CartSnapshot): void {
    this.linesState.set(snapshot.lines);
    this.discountTypeState.set(snapshot.discountType);
    this.discountValueState.set(snapshot.discountValue);
    this.discountReasonState.set(snapshot.discountReason);
    this.notesState.set(snapshot.notes);
    this.customerNameState.set(snapshot.customerName);
    this.customerPhoneState.set(snapshot.customerPhone);
  }

  /** The request body. Product ids and quantities only — never prices. */
  toRequestLines(): { productId: string; quantity: number }[] {
    return this.linesState().map((line) => ({
      productId: line.product.id,
      quantity: line.quantity,
    }));
  }

  customerPayload(): { name?: string; phone?: string } | undefined {
    const name = this.customerNameState().trim();
    const phone = this.customerPhoneState().trim();

    if (name.length === 0 && phone.length === 0) {
      return undefined;
    }

    return {
      ...(name.length === 0 ? {} : { name }),
      ...(phone.length === 0 ? {} : { phone }),
    };
  }
}
