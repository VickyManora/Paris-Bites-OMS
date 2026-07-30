import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import {
  MATERIAL_CORE_IMPORTS,
  MATERIAL_FORM_IMPORTS,
} from '../../../../shared/material/material-imports';
import { money } from '../../../../shared/utils/format.utils';
import { STORE_MANAGER_MAX_DISCOUNT_PERCENT, type DiscountType } from '../../models/pos.model';
import { NotificationService } from '../../../../core/services/notification.service';
import { PosCartStore } from '../../services/pos-cart-store.service';

/**
 * The cart, wherever it happens to be shown.
 *
 * Extracted from the order page because the same cart has to be a sticky column on a tablet and
 * a slide-up sheet on a phone. Rendering it twice with two sets of markup guarantees the two
 * drift, and the cart is the last thing anyone wants subtly different between devices.
 *
 * `PosCartStore` is injected rather than passed in. This is always rendered inside the order
 * page's template, so the element injector resolves the page's instance — the cart it shows is
 * necessarily the cart being submitted, which an input could not guarantee.
 *
 * Deliberately owns no network state. `saving` arrives as an input because the page makes the
 * request and holds the idempotency key; this component only reflects it.
 */
@Component({
  selector: 'pb-pos-cart-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [...MATERIAL_CORE_IMPORTS, ...MATERIAL_FORM_IMPORTS],
  // `@container` makes this panel the reference for the container queries inside it, so the cart
  // adapts to the width it was given rather than to the viewport.
  host: { class: '@container flex min-h-0 flex-col' },
  template: `
    <header
      class="flex shrink-0 items-center justify-between gap-pb-2 border-b border-pos-gold/40 px-pb-3 py-pb-2"
    >
      <h2 class="m-0 text-pb-subtitle font-bold text-pos-brown">
        Cart
        @if (cart.itemCount() > 0) {
          <span class="text-xs font-normal opacity-75">
            · {{ cart.itemCount() }} item{{ cart.itemCount() === 1 ? '' : 's' }}
          </span>
        }
      </h2>

      <div class="flex items-center gap-1">
        @if (!cart.isEmpty()) {
          <button
            matButton
            type="button"
            class="!min-h-12"
            [disabled]="saving()"
            (click)="clearWithUndo()"
          >
            Clear
          </button>
        }
        <!-- Only in the sheet: the column version has nothing to dismiss. -->
        @if (dismissable()) {
          <button
            matIconButton
            type="button"
            class="!h-12 !w-12"
            aria-label="Close the cart"
            (click)="dismiss.emit()"
          >
            <mat-icon>close</mat-icon>
          </button>
        }
      </div>
    </header>

    @if (cart.isEmpty()) {
      <div class="flex flex-1 flex-col items-center justify-center gap-pb-3 p-pb-6 text-center">
        <span
          class="grid h-16 w-16 place-items-center rounded-pb-full bg-pos-gold/15 text-pos-gold"
          aria-hidden="true"
        >
          <mat-icon class="!h-8 !w-8 !text-[32px]">shopping_cart</mat-icon>
        </span>
        <div>
          <p class="m-0 text-pb-subtitle font-semibold text-pos-brown">Nothing in the cart</p>
          <p class="m-0 mt-0.5 text-pb-caption text-pos-brown/60">
            Tap a product to start the order.
          </p>
        </div>
      </div>
    } @else {
      <ul
        class="pb-scroll-thin m-0 flex min-h-0 flex-1 list-none flex-col divide-y divide-pos-gold/25 overflow-y-auto p-0"
      >
        @for (line of cart.lines(); track line.product.id) {
          <!--
            Two rows per line, not one.

            One row cannot hold a wrapping product name, a 48px stepper, a line total and a
            delete button inside a 336px cart: the fixed columns claim about 260px, the name is
            squeezed into what is left, and it wraps to three lines and collides with the minus
            button. Giving the name its own row costs a little height and makes every width fit —
            including the phone, where the same collision was one long product name away.
          -->
          <li class="pb-line-in flex flex-col gap-pb-2 px-pb-3 py-pb-3">
            <div class="flex items-start gap-pb-3">
              <!--
                A thumbnail, which the cart did not have.

                Not decoration: the cashier reads this list back to the customer, and a 40px photo
                is recognised faster than a name is read — especially for the four bowls whose names
                differ by one word. It also makes a mis-tap visible without parsing text, which is
                the error this panel exists to let someone catch.

                Square, and the same aspect as the product card's photo, so the two are obviously
                the same object at two sizes.
              -->
              @if (line.product.imageUrl !== null) {
                <img
                  [src]="line.product.imageUrl"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  class="h-10 w-10 shrink-0 rounded-pb-md object-cover"
                />
              } @else {
                <span
                  class="grid h-10 w-10 shrink-0 place-items-center rounded-pb-md bg-pos-pink/40 text-lg"
                  aria-hidden="true"
                >
                  🍫
                </span>
              }

              <!-- Wraps rather than truncating: "Death By C…" is not a product name, and the
                   person reading it is confirming an order out loud. -->
              <p class="m-0 min-w-0 flex-1 text-sm font-semibold leading-snug">
                {{ line.product.name }}
              </p>
              <span class="shrink-0 text-sm font-bold tabular-nums">
                {{ fmt(line.product.price * line.quantity) }}
              </span>
            </div>

            <!--
              48px steppers, adjacent, no dialog. Correcting a mis-tap is two taps, and at this
              size a thumb hits the one it aimed at — the previous 40px buttons sat below the
              minimum touch target with only 4px between them.
            -->
            <div class="flex items-center gap-pb-2">
              <!--
                A segmented stepper rather than three loose icon buttons.

                Same 48px targets — the floor for a thumb — but bounded as one object, so the minus
                and plus read as belonging to the quantity between them instead of as two of the four
                icon buttons on the row. The previous version put delete immediately beside plus with
                nothing to separate them, which is the pair you least want confused.
              -->
              <div
                class="flex items-center overflow-hidden rounded-pb-full border border-pos-gold/60 bg-white/60"
              >
                <button
                  matIconButton
                  type="button"
                  class="!h-12 !w-12"
                  [attr.aria-label]="'One fewer ' + line.product.name"
                  (click)="cart.decrease(line.product.id)"
                >
                  <mat-icon class="text-pos-brown">remove</mat-icon>
                </button>
                @if (line.quantity; as quantity) {
                  <span class="pb-pop min-w-7 text-center text-base font-bold tabular-nums">
                    {{ quantity }}
                  </span>
                }
                <button
                  matIconButton
                  type="button"
                  class="!h-12 !w-12"
                  [attr.aria-label]="'One more ' + line.product.name"
                  (click)="cart.increase(line.product.id)"
                >
                  <mat-icon class="text-pos-brown">add</mat-icon>
                </button>
              </div>

              <!--
                Shown only when the cart is wide enough to show it whole.

                In the 17rem tablet cart this truncated to "₹149…", and half a price is worse
                than no price — it reads as a different, smaller number. A container query asks
                the cart how much room it has rather than asking the window, which is the only
                thing that can answer: the same panel is 390px in the phone sheet and 17rem in
                the tablet column at viewport widths that tell you nothing about either.
              -->
              <span class="ml-auto hidden min-w-0 text-xs opacity-70 @min-[20rem]:inline">
                {{ fmt(line.product.price) }} each
              </span>

              <button
                matIconButton
                type="button"
                class="!h-12 !w-12 shrink-0"
                [attr.aria-label]="'Remove ' + line.product.name"
                (click)="cart.remove(line.product.id)"
              >
                <mat-icon class="text-error">delete_outline</mat-icon>
              </button>
            </div>
          </li>
        }
      </ul>

      <!--
        The checkout block, pinned to the bottom of the panel.

        'sticky bottom-0' rather than merely last in the column: in the phone sheet the lines scroll
        inside this panel, and a total that scrolls away with them is the one number the cashier
        needs while scrolling. The upward shadow is what says there is more list above it.
      -->
      <div
        class="sticky bottom-0 shrink-0 border-t border-pos-gold/40 bg-pos-vanilla p-pb-3 shadow-[0_-6px_16px_-10px_rgb(0_0_0/0.28)]"
      >
        <!-- Notes and discount are collapsed by default: the overwhelming majority of orders
             need neither, and a screen that shows every option always is slower than one that
             shows the two buttons that matter. -->
        @if (showExtras()) {
          <div class="mb-3 flex flex-col gap-2">
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Order notes</mat-label>
              <input
                matInput
                [value]="cart.notes()"
                maxlength="500"
                (input)="cart.setNotes($any($event.target).value)"
              />
            </mat-form-field>

            <div class="flex gap-2">
              <mat-form-field class="flex-1" subscriptSizing="dynamic">
                <mat-label>Discount</mat-label>
                <mat-select
                  [value]="cart.discountType()"
                  (selectionChange)="onDiscountType($event.value)"
                >
                  <mat-option value="NONE">None</mat-option>
                  <mat-option value="PERCENTAGE">Percent</mat-option>
                  <mat-option value="FLAT">Flat ₹</mat-option>
                </mat-select>
              </mat-form-field>

              @if (cart.discountType() !== 'NONE') {
                <mat-form-field class="w-24" subscriptSizing="dynamic">
                  <mat-label>Value</mat-label>
                  <input
                    matInput
                    type="number"
                    min="0"
                    inputmode="decimal"
                    [value]="cart.discountValue()"
                    (input)="onDiscountValue($any($event.target).value)"
                  />
                </mat-form-field>
              }
            </div>

            @if (cart.discountAmount() > 0) {
              <mat-form-field subscriptSizing="dynamic">
                <mat-label>Discount reason</mat-label>
                <input
                  matInput
                  [value]="cart.discountReason()"
                  maxlength="200"
                  (input)="cart.setDiscountReason($any($event.target).value)"
                />
                @if (cart.needsDiscountReason()) {
                  <mat-error>Required for any discount.</mat-error>
                }
              </mat-form-field>
            }

            @if (cart.discountExceedsLimit()) {
              <p class="m-0 text-xs text-pb-danger-fg">
                {{ cart.discountPercent() }}% is above your {{ maxDiscount }}% limit — an
                administrator can approve more.
              </p>
            }

            <div class="flex flex-col gap-2 sm:flex-row">
              <mat-form-field class="flex-1" subscriptSizing="dynamic">
                <mat-label>Customer (optional)</mat-label>
                <input
                  matInput
                  [value]="cart.customerName()"
                  maxlength="120"
                  (input)="onCustomerName($any($event.target).value)"
                />
              </mat-form-field>
              <mat-form-field class="flex-1" subscriptSizing="dynamic">
                <mat-label>Phone</mat-label>
                <input
                  matInput
                  type="tel"
                  inputmode="tel"
                  [value]="cart.customerPhone()"
                  maxlength="20"
                  (input)="onCustomerPhone($any($event.target).value)"
                />
              </mat-form-field>
            </div>
          </div>
        }

        <button matButton type="button" class="mb-2 !min-h-12 w-full" (click)="toggleExtras()">
          <mat-icon>{{ showExtras() ? 'expand_less' : 'tune' }}</mat-icon>
          {{ showExtras() ? 'Hide' : 'Notes, discount, customer' }}
        </button>

        <dl class="m-0 mb-pb-3 flex flex-col gap-pb-1">
          <div class="flex justify-between">
            <dt class="text-pb-caption text-pos-brown/70">Subtotal</dt>
            <dd class="m-0 text-pb-caption tabular-nums">{{ fmt(cart.subtotal()) }}</dd>
          </div>
          @if (cart.discountAmount() > 0) {
            <div class="flex justify-between">
              <dt class="text-pb-caption text-pos-brown/70">
                Discount ({{ cart.discountPercent() }}%)
              </dt>
              <dd class="m-0 text-pb-caption tabular-nums text-pb-danger-fg">
                −{{ fmt(cart.discountAmount()) }}
              </dd>
            </div>
          }
          <!--
            The total, at 36px against the subtotal's 13.

            It is the number read out loud and the number the customer checks, and at 28px it was
            only a size and a half above the line totals above it. Proportional figures rather than
            tabular: nothing aligns under this, and equal-width digits make ₹149 look gappy.
          -->
          <div
            class="mt-pb-1 flex items-baseline justify-between border-t border-pos-gold/40 pt-pb-3"
          >
            <dt class="text-pb-subtitle font-bold text-pos-brown">Total</dt>
            <dd class="m-0 text-[2.25rem] font-bold leading-none tracking-[-0.02em] text-pos-brown">
              {{ fmt(cart.grandTotal()) }}
            </dd>
          </div>
        </dl>

        <!-- One tap to the payment sheet. Deliberately huge and hard to miss. -->
        <!--
          One tap to the payment sheet. Deliberately huge and hard to miss: 64px, full width, and the
          only filled control in the panel.
        -->
        <button
          matButton="filled"
          type="button"
          class="pb-gradient-brand !h-16 w-full !rounded-pb-lg !text-base !font-bold"
          [disabled]="!cart.canSubmit() || saving()"
          (click)="checkout.emit()"
        >
          <mat-icon>point_of_sale</mat-icon>
          {{ saving() ? 'Saving…' : 'Charge ' + fmt(cart.grandTotal()) }}
        </button>
      </div>
    }
  `,
})
export class PosCartPanelComponent {
  protected readonly cart = inject(PosCartStore);
  private readonly notifications = inject(NotificationService);

