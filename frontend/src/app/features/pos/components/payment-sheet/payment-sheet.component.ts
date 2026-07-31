import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
  type Signal,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import type { PbIconName } from '../../../../shared/components/icon/icon-registry';
import {
  MATERIAL_CORE_IMPORTS,
  MATERIAL_FEEDBACK_IMPORTS,
  MATERIAL_FORM_IMPORTS,
} from '../../../../shared/material/material-imports';
import { money } from '../../../../shared/utils/format.utils';
import { PAYMENT_METHODS, PaymentMethod } from '../../models/pos.model';
import { UPI_ID, UPI_QR_SRC } from '../../models/upi-qr';

/** How long the success panel stays up before the sheet closes itself. */
const SUCCESS_DWELL_MS = 2000;

/** What the sheet needs to confirm an order that has already been saved. */
export interface PaymentSheetSuccess {
  readonly orderNumber: string;
  readonly grandTotal: number;
}

/**
 * What the sheet hands back: one entry per tender.
 *
 * A list even for a single method — paying by cash alone is a split of one — so the page has no
 * branch for "single" and the server has no special case to keep working.
 */
export interface PaymentSheetResult {
  readonly payments: readonly {
    readonly method: PaymentMethod;
    readonly amount: number;
    readonly reference?: string | undefined;
  }[];
}

/** What the sheet is currently collecting. `SPLIT` is not a payment method — it is a mode. */
type PaymentMode = PaymentMethod | 'SPLIT';

/** Money is compared and summed in paise here for the same reason the server does it. */
const PAISE = 100;

function toPaise(rupees: number): number {
  return Math.round(rupees * PAISE);
}

export interface PaymentSheetData {
  readonly total: number;
  readonly itemCount: number;
  /**
   * Whether the order is currently in flight, owned by the order page.
   *
   * The page makes the request because it holds the cart and the idempotency key; this sheet
   * only reflects the state. Passing signals rather than the service keeps the sheet free of
   * any opinion about how an order is saved.
   */
  readonly saving: Signal<boolean>;
  /** The last failure, or `null`. Shown inline, with the confirm button becoming a retry. */
  readonly error: Signal<string | null>;
  /**
   * The saved order, once there is one. Null until then.
   *
   * The page sets this instead of closing the sheet, so the confirmation appears where the money
   * is rather than in a snackbar behind it. **The sheet closes itself** two seconds later — see
   * `SUCCESS_DWELL_MS`. Nothing about how the order is saved moved: the page still owns the
   * request, the idempotency key, the cart reset and the focus return, all of which happen the
   * moment the response lands and none of which wait for this panel.
   */
  readonly success: Signal<PaymentSheetSuccess | null>;

  /** Hands the chosen payment to the page. The page closes this sheet once the order is saved. */
  readonly confirm: (result: PaymentSheetResult) => void;
}

/**
 * Takes the payment.
 *
 * The only dialog in the order flow, and it earns its place: this is the one moment the staff
 * member stops to look at something — the QR on screen, or the notes in their hand.
 *
 * **Cash confirms in one tap.** It opens straight onto two big buttons and pressing one starts
 * the save, so an order paid in cash costs three taps from the cart.
 *
 * **UPI shows the static QR and waits.** There is no gateway, so nothing can tell this screen
 * the money arrived; a person looks at the customer's phone and says so. The confirm button is
 * therefore worded as an assertion — "Payment received" — rather than as a status, because that
 * is all it records.
 *
 * **It stays open while the order saves.** Closing first and reporting the outcome behind it was
 * the wrong shape for a counter on mobile data: the cashier loses the QR, the amount and the
 * method they just chose at the exact moment the network hesitates, and the only way back is to
 * rebuild the payment. Holding the sheet open means the failure appears where the money is, and
 * Try again re-sends the same attempt — which the server deduplicates, so no customer is charged
 * twice for tapping it.
 */
@Component({
  selector: 'pb-payment-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    IconComponent,
    ...MATERIAL_CORE_IMPORTS,
    ...MATERIAL_FORM_IMPORTS,
    ...MATERIAL_FEEDBACK_IMPORTS,
  ],
  template: `
    <div class="pos-light-surface bg-pos-vanilla text-pos-brown">
      <!--
        ============================ SUCCESS ============================

        Replaces the whole sheet the moment the order is saved, and closes itself two seconds later.

        The order was already saved before this appeared — nothing here can fail, and nothing here is
        a decision. It exists because the previous version closed the sheet instantly and reported
        the outcome in a snackbar at the bottom of the screen: at a counter, that is a confirmation
        the cashier reads *after* they have already turned back to the customer, if they read it at
        all. Two seconds of a full-panel confirmation carrying the order number and the amount is
        what lets them glance, see it landed, and move.

        Two seconds is also the ceiling. This is the hot path, the next customer is already there,
        and a confirmation that has to be dismissed is a tap added to every order in the day.
      -->
      @if (success(); as saved) {
        <div
          class="flex flex-col items-center gap-pb-3 px-pb-5 py-pb-7 text-center"
          role="status"
          aria-live="polite"
        >
          <span
            class="pb-success-pop grid h-20 w-20 place-items-center rounded-pb-full bg-pb-success-surface text-pb-success-fg"
            aria-hidden="true"
          >
            <!--
              The tick draws itself rather than fading in: a mark that *draws* reads as something
              that just happened, where one that appears reads as something that was always there
              and you only noticed. 'pathLength="1"' makes the dash values unit-independent.
            -->
            <svg viewBox="0 0 24 24" fill="none" class="h-10 w-10" aria-hidden="true">
              <path
                class="pb-tick"
                pathLength="1"
                d="M4 12.5l5.2 5.2L20 7"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>

          <p class="pb-rise-in m-0 text-pb-title font-bold text-pos-brown">Payment successful</p>

          <!--
            Order number and amount, staggered by 60ms so the panel assembles in the order it should
            be read instead of arriving as one block. The delay is inline because it is a per-element
            value, not a token.
          -->
          <p
            class="pb-rise-in m-0 font-mono text-pb-body tracking-wide text-pos-brown/70"
            style="animation-delay: 60ms"
          >
            {{ saved.orderNumber }}
          </p>

          <p
            class="pb-rise-in m-0 text-[2.5rem] font-bold leading-none tracking-[-0.02em] text-pos-brown"
            style="animation-delay: 120ms"
          >
            {{ fmt(saved.grandTotal) }}
          </p>
        </div>
      } @else {
        <h2 mat-dialog-title class="!text-pos-brown">
          Take payment
          <span class="block text-pb-caption font-normal text-pos-brown/60">
            {{ data.itemCount }} item{{ data.itemCount === 1 ? '' : 's' }}
          </span>
        </h2>

        <mat-dialog-content>
          <!--
            The amount is the largest thing on the sheet. It is what both people are looking at, and
            it is what the staff member reads out loud.
          -->
          <div
            class="mb-pb-4 flex flex-col items-center gap-pb-1 rounded-pb-xl border border-pos-gold/50 bg-pos-gold/10 py-pb-4"
          >
            <span class="text-pb-overline uppercase text-pos-brown/60">Amount due</span>
            <!-- Proportional figures, not tabular: at this size equal-width digits make a number
                 like ₹149 look gappy, and nothing is aligning under it. -->
            <span class="text-[3rem] font-bold leading-none tracking-[-0.02em] text-pos-brown">
              {{ total }}
            </span>
          </div>

          @if (method() === null) {
            <!--
              Two methods, two columns, and each target is 8rem tall.

              This is the one dialog in the hot path, so the two things it asks for are made as large
              as the sheet allows: at 128px a method is hit without aiming, which is the difference
              between a tap and a glance-then-tap when there is a queue.
            -->
            <div class="grid grid-cols-2 gap-pb-3">
              @for (option of methods; track option.value) {
                <button type="button" [class]="methodTileClass" (click)="choose(option.value)">
                  <span
                    class="grid h-14 w-14 place-items-center rounded-pb-full bg-pos-gold/15 text-pos-brown"
                    aria-hidden="true"
                  >
                    <pb-icon [name]="iconFor(option.value)" [size]="28" [strokeWidth]="2" />
                  </span>
                  <span class="text-base font-bold">{{ option.label }}</span>
                </button>
              }

              <!--
                Split, given the full width beneath the two single methods.

                Below rather than beside them because it is a different kind of choice: cash and UPI
                answer "which one", and this answers "more than one". Full width also keeps the two
                common paths as the largest targets on the sheet, which is what the ten-second goal
                depends on — a split is the exception, not the default.
              -->
              <button
                type="button"
                [class]="methodTileClass + ' col-span-2 !min-h-24 !flex-row !gap-pb-3'"
                (click)="choose('SPLIT')"
              >
                <span
                  class="grid h-12 w-12 shrink-0 place-items-center rounded-pb-full bg-pos-gold/15 text-pos-brown"
                  aria-hidden="true"
                >
                  <pb-icon name="split" [size]="24" [strokeWidth]="2" />
                </span>
                <span class="text-left">
                  <span class="block text-base font-bold">Split payment</span>
                  <span class="block text-pb-caption text-pos-brown/70"> Part cash, part UPI </span>
                </span>
              </button>
            </div>
          } @else if (method() === 'SPLIT') {
            <!--
              ============================ SPLIT ============================

              One amount field per method, and a running Remaining underneath.

              **The cashier keys one amount and the other field fills itself with the rest.** A
              two-tender split has exactly one degree of freedom — once you know the cash, the UPI
              is not a second decision, it is arithmetic — so asking for both is asking the person
              at the counter to do a subtraction the screen has already done. Either field can be
              the one they type in, and typing in the other moves the split point rather than
              fighting the fill: see setAmount() below.

              **Remaining is computed in paise**, like the server's own check — 0.1 + 0.2 is not 0.3,
              and a Remaining that reads ₹0.00 while the confirm button stays disabled because the
              float is 0.0000001 out is the worst possible version of this screen.
            -->
            <div class="flex flex-col gap-pb-3">
              <p class="m-0 text-pb-caption text-pos-brown/70">
                Enter one amount — the other fills in with the rest.
              </p>

              @for (option of methods; track option.value) {
                <div class="rounded-pb-lg border border-pos-gold/40 bg-pos-vanilla p-pb-3">
                  <div class="flex items-center gap-pb-3">
                    <span
                      class="grid h-10 w-10 shrink-0 place-items-center rounded-pb-full bg-pos-gold/15 text-pos-brown"
                      aria-hidden="true"
                    >
                      <pb-icon [name]="iconFor(option.value)" [size]="20" [strokeWidth]="2" />
                    </span>

                    <label
                      class="min-w-0 flex-1 text-pb-subtitle font-bold"
                      [attr.for]="'pb-split-' + option.value"
                    >
                      {{ option.label }}
                    </label>

                    <!--
                      'inputmode="decimal"' rather than 'type="number"'.

                      A number input on a phone shows a keypad with a spinner and silently accepts
                      'e' and '+'; on a desktop a stray scroll over a focused field changes the
                      amount, which on a payment screen is money moving because someone's finger
                      brushed a trackpad. Text plus a decimal keypad gives the same keyboard and
                      none of that.
                    -->
                    <div
                      class="flex w-36 shrink-0 items-center gap-1 rounded-pb-md border border-pos-gold/50 bg-white px-pb-2 focus-within:border-pos-brown focus-within:shadow-pb-focus"
                    >
                      <span class="text-pb-body text-pos-brown/60" aria-hidden="true">₹</span>
                      <input
                        [id]="'pb-split-' + option.value"
                        type="text"
                        inputmode="decimal"
                        autocomplete="off"
                        class="min-w-0 flex-1 appearance-none border-0 bg-transparent py-pb-2 text-right text-pb-title font-bold tabular-nums text-pos-brown outline-none"
                        [value]="amountFor(option.value)"
                        [disabled]="busy()"
                        [attr.aria-label]="option.label + ' amount'"
                        (input)="setAmount(option.value, $any($event.target).value)"
                      />
                    </div>
                  </div>
                </div>
              }

              <!--
                The running balance, and the only thing on this panel that changes as you type.

                Its tone is the state: amber while there is money outstanding, green the moment the
                split balances. That is what the cashier is watching for, so it says "Payment
                complete" rather than "₹0.00" — a zero is a number to interpret, a sentence is not.
              -->
              <div [class]="remainingClass()" aria-live="polite">
                <pb-icon [name]="remainingIcon()" [size]="18" class="shrink-0" />
                <span class="flex-1 text-pb-body font-semibold">{{ remainingLabel() }}</span>
                @if (remaining() !== 0) {
                  <span class="text-pb-title font-bold tabular-nums">
                    {{ fmt(absRemaining()) }}
                  </span>
                }
              </div>

              @if (upiInSplit()) {
                <mat-form-field class="w-full" subscriptSizing="dynamic">
                  <mat-label>UPI reference (optional)</mat-label>
                  <input
                    matInput
                    [value]="reference()"
                    maxlength="60"
                    [disabled]="busy()"
                    (input)="reference.set($any($event.target).value)"
                  />
                  <mat-hint>Last digits from their screen, if you want a record</mat-hint>
                </mat-form-field>
              }
            </div>
          } @else if (method() === 'UPI') {
            <div class="flex flex-col items-center gap-pb-3">
              <!--
                Fixed width rather than a square box: the QR is 455x520, and forcing it into a
                square would stretch it. A distorted QR is a QR that might not scan.

                240px is comfortably above the smallest size this image was verified to decode at,
                and eager loading beats lazy here — the customer is already waiting.

                'pb-qr-in' scales it up from 92% as it fades: this is the one animation on the sheet
                the *customer* sees, and a code that appears instantly is indistinguishable from one
                that was always there and they missed.
              -->
              <img
                [src]="qrSrc"
                alt="Scan to pay Paris Bites by UPI"
                width="455"
                height="520"
                loading="eager"
                decoding="sync"
                class="pb-qr-in h-auto w-60 rounded-pb-lg border border-pos-gold/50 bg-white p-pb-2 shadow-pb-sm"
              />

              <p class="m-0 text-center text-pb-caption text-pos-brown/70">
                UPI ID <span class="font-semibold text-pos-brown">{{ upiId }}</span>
              </p>
              <p class="m-0 text-center text-pb-caption text-pos-brown/70">
                Ask the customer to scan and pay, then confirm below once you see it on their phone.
              </p>

              <mat-form-field class="w-full" subscriptSizing="dynamic">
                <mat-label>UPI reference (optional)</mat-label>
                <input
                  matInput
                  [value]="reference()"
                  maxlength="60"
                  [disabled]="busy()"
                  (input)="reference.set($any($event.target).value)"
                />
                <mat-hint>Last digits from their screen, if you want a record</mat-hint>
              </mat-form-field>
            </div>
          } @else {
            <div class="flex flex-col items-center gap-pb-2 py-pb-5">
              <span
                class="pb-qr-in grid h-20 w-20 place-items-center rounded-pb-full bg-pos-gold/15 text-pos-brown"
                aria-hidden="true"
              >
                <pb-icon name="cash" [size]="36" [strokeWidth]="1.75" />
              </span>
              <p class="m-0 text-center text-pb-body">Take the cash, then confirm.</p>
            </div>
          }

          <!--
            Saving and failure states live inside the sheet rather than in a toast.

            A snackbar at the bottom of a phone is easy to miss and gone in seconds; the person
            holding the till needs to know the order is still unsaved for as long as it is.
          -->
          @if (saving()) {
            <div
              class="mt-pb-3 flex items-center gap-pb-3 rounded-pb-lg border border-pos-gold/50 bg-pos-gold/10 p-pb-3"
              role="status"
            >
              <mat-spinner diameter="24" />
              <div class="min-w-0">
                <p class="m-0 text-pb-body font-bold text-pos-brown">Saving the order…</p>
                <p class="m-0 text-pb-caption text-pos-brown/70">
                  Keep this open until it confirms.
                </p>
              </div>
            </div>
          } @else if (error() !== null) {
            <!-- assertive: this replaces the outcome the cashier is waiting for. -->
            <div
              class="pb-tone-danger mt-pb-3 flex items-start gap-pb-3 rounded-pb-lg border p-pb-3"
              role="alert"
              aria-live="assertive"
            >
              <pb-icon name="warning" [size]="18" class="mt-0.5" />
              <div class="min-w-0">
                <p class="m-0 text-pb-body font-bold">Not saved</p>
                <p class="m-0 text-pb-caption">{{ error() }}</p>
                <p class="m-0 mt-pb-1 text-pb-caption">
                  Try again is safe — it cannot charge the customer twice.
                </p>
              </div>
            </div>
          }
        </mat-dialog-content>

        <mat-dialog-actions align="end" class="!px-pb-4 !pb-pb-4">
          @if (method() === null) {
            <button matButton type="button" class="!min-h-12" (click)="cancel()">Cancel</button>
          } @else {
            <!--
              Both escape routes are disabled mid-save. Leaving the sheet while the request is in
              flight would leave the cashier with no idea whether the order was taken.
            -->
            <button matButton type="button" class="!min-h-12" [disabled]="busy()" (click)="back()">
              <mat-icon>arrow_back</mat-icon>
              Change method
            </button>
            <button
              matButton="filled"
              type="button"
              class="pb-gradient-brand !h-14 !rounded-pb-lg !text-base !font-bold"
              [disabled]="!canConfirm()"
              (click)="confirm()"
            >
              <!--
                One projectable node per branch, and the label outside them.

                MatButton projects a single leading icon into its own slot; a branch holding both the
                icon and the text has two roots, and Angular then drops the icon into the default
                slot instead — it renders, slightly misaligned, which is the kind of thing nobody
                notices until it ships.
              -->
              @if (busy()) {
                <mat-spinner diameter="20" />
              } @else {
                <mat-icon>{{ confirmIcon() }}</mat-icon>
              }
              {{ confirmLabel() }}
            </button>
          }
        </mat-dialog-actions>
      }
    </div>
  `,
})
export class PaymentSheetComponent {
  protected readonly data = inject<PaymentSheetData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<PaymentSheetComponent, undefined>>(MatDialogRef);