  /** True while the order is in flight, which disables everything that would change it. */
  readonly saving = input(false);

  /** Shows the close button. Set in the mobile sheet; false for the sticky column. */
  readonly dismissable = input(false);

  readonly checkout = output<void>();
  readonly dismiss = output<void>();

  protected readonly maxDiscount = STORE_MANAGER_MAX_DISCOUNT_PERCENT;
  protected readonly showExtras = signal(false);

  protected fmt(value: number): string {
    return money(value);
  }

  protected toggleExtras(): void {
    this.showExtras.update((open) => !open);
  }

  protected onDiscountType(value: DiscountType): void {
    this.cart.setDiscount(value, this.cart.discountValue());
  }

  protected onDiscountValue(value: string): void {
    this.cart.setDiscount(this.cart.discountType(), Number(value));
  }

  protected onCustomerName(value: string): void {
    this.cart.setCustomer(value, this.cart.customerPhone());
  }

  protected onCustomerPhone(value: string): void {
    this.cart.setCustomer(this.cart.customerName(), value);
  }

  /** Collapses the extras again, so a fresh cart opens in its fast default shape. */
  collapseExtras(): void {
    this.showExtras.set(false);
  }

  /**
   * Clears the cart, and offers it back for a few seconds.
   *
   * This is the one destructive action in the app where undo is honest. Everything the button throws
   * away is **local signal state** — no request has been made, so restoring it is exact and cannot fail.
   * A snapshot rather than a re-add, so the discount, its reason, the notes and the customer come back
   * with the lines; see `PosCartStore.snapshot`.
   *
   * Deliberately not applied to a record deletion. The pattern there would be to defer the request and
   * fire it when the toast expires, which means the delete happens after the user has navigated away —
   * or does not happen at all if the tab closes. An undo that sometimes silently declines to do the
   * thing is worse than a confirm dialog.
   *
   * The clear is applied immediately rather than deferred, because the reason to clear a cart is that
   * the next customer is already at the counter.
   */
  protected async clearWithUndo(): Promise<void> {
    const snapshot = this.cart.snapshot();
    const count = this.cart.itemCount();

    this.cart.reset();

    const undone = await this.notifications.withUndo(
      `Cart cleared — ${String(count)} ${count === 1 ? 'item' : 'items'} removed.`,
    );

    /*
     * Only restore if the cart is still empty.
     *
     * Between clearing and the tap on Undo the cashier may have started the next order. Overwriting
     * that with the previous customer's cart would be the undo causing the problem it exists to fix.
     */
    if (undone && this.cart.isEmpty()) {
      this.cart.restore(snapshot);
    }
  }
}