  protected readonly methods = PAYMENT_METHODS;
  protected readonly method = signal<PaymentMode | null>(null);
  protected readonly reference = signal('');

  /**
   * What the cashier has keyed against each method, as typed.
   *
   * Held as **strings, not numbers**, and that is deliberate: a cashier midway through typing "2"
   * of "247" has a valid partial entry, and parsing to a number on every keystroke would rewrite
   * their field — "2." becomes 2 and the decimal point they just pressed disappears. The strings
   * are parsed when the total is computed and again on submit; the field they are typing in is
   * never reformatted underneath them.
   *
   * The *other* field is written here too, by `setAmount`, holding the balance of the bill. One map
   * for both rather than a separate "derived" value, because from every other point in this
   * component — Remaining, the confirm gate, the tenders sent to the server — a filled-in amount and
   * a keyed one are the same thing, and the cashier can overtype either.
   */
  private readonly amounts = signal<Readonly<Record<string, string>>>({});

  protected readonly methodTileClass =
    'flex min-h-32 cursor-pointer appearance-none flex-col items-center justify-center gap-pb-2 rounded-pb-xl border border-pos-gold/40 bg-pos-vanilla font-[inherit] text-inherit shadow-pb-xs transition-[transform,border-color,box-shadow] duration-pb-fast ease-pb-out hover:-translate-y-0.5 hover:border-pos-gold hover:shadow-pb-md active:translate-y-0 active:scale-[0.97] motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100';

  /**
   * Whether the request is in flight, and with it whether every control that could start or
   * abandon a second attempt is locked.
   *
   * The page's own signal, not a local copy: a boolean flipped on click would be a second guess
   * at the same fact and could drift out of step with the request it claims to describe.
   */
  protected readonly saving = this.data.saving;
  protected readonly busy = this.data.saving;

  protected readonly error = this.data.error;

  /** The saved order, once the page has one. Drives the success panel. */
  protected readonly success = this.data.success;

  /** `refresh` after a failure, so the button reads as a retry rather than a fresh confirmation. */
  protected readonly confirmIcon = computed(() => (this.error() === null ? 'check' : 'refresh'));

  protected readonly confirmLabel = computed(() => {
    if (this.busy()) {
      return 'Saving…';
    }

    return this.error() === null ? 'Payment received' : 'Try again';
  });

  protected readonly total = money(this.data.total);

  // ---------------------------------------------------------------------------
  // Split
  // ---------------------------------------------------------------------------

  /** What is keyed against one method, as the cashier typed it. */
  protected amountFor(method: PaymentMethod): string {
    return this.amounts()[method] ?? '';
  }

  /**
   * Accepts a keystroke into one amount field, and puts the rest of the bill in the other.
   *
   * Filters to digits and a single decimal point rather than rejecting the whole entry: a cashier
   * who fat-fingers a letter should lose that character, not their field. Capped at two decimal
   * places, matching what the column stores and what the server will accept.
   *
   * **The counterpart is rewritten on every keystroke, unconditionally.** Two tenders that have to
   * sum to the bill leave nothing to preserve in the other field — a value that no longer adds up
   * is not the cashier's earlier intent worth keeping, it is a stale subtraction. That also makes
   * the fill work in both directions with no notion of which field is "the" input: keying ₹300
   * against cash puts ₹200 on UPI, and then correcting UPI to ₹150 puts ₹350 back on cash. The
   * split balances after a single entry, so the confirm button is live immediately.
   *
   * The counterpart does run through the intermediate values while a figure is still being typed —
   * ₹3 of ₹300 briefly reads as ₹497 on the other row. It is the same field they are about to
   * stop touching, and every keystroke leaves it correct for what is actually keyed, which is the
   * property that matters when the last keystroke is the one that stands.
   */
  protected setAmount(method: PaymentMethod, raw: string): void {
    const cleaned = raw.replace(/[^\d.]/g, '');
    const [whole = '', ...rest] = cleaned.split('.');
    const value = rest.length === 0 ? whole : `${whole}.${rest.join('').slice(0, 2)}`;

    const other = this.counterpart(method);

    this.amounts.update((current) =>
      other === null
        ? { ...current, [method]: value }
        : { ...current, [method]: value, [other]: this.restOfBill(value) },
    );
  }

  /**
   * The method that carries whatever `method` does not, or `null` if that is not a single method.
   *
   * The counter takes cash and UPI, so there is always exactly one — but the panel is built from
   * `PAYMENT_METHODS`, and the day a third tender is offered "the rest" stops being one field.
   * Returning null then leaves both fields as plain manual entry, with Remaining doing the telling,
   * rather than silently dropping the balance on whichever method happened to be listed next.
   */
  private counterpart(method: PaymentMethod): PaymentMethod | null {
    const [only, ...others] = this.methods.filter((option) => option.value !== method);

    return only !== undefined && others.length === 0 ? only.value : null;
  }

  /**
   * What is left of the bill once `keyed` is taken off it, as a field value.
   *
   * Blank rather than "0.00" when nothing is left, and blank when the entry is over the bill: a
   * cleared cash field has to clear the UPI field with it, because leaving the whole total sitting
   * on one method is not a split — it is the single-method path, which is what the two buttons on
   * the previous screen are for. Over-tendering keeps the entry and lets Remaining say "Over by".
   *
   * Subtracted in paise for the same reason `remaining` is: this value is what the confirm button
   * ends up gating on, and it has to hit zero exactly.
   */
  private restOfBill(keyed: string): string {
    const parsed = Number.parseFloat(keyed);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return '';
    }

    const rest = (toPaise(this.data.total) - toPaise(parsed)) / PAISE;

    return rest > 0 ? rest.toFixed(2) : '';
  }

  /** The paise keyed so far, across every method. */
  private readonly tenderedPaise = computed(() =>
    this.methods.reduce((sum, option) => {
      const parsed = Number.parseFloat(this.amounts()[option.value] ?? '');
      return Number.isFinite(parsed) && parsed > 0 ? sum + toPaise(parsed) : sum;
    }, 0),
  );

  /**
   * What is still owed, in rupees. Negative when the cashier has keyed more than the bill.
   *
   * Derived in paise and converted once, so the value the button gates on and the value on screen
   * are the same arithmetic — a Remaining that reads ₹0.00 beside a disabled confirm button is the
   * one failure this screen cannot have.
   */
  protected readonly remaining = computed(
    () => (toPaise(this.data.total) - this.tenderedPaise()) / PAISE,
  );

  protected readonly absRemaining = computed(() => Math.abs(this.remaining()));

  /** True the moment the keyed amounts balance the bill exactly. */
  protected readonly splitBalances = computed(
    () => this.tenderedPaise() === toPaise(this.data.total),
  );

  protected readonly remainingLabel = computed(() => {
    const outstanding = this.remaining();

    if (outstanding > 0) {
      return 'Remaining';
    }

    return outstanding < 0 ? 'Over by' : 'Payment complete';
  });

  protected readonly remainingIcon = computed<PbIconName>(() =>
    this.splitBalances() ? 'ok' : 'warning',
  );

  protected readonly remainingClass = computed(() => {
    const base = 'flex items-center gap-pb-3 rounded-pb-lg border p-pb-3';
    return this.splitBalances() ? `${base} pb-tone-success` : `${base} pb-tone-warning`;
  });

  /** Whether a UPI amount has been keyed, which is what makes the reference field relevant. */
  protected readonly upiInSplit = computed(() => {
    const parsed = Number.parseFloat(this.amounts()[PaymentMethod.UPI] ?? '');
    return Number.isFinite(parsed) && parsed > 0;
  });

  protected fmt(value: number): string {
    return money(value);
  }

  /**
   * The method's glyph, mapped here rather than read from the model.
   *
   * `PAYMENT_METHODS` carries a Material Symbols name, and that constant is shared with the orders
   * list and the detail dialog — changing it would restyle screens this pass does not cover. The
   * mapping is presentation, so it lives in the component doing the presenting.
   */
  protected iconFor(method: PaymentMethod): PbIconName {
    return method === PaymentMethod.UPI ? 'qr' : 'cash';
  }

  /**
   * The store's real UPI QR, served as a static asset from the app's own origin.
   *
   * Not inlined as base64: at 60 kB it would add roughly 80 kB to the POS chunk on every
   * visit, including the majority of orders paid in cash. The order page preloads it instead,
   * so by the time anyone reaches this sheet the bytes are in cache — which keeps the original
   * guarantee that the QR never fails to appear on mobile data.
   *
   * Cropped from the printed bank card down to the QR and its quiet zone, and verified to
   * decode at every width this sheet renders it at. Re-cropping it without re-checking that
   * would break payments silently: an earlier crop looked perfect and decoded to nothing,
   * because the card printed border sat exactly where the quiet zone belonged.
   */
  protected readonly qrSrc = UPI_QR_SRC;

  /** Rendered as text rather than relying on the copy baked into the image. */
  protected readonly upiId = UPI_ID;

  protected choose(method: PaymentMode): void {
    this.method.set(method);
  }

  protected back(): void {
    this.method.set(null);
    this.reference.set('');
    // The amounts go too. Keeping them would mean returning to a split half-filled from a previous
    // attempt at a different method, which is a trap rather than a convenience.
    this.amounts.set({});
  }

  /**
   * Hands the payment to the page, which saves it.
   *
   * Does **not** close the sheet. The page closes it once the order is actually saved, so a
   * failure has somewhere to appear and the retry keeps the method and reference already keyed.
   */
  /**
   * Whether the sheet has enough to submit.
   *
   * For a single method that is simply "one is chosen" — the amount is the whole bill and there is
   * nothing to get wrong. For a split it is the balance being exactly zero, which is the same
   * condition the server re-checks: the button and the API agree on what "paid" means, so a
   * cashier can never be shown an enabled button that the server then rejects.
   */
  protected readonly canConfirm = computed(() => {
    const mode = this.method();

    if (mode === null || this.busy()) {
      return false;
    }

    return mode === 'SPLIT' ? this.splitBalances() : true;
  });

  /**
   * Hands the tenders to the page, which saves them.
   *
   * Does **not** close the sheet. The page reports the outcome back into it, so a failure has
   * somewhere to appear and a retry keeps the amounts already keyed — which for a split is the
   * difference between pressing Try again and re-entering the whole thing.
   */
  protected confirm(): void {
    const mode = this.method();

    if (mode === null || !this.canConfirm()) {
      return;
    }

    const reference = this.reference().trim();
    const withReference = reference.length === 0 ? {} : { reference };

    if (mode !== 'SPLIT') {
      // A split of one: the whole bill, that way. The server would apply the same amount itself,
      // but sending it keeps one shape on the wire for every payment.
      this.data.confirm({
        payments: [{ method: mode, amount: this.data.total, ...withReference }],
      });
      return;
    }

    const payments = this.methods
      .map((option) => ({
        method: option.value,
        amount: Number.parseFloat(this.amounts()[option.value] ?? ''),
      }))
      // A method the cashier left blank is not a zero payment, it is a method they did not use.
      .filter((tender) => Number.isFinite(tender.amount) && tender.amount > 0)
      .map((tender) => ({
        ...tender,
        ...(tender.method === PaymentMethod.UPI ? withReference : {}),
      }));

    this.data.confirm({ payments });
  }

  protected cancel(): void {
    if (this.busy()) {
      return;
    }

    this.dialogRef.close(undefined);
  }

  constructor() {
    /*
     * The sheet closes itself once the success panel has been up long enough to read.
     *
     * Here rather than in the page because the dwell is a property of *this* panel: the page's job
     * ended when the order came back, and it should not have to know how long a confirmation is
     * shown for. It also means the timer cannot outlive the thing it closes.
     *
     * The cleanup is not optional. `disableClose` is set on this dialog, but Escape is not the only
     * way it can go — a route change tears the overlay down, and a timer left running would then
     * call `close()` on a destroyed reference. `DestroyRef` covers every path.
     */
    const destroyRef = inject(DestroyRef);
    let timer: ReturnType<typeof setTimeout> | null = null;

    destroyRef.onDestroy(() => {
      if (timer !== null) {
        clearTimeout(timer);
      }
    });

    effect(() => {
      if (this.success() === null || timer !== null) {
        return;
      }

      timer = setTimeout(() => {
        timer = null;
        this.dialogRef.close(undefined);
      }, SUCCESS_DWELL_MS);
    });
  }
}
