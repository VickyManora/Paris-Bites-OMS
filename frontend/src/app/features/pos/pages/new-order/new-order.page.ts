import { BreakpointObserver } from '@angular/cdk/layout';
import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  type ElementRef,
  type OnInit,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { map } from 'rxjs';
import type { AppError } from '../../../../core/errors/app-error';
import { OnlineStatusService } from '../../../../core/services/online-status.service';
import { ConfirmDialogService } from '../../../../shared/components/confirm-dialog/confirm-dialog.service';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { SpinnerComponent } from '../../../../shared/components/spinner/spinner.component';
import {
  MATERIAL_CORE_IMPORTS,
  MATERIAL_FORM_IMPORTS,
} from '../../../../shared/material/material-imports';
import { money } from '../../../../shared/utils/format.utils';
import { PosCartPanelComponent } from '../../components/pos-cart-panel/pos-cart-panel.component';
import {
  PaymentSheetComponent,
  type PaymentSheetResult,
  type PaymentSheetSuccess,
} from '../../components/payment-sheet/payment-sheet.component';
import type { MenuCategory, Product } from '../../models/pos.model';
import { UPI_QR_SRC } from '../../models/upi-qr';
import { findPackagingProduct, waffleProductIds } from '../../models/waffle-packaging';
import { PosCartStore } from '../../services/pos-cart-store.service';
import { PosMenuCacheService } from '../../services/pos-menu-cache.service';
import { PosService } from '../../services/pos.service';

/** Below this the cart becomes a slide-up sheet. Matches the tablet breakpoint at 768px. */
const COMPACT_QUERY = '(max-width: 767.98px)';

/**
 * The order screen.
 *
 * Built around one number: a customer should be served in ten to fifteen seconds, on a phone,
 * with one hand. Everything here follows from that.
 *
 * **No dialogs in the hot path.** Tapping a product card adds it. Quantity is `+`/`−` on the
 * cart line. The only dialog is the payment sheet, which is the one moment the staff member
 * genuinely stops to look at something (the QR, or the cash in their hand).
 *
 * **The cart never round-trips while it is being built.** Every total is local arithmetic in
 * signals. One request goes out, on submit, with the payment attached — so the common path is
 * a single network call for the whole order rather than create-then-pay.
 *
 * **Search is focused on load and stays focused.** A keyboard-equipped counter can type three
 * letters and hit Enter to add the top match without touching the screen.
 *
 * **After saving, the cart clears itself** and focus returns to search. There is no "start
 * new order" step, because the next customer is already there.
 *
 * ## Shape by device
 *
 * | Viewport | Categories | Products | Cart |
 * |---|---|---|---|
 * | `< 768px` | chip row | 2 columns | slide-up sheet, opened from a floating button |
 * | `768–1024px` | chip row | 3 columns | sticky right column |
 * | `> 1024px` | left rail | 4–6 columns | sticky right column |
 *
 * The phone is the primary device, so it gets the layout that costs the fewest taps rather than
 * a narrowed version of the desktop one: the cart is out of the way until it is wanted, and the
 * running total is permanently visible without it.
 *
 * ## Behaviour on a bad connection
 *
 * The counter runs on mobile data, which fails in the middle of things rather than cleanly. Three
 * defences, and they are separate on purpose:
 *
 * - **Every request is bounded** by `timeoutInterceptor`, so nothing hangs indefinitely behind a
 *   disabled button.
 * - **A failed menu load offers a retry** instead of an empty grid that reads as "no products".
 * - **Order submission is idempotent.** `attemptKey` is held across retries of one order, so a
 *   reply lost after the server saved it cannot become a second charge. This is the case that
 *   actually happens: the request succeeded, the answer did not arrive, and the natural reaction
 *   is another tap.
 */
@Component({
  selector: 'pb-new-order-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [PosCartStore],
  imports: [
    NgTemplateOutlet,
    EmptyStateComponent,
    SpinnerComponent,
    PosCartPanelComponent,
    ...MATERIAL_CORE_IMPORTS,
    ...MATERIAL_FORM_IMPORTS,
  ],
  host: {
    class: 'block',
    // Escape closes the cart sheet — the keyboard equivalent of tapping the backdrop. Guarded
    // inside `closeCart`, so it cannot abandon a sheet mid-save.
    '(document:keydown.escape)': 'closeCart()',
  },
  template: `
    <!--
      Offline warning, above everything.

      The browser only ever reports "there is definitely no network", never that there is one,
      so this warns and does not block: taps still work, the cart still builds, and an order can
      still be attempted the moment signal returns.
    -->
    @if (!online()) {
      <div
        class="mb-3 flex items-center gap-2 rounded-xl border-2 border-pos-gold bg-pos-gold/20 px-3 py-2"
        role="status"
      >
        <mat-icon class="shrink-0 text-pos-brown" aria-hidden="true">wifi_off</mat-icon>
        <p class="text-pb-caption m-0 text-pos-brown">
          <span class="font-semibold">No connection.</span>
          Keep building the order — saving it will need signal.
        </p>
      </div>
    }

    <div class="flex flex-col gap-pb-4 md:flex-row">
      <!-- ============================ MENU ============================ -->
      <section class="flex min-w-0 flex-1 flex-col gap-3">
        <div class="flex items-center gap-2">
          <button
            matIconButton
            type="button"
            class="!h-12 !w-12 shrink-0"
            aria-label="Back to point of sale"
            (click)="leave()"
          >
            <mat-icon>arrow_back</mat-icon>
          </button>

          <mat-form-field class="min-w-0 flex-1" subscriptSizing="dynamic">
            <mat-label>Search the menu</mat-label>
            <mat-icon matPrefix>search</mat-icon>
            <input
              #searchBox
              matInput
              type="search"
              autocomplete="off"
              [value]="search()"
              (input)="onSearch($any($event.target).value)"
              (keydown.enter)="addTopMatch()"
            />
            @if (search().length > 0) {
              <button
                matIconButton
                matSuffix
                type="button"
                class="!h-12 !w-12"
                aria-label="Clear search"
                (click)="clearSearch()"
              >
                <mat-icon>close</mat-icon>
              </button>
            }
          </mat-form-field>
        </div>

        <!--
          Says where the menu on screen came from, and only while that is not the API.

          The counter can be used before the server is awake because the last known menu is cached
          (see 'PosMenuCacheService'). What makes that honest rather than merely convenient is this
          line: the cashier is told the prices are the last ones this browser saw, and that the
          total on the order will be the server's own. It disappears by itself the moment the fetch
          lands, which is also the signal that the API is back.
        -->
        @if (menuFromCacheAt(); as syncedAt) {
          <div
            class="pb-tone-warning mb-3 flex items-center gap-3 rounded-xl border p-3"
            role="status"
            aria-live="polite"
          >
            <mat-icon class="shrink-0" aria-hidden="true">cloud_sync</mat-icon>
            <p class="text-pb-caption m-0">
              <span class="font-semibold">Menu from {{ syncedLabel(syncedAt) }}.</span>
              Keep taking orders — the server sets the final total when the order is saved.
            </p>
          </div>
        }

        @if (loading()) {
          <div class="flex flex-1 items-center justify-center py-16">
            <pb-spinner size="lg" label="Loading the menu…" />
          </div>
        } @else if (menuError() !== null) {
          <!--
            A failed fetch is not an empty menu.

            This used to fall through to "No products on the menu", which told the cashier the
            wrong thing entirely — that the catalogue was unseeded rather than that the phone
            briefly lost signal — and offered nothing to do about it.
          -->
          <div
            class="pb-tone-danger flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-2 p-8 text-center"
            role="alert"
          >
            <mat-icon class="!h-10 !w-10 !text-[40px]" aria-hidden="true"> cloud_off </mat-icon>
            <div>
              <p class="text-pb-title m-0 font-bold">Could not load the menu</p>
              <p class="text-pb-caption m-0 mt-1 text-on-surface-variant">{{ menuError() }}</p>
            </div>
            <button matButton="filled" type="button" class="!h-12 !rounded-xl" (click)="loadMenu()">
              <mat-icon>refresh</mat-icon>
              Try again
            </button>
          </div>
        } @else if (menu().length === 0) {
          <pb-empty-state
            icon="restaurant_menu"
            title="No products on the menu"
            message="Seed the menu, or make some products available, and they will appear here."
          />
        } @else {
          <!-- Category chips below lg, where the rail would eat the product grid. A contained
               horizontal scroller — the page itself never scrolls sideways. -->
          <!--
            Sticky, and that is the change that matters here.

            The chips used to scroll away with the grid, so switching category from halfway down
            Waffles meant scrolling back to the top first — two gestures and a hunt, on the control
            that is tapped most after the cards. Pinned to the top of the scroll container they cost
            nothing and are always one tap away.

            The negative margin plus matching padding lets the row bleed to the page gutters while
            keeping the first chip clear of the edge, so a thumb starting at the screen edge does not
            land between chips.
          -->
          <!--
            One chip row at every width, replacing the vertical rail the desktop used to get.

            The rail was defensible — every category visible at once, fixed targets — but it cost a
            whole column of the product grid to say what a wrapping row of chips says in two lines,
            and it made the counter screen and the phone two different interfaces to learn. Chips
            **wrap** above md and scroll horizontally below it, so "every category visible at once"
            survives on the big screen and the phone keeps the row it had.

            Sticky, which is the part that matters most: the chips used to scroll away with the
            grid, so switching category from halfway down Waffles meant scrolling back to the top
            first — two gestures and a hunt, on the control tapped most after the cards.

            The negative margin plus matching padding lets the row bleed to the page gutters while
            keeping the first chip clear of the edge, so a thumb starting at the screen edge does not
            land between chips.
          -->
          <div
            class="pos-light-surface sticky top-0 z-10 -mx-pb-3 overflow-x-auto bg-pos-vanilla px-pb-3 py-pb-2 md:overflow-x-visible"
          >
            <!--
              'role=group' with a label, and 'aria-pressed' per chip.

              These are one mutually-exclusive filter, and they were a bare div of buttons: nothing
              said the row was a set, and nothing announced which chip was current — the selected
              state was carried by the brand gradient alone. A screen reader user heard six unrelated
              buttons and could not tell which filter was applied.

              'group' rather than 'tablist' deliberately. Tab semantics promise arrow-key navigation
              between the tabs, and that is not implemented here; claiming the role without the
              behaviour is worse than not claiming it, because it tells the user to press keys that
              do nothing. Toggle buttons in a labelled group is what this actually is.
            -->
            <div
              class="flex w-max gap-pb-2 md:w-auto md:flex-wrap"
              role="group"
              aria-label="Filter the menu by category"
            >
              <button
                type="button"
                [class]="tabClass(allTab)"
                [attr.aria-pressed]="category() === allTab"
                (click)="selectCategory(allTab)"
              >
                <span class="text-base leading-none" aria-hidden="true">✦</span>
                All
                <span [class]="countClass(allTab)">{{ totalProductCount() }}</span>
              </button>
              @for (category of menu(); track category.id) {
                <button
                  type="button"
                  [class]="tabClass(category.id)"
                  [attr.aria-pressed]="this.category() === category.id"
                  (click)="selectCategory(category.id)"
                >
                  @if (category.icon) {
                    <span class="text-base leading-none" aria-hidden="true">{{
                      category.icon
                    }}</span>
                  }
                  {{ category.name }}
                  <span [class]="countClass(category.id)">{{ category.products.length }}</span>
                </button>
              }
            </div>
          </div>

          @if (visibleProducts().length === 0) {
            <pb-empty-state
              icon="search_off"
              title="Nothing matches"
              [message]="'No product matches “' + search() + '”.'"
            />
          } @else {
            <!--
              Two columns on a phone, two or three on a tablet, four to five on a counter screen —
              chosen by the grid from the width it actually has, not from the width of the window.
              The cards are deliberately large: this is tapped with a thumb, often in a hurry,
              sometimes by someone holding a waffle.

              This used to be a ladder of viewport breakpoints, and it broke on a tablet. A
              viewport breakpoint cannot see the 72px sidebar rail or the cart column beside it, so
              at 768px the three columns it asked for were dividing 280px — 87px per card, with the
              product photo squeezed to a thumbnail. Auto-fill with a floor asks the opposite
              question: given this much room, how many 8rem cards fit? No width can be wrong,
              including ones no one thought to test.
            -->
            <!--
              Column count from a container query, not from auto-fill and not from the viewport.

              Three attempts, and the first two failed *silently*, which is why they are recorded here.

              A viewport ladder cannot see the 72-256px app sidebar or the cart column beside it, so at
              820px it asked for three columns of a 228px grid. Asking "how many 9.5rem cards fit" fixed
              that, but with less than twice the floor auto-fill answers **one** — and a one-column POS
              grid is a scrolling list, not a menu. Capping the floor at 48% looked right and generated
              real CSS, yet still measured one track: a percentage inside the floor makes the track
              indefinite, so auto-fill stops counting.

              So the grid asks its own container, the way the cart line already does. **Two columns is
              the floor at every width** — the phone and the squeezed-tablet cases give the same answer —
              stepping up as the container earns it. Measured at 390, 820, 1024 and 1440 with the app
              sidebar both collapsed and expanded.
            -->
            <!--
              The container is a wrapper, not the grid itself: a container query resolves against the
              nearest *ancestor* container, so an element carrying both @container and the @min-*
              variants queries nothing and every step silently fails closed. That cost the desktop a
              column before it was measured.
            -->
            <div class="@container">
              <div
                class="grid grid-cols-2 gap-pb-3 @min-[30rem]:grid-cols-3 @min-[44rem]:grid-cols-4 @min-[58rem]:grid-cols-5"
              >
                @for (product of visibleProducts(); track product.id) {
                  <!--
                  ============================ PRODUCT CARD ============================

                  Two shapes, chosen by whether the product is already in the cart.

                  **Not in the cart** — the whole card is one 'button'. That is the fastest possible
                  target: a thumb anywhere on a 152px card adds one, and there is exactly one tab
                  stop per product for a keyboard counter.

                  **In the cart** — the card becomes an 'article' holding a body button and a real
                  stepper. This is the change that matters for the ten-second goal: correcting a
                  mis-tap used to mean opening the cart, finding the line and pressing minus, which is
                  three interactions and a context switch. Now it is one tap where the cashier is
                  already looking.

                  It has to be two shapes rather than one card with an overlaid stepper, because a
                  'button' cannot contain a 'button'. Nesting them is invalid HTML and browsers
                  recover from it unpredictably — the inner control stops receiving clicks in some
                  engines, which at a counter would look like a dead minus key.
                -->
                  @if (cart.quantityOf(product.id) > 0) {
                    <article [class]="cardClass(product, true)">
                      <button
                        type="button"
                        class="flex flex-1 cursor-pointer appearance-none flex-col items-stretch border-0 bg-transparent p-0 text-left font-[inherit] text-inherit"
                        [attr.aria-label]="'Add another ' + product.name"
                        (click)="add(product)"
                      >
                        <span class="relative block">
                          <ng-container
                            [ngTemplateOutlet]="media"
                            [ngTemplateOutletContext]="{ product }"
                          />

                          <!--
                            The quantity badge, on the photo.

                            Redundant with the stepper below it, and deliberately so — they answer
                            different questions from different distances. The stepper is for the
                            hand: it corrects a mis-tap where the cashier is already looking. The
                            badge is for the eye at a metre: on a counter screen of sixteen cards,
                            "what is already on this order" has to be answerable in one sweep, and a
                            figure inside a 48px control at the bottom of a card is not.

                            'pb-pop' keyed on the value so it replays on every change rather than
                            only on creation — the key is what makes Angular recreate the node.
                          -->
                          @if (cart.quantityOf(product.id); as quantity) {
                            <span
                              class="pb-pop absolute right-pb-2 top-pb-2 grid h-8 min-w-8 place-items-center rounded-pb-full bg-pos-brown px-pb-1 text-sm font-bold tabular-nums text-pos-vanilla shadow-pb-sm"
                              aria-hidden="true"
                            >
                              {{ quantity }}
                            </span>
                          }
                        </span>

                        <span class="flex flex-1 flex-col items-start gap-pb-1 p-pb-3">
                          <ng-container
                            [ngTemplateOutlet]="label"
                            [ngTemplateOutletContext]="{ product }"
                          />
                        </span>
                      </button>

                      <!--
                      The stepper. 48px targets, adjacent, on the card itself.

                      The quantity is the badge's replacement: it was a floating pill in the corner,
                      which is a poor place for the one number the cashier checks — it overlapped the
                      photo and had no controls beside it. Here the figure and the two keys that change
                      it are the same object.
                    -->
                      <div
                        class="flex shrink-0 items-center justify-between gap-1 border-t border-pos-gold/50 bg-pos-gold/12 px-1 py-1"
                      >
                        <button
                          matIconButton
                          type="button"
                          class="!h-12 !w-12"
                          [attr.aria-label]="'One fewer ' + product.name"
                          (click)="cart.decrease(product.id)"
                        >
                          <mat-icon class="text-pos-brown">
                            {{ cart.quantityOf(product.id) === 1 ? 'delete_outline' : 'remove' }}
                          </mat-icon>
                        </button>

                        <!--
                        'pb-pop' keyed on the value, so the animation replays on every change rather
                        than only when the element is created. The key is what forces Angular to
                        recreate the node.
                      -->
                        @if (cart.quantityOf(product.id); as quantity) {
                          <span
                            class="min-w-8 text-center text-lg font-bold tabular-nums text-pos-brown"
                            [attr.aria-label]="quantity + ' in cart'"
                          >
                            {{ quantity }}
                          </span>
                        }

                        <button
                          matIconButton
                          type="button"
                          class="!h-12 !w-12"
                          [attr.aria-label]="'One more ' + product.name"
                          (click)="cart.increase(product.id)"
                        >
                          <mat-icon class="text-pos-brown">add</mat-icon>
                        </button>
                      </div>
                    </article>
                  } @else {
                    <button
                      type="button"
                      [disabled]="!product.isAvailable"
                      [class]="cardClass(product, false)"
                      (click)="add(product)"
                    >
                      <ng-container
                        [ngTemplateOutlet]="media"
                        [ngTemplateOutletContext]="{ product }"
                      />

                      <div class="flex flex-1 flex-col items-start gap-pb-1 p-pb-3">
                        <ng-container
                          [ngTemplateOutlet]="label"
                          [ngTemplateOutletContext]="{ product }"
                        />
                      </div>

                      <!--
                      The Add affordance, inside the same button rather than a nested one.

                      It reads as a large button because it is the bottom third of a card that *is* a
                      button — so the whole card stays one target and one tab stop. A real nested
                      button would be invalid here and would double the tab stops for no gain, since
                      it would do exactly what the card already does.
                    -->
                      @if (product.isAvailable) {
                        <span
                          class="pb-gradient-brand flex min-h-12 shrink-0 items-center justify-center gap-pb-1"
                          aria-hidden="true"
                        >
                          <mat-icon class="!h-5 !w-5 !text-[20px]">add</mat-icon>
                          <span class="text-sm font-semibold">Add</span>
                        </span>
                      } @else {
                        <span
                          class="flex min-h-12 shrink-0 items-center justify-center border-t border-pb-border bg-pb-neutral-surface text-sm font-semibold text-pb-danger-fg"
                        >
                          Sold out
                        </span>
                      }
                    </button>
                  }
                }
              </div>
            </div>

            <!--
              One definition of the photo and one of the label, shared by both card shapes, so the two
              cannot drift apart in a way that only shows up once something is in the cart.
            -->
            <ng-template #media let-product="product">
              @if (product.imageUrl !== null) {
                <!--
                  alt is empty on purpose. The product name is printed on this same card, so naming
                  the photo too makes a screen reader announce it twice; an empty alt marks it
                  decorative and the label still reads once.
                -->
                <img
                  [src]="product.imageUrl"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  class="aspect-square w-full object-cover"
                />
              } @else {
                <!-- Same box as a photo, so a card without one looks intended rather than
                     half-loaded next to its neighbours. -->
                <span
                  class="flex aspect-square w-full items-center justify-center bg-pos-pink/40 text-5xl"
                  aria-hidden="true"
                >
                  {{ fallbackIcon(product) }}
                </span>
              }
            </ng-template>

            <ng-template #label let-product="product">
              <span class="line-clamp-2 text-sm font-semibold leading-snug">
                {{ product.name }}
              </span>
              <span
                class="mt-auto text-lg font-bold leading-none tracking-[-0.01em] text-pos-brown"
              >
                {{ fmt(product.price) }}
              </span>
            </ng-template>
          }
        }
      </section>

      <!-- ==================== CART: TABLET AND DESKTOP ==================== -->
      @if (!isCompact()) {
        <!--
          Narrower on a tablet than on a desktop, and that is the point.

          A flat 22rem cart left 280px for the product grid at 768px. The cart earns its width
          back as the screen provides it, rather than taking a desktop share of a tablet.

          The steps are at xl and 2xl rather than lg and xl because the sidebar is still a 72px
          rail at 1024px: widening the cart there took the room the grid had just gained and cost
          it a whole column, so 1024px showed fewer products than 900px did.
        -->
        <aside
          class="pos-light-surface sticky top-pb-3 max-h-[calc(100dvh-6rem)] w-[17rem] shrink-0 overflow-hidden rounded-pb-xl border border-pos-gold/40 bg-pos-vanilla text-pos-brown shadow-pb-md xl:w-[21rem] 2xl:w-[26rem]"
        >
          <pb-pos-cart-panel class="h-full" [saving]="saving()" (checkout)="openPayment()" />
        </aside>
      }
    </div>

    <!-- ==================== CART: MOBILE ==================== -->
    @if (isCompact()) {
      <!--
        Sticky summary and the floating cart button.

        On a phone the product grid is the whole screen, so the running total and the way into
        the cart have to be permanently in reach rather than a menu's worth of scrolling away —
        this is the one screen where that distance costs a queue.
      -->
      @if (!cart.isEmpty()) {
        <!--
          A floating pill, not a flush bar.

          Inset and rounded so it reads as a control hovering over the grid rather than as the
          bottom of the page — which matters because it *is* a control, and a full-bleed bar at the
          screen edge reads as chrome and gets ignored. It also leaves the last row of cards visible
          either side of it instead of behind an opaque band.

          The whole pill is one button. On a phone the target is the thing being aimed at with a
          thumb while holding a waffle, and splitting it into "a total you cannot press" and "a
          button you can" wastes the 200px the total occupies.
        -->
        <div
          class="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-pb-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <button
            type="button"
            class="pos-light-surface pb-gradient-brand pointer-events-auto pb-pop flex min-h-16 w-full max-w-md cursor-pointer appearance-none items-center gap-pb-3 rounded-pb-full border-0 px-pb-4 text-left font-[inherit] !shadow-pb-lg active:scale-[0.98] motion-reduce:transition-none"
            (click)="openCart()"
          >
            <span
              class="relative grid h-11 w-11 shrink-0 place-items-center rounded-pb-full bg-white/15"
              aria-hidden="true"
            >
              <mat-icon>shopping_cart</mat-icon>
              <span
                class="absolute -right-1 -top-1 grid h-6 min-w-6 place-items-center rounded-pb-full bg-pos-gold px-1 text-xs font-bold text-pos-brown"
              >
                {{ cart.itemCount() }}
              </span>
            </span>

            <span class="min-w-0 flex-1">
              <span class="block text-xs uppercase tracking-wide opacity-75">View cart</span>
              <span class="block text-xl font-bold tabular-nums">
                {{ fmt(cart.grandTotal()) }}
              </span>
            </span>

            <mat-icon class="shrink-0" aria-hidden="true">expand_less</mat-icon>
          </button>
        </div>

        <!-- Clears the bar so the last row of cards is never hidden behind it. -->
        <div class="h-24" aria-hidden="true"></div>
      }

      <!--
        The slide-up cart.

        Kept mounted rather than created on open so the transform animates and the panel is
        instant on the first tap — building an overlay on demand is the thing that makes a web
        POS feel like a web page. Hiding it with visibility, not just opacity, is what keeps a
        closed sheet out of the tab order.
      -->
      <div
        class="fixed inset-0 z-30"
        [class.pointer-events-none]="!cartOpen()"
        [class.invisible]="!cartOpen()"
      >
        <!--
          Tap-outside-to-dismiss, as a real button.

          A div with a click handler is unreachable by keyboard, and giving it a tabindex would
          put an unlabelled full-screen control in the tab order. A button is keyboard-operable
          for free, and hiding it from assistive tech avoids a third "Close the cart" alongside
          the grab handle and the panel's own close button — Escape covers the keyboard path.
        -->
        <button
          type="button"
          tabindex="-1"
          aria-hidden="true"
          class="absolute inset-0 w-full cursor-default appearance-none border-0 bg-pb-scrim backdrop-blur-sm transition-opacity duration-pb-base"
          [class.opacity-0]="!cartOpen()"
          (click)="closeCart()"
        ></button>

        <div
          class="pos-light-surface absolute inset-x-0 bottom-0 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-3xl border-t border-pos-gold/40 bg-pos-vanilla text-pos-brown shadow-pb-lg transition-transform duration-pb-base ease-pb-out motion-reduce:transition-none"
          [class.translate-y-full]="!cartOpen()"
          role="dialog"
          aria-modal="true"
          aria-label="Cart"
        >
          <!-- A grab handle: the affordance people expect on a sheet, and a wide tap target
               for closing it. -->
          <button
            type="button"
            class="flex min-h-12 w-full shrink-0 cursor-pointer appearance-none items-center justify-center border-0 bg-transparent"
            aria-label="Close the cart"
            (click)="closeCart()"
          >
            <span class="h-1.5 w-12 rounded-full bg-pos-brown/30"></span>
          </button>

          <pb-pos-cart-panel
            class="min-h-0 flex-1 pb-[env(safe-area-inset-bottom)]"
            [saving]="saving()"
            [dismissable]="true"
            (checkout)="openPayment()"
            (dismiss)="closeCart()"
          />
        </div>
      </div>
    }
  `,
})
export class NewOrderPage implements OnInit {
  protected readonly cart = inject(PosCartStore);
  private readonly service = inject(PosService);
  private readonly cache = inject(PosMenuCacheService);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly router = inject(Router);
  private readonly breakpoints = inject(BreakpointObserver);

  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');

  protected readonly allTab = 'all';

  protected readonly online = inject(OnlineStatusService).online;

  /** True on a phone, where the cart is a sheet rather than a column. */
  protected readonly isCompact = toSignal(
    this.breakpoints.observe(COMPACT_QUERY).pipe(map((state) => state.matches)),
    { initialValue: window.matchMedia(COMPACT_QUERY).matches },
  );

  protected readonly menu = signal<readonly MenuCategory[]>([]);
  protected readonly loading = signal(true);
  /** The message from a failed menu load, or `null`. Drives the retry state. */
  protected readonly menuError = signal<string | null>(null);

  /**
   * When the menu on screen was last confirmed by the API, or `null` while it is live.
   *
   * Non-null means the grid is being drawn from `PosMenuCacheService` — the cashier is looking at
   * the last menu this browser saw, not at what the server says now. The banner keyed on this is
   * the whole reason caching the menu is honest rather than merely convenient.
   */
  protected readonly menuFromCacheAt = signal<Date | null>(null);
  protected readonly saving = signal(false);
  /** The message from a failed order submission, shown inside the payment sheet. */
  protected readonly submitError = signal<string | null>(null);

  /**
   * The saved order, handed to the payment sheet so it can confirm it before closing itself.
   *
   * Held on the page rather than passed at open time because the sheet is opened *before* the order
   * exists. Cleared when the sheet closes, so the next order opens on the payment step rather than
   * on the previous customer's receipt.
   */
  protected readonly submitted = signal<PaymentSheetSuccess | null>(null);
  protected readonly search = signal('');
  protected readonly category = signal<string>('all');
  protected readonly cartOpen = signal(false);

  /**
   * The idempotency key for the order currently being attempted.
   *
   * Generated on the first submit and **held across every retry of that order**, which is the
   * whole point: if the server saved the order and the reply was lost, the retry carries the same
   * key and comes back with the original rather than creating a second one.
   *
   * Cleared only on success, or when the cashier explicitly empties the cart. Clearing it any
   * earlier — on a failed attempt, say — would hand the next tap a fresh key and reintroduce the
   * double charge. Holding it *longer* is the other failure: a stale key would make the next
   * customer's order return the previous one, so an explicit Clear must drop it.
   */
  private attemptKey: string | null = null;

  constructor() {
    /*
     * A cart emptied while the sheet is open closes it.
     *
     * Otherwise the cashier is left looking at "Tap a product to start" inside a modal, with the
     * products behind it unreachable.
     */
    effect(() => {
      if (this.cart.isEmpty() && this.cartOpen()) {
        this.cartOpen.set(false);
      }
    });

    /*
     * An emptied cart also abandons the attempt.
     *
     * Reusing the key for the next customer would make the server answer with the previous
     * order, silently recording one sale where there were two.
     */
    effect(() => {
      if (this.cart.isEmpty()) {
        this.attemptKey = null;
      }
    });

    // A sheet left open across a rotate into tablet width would sit on top of the column cart.
    effect(() => {
      if (!this.isCompact() && this.cartOpen()) {
        this.cartOpen.set(false);
      }
    });
  }

  /**
   * Warms the UPI QR into cache while the cashier is still tapping products.
   *
   * The QR must be on screen the instant the payment sheet opens — a customer is standing
   * there — but it is 60 kB that most orders never need, since cash does not show it. Fetching
   * it here costs nothing on the critical path and keeps it out of the JS bundle.
   *
   * Deliberately silent: a failed preload is not an error worth telling anyone about, because
   * the sheet will simply fetch the image itself.
   */
  private preloadUpiQr(): void {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = UPI_QR_SRC;
    document.head.appendChild(link);
  }

  ngOnInit(): void {
    this.preloadUpiQr();
    this.loadMenu();
  }

  /**
   * Fetches the menu, or records why it could not be fetched.
   *
   * Public because the retry button calls it — the same path, so a recovery is not a second
   * code path that can rot separately from the first.
   *
   * Sold-out items are fetched and shown greyed out rather than hidden: a customer asking for
   * one needs to be told it has gone, and an item silently missing from the grid looks like the
   * POS is broken.
   */
  protected loadMenu(): void {
    /*
     * The cache is painted first, and that is the whole point of this screen's boot.
     *
     * The API sleeps after fifteen idle minutes and takes about a minute to come back (see
     * `ApiWakeService`). Waiting for it meant a spinner between the cashier and the customer for
     * that whole minute. Now the last known menu is on screen in the time it takes to read
     * localStorage, the cart works — it is local — and the fetch below quietly replaces the grid
     * when the server answers.
     *
     * `loading` is only true when there is nothing to show. A spinner over a usable screen is a
     * spinner that stops the person using it.
     */
    const cached = this.cache.read();

    if (cached !== null && this.menu().length === 0) {
      this.applyMenu(cached.menu);
      this.menuFromCacheAt.set(cached.savedAt);
      this.loading.set(false);
    } else {
      this.loading.set(this.menu().length === 0);
    }

    this.menuError.set(null);

    this.service.menu(true).subscribe({
      next: (menu) => {
        this.cache.write(menu);
        this.menuFromCacheAt.set(null);
        this.applyMenu(menu);

        this.loading.set(false);
        this.focusSearch();
      },
      error: (error: AppError) => {
        this.loading.set(false);

        /*
         * A failed refresh over a usable cached menu is not an error state.
         *
         * Replacing a working order screen with "Could not load the menu" because the *second*
         * fetch failed would take the counter offline to report that it is offline. The banner
         * already says the menu is from cache; the error panel is for having nothing to show.
         */
        if (this.menu().length === 0) {
          this.menuError.set(error.message);
        }
      },
    });
  }

  /**
   * "your last session" rather than a timestamp nobody can parse mid-order.
   *
   * Rounded hard on purpose: the cashier needs to know whether this is minutes old or days old, and
   * "1h 42m ago" invites arithmetic at a counter with a queue.
   */
  protected syncedLabel(savedAt: Date): string {
    const minutes = Math.round((Date.now() - savedAt.getTime()) / 60_000);

    if (minutes < 60) {
      return 'a few minutes ago';
    }

    const hours = Math.round(minutes / 60);

    return hours < 24 ? `${String(hours)} hour${hours === 1 ? '' : 's'} ago` : 'your last session';
  }

  /**
   * Puts a menu on screen, wherever it came from.
   *
   * Also hands the cart a way to look up a product's tier: the combo preview needs it and the cart
   * deliberately does not hold the catalogue, so this is the one place that knows both. Built once
   * per load rather than per keystroke.
   */
  private applyMenu(menu: readonly MenuCategory[]): void {
    this.menu.set(menu);

    const tierByProduct = new Map<string, string>();
    for (const category of menu) {
      for (const product of category.products) {
        tierByProduct.set(product.id, category.name);
      }
    }
    this.cart.setCategoryResolver((productId) => tierByProduct.get(productId));
  }

  /**
   * What the grid shows.
   *
   * A search overrides the category tab rather than filtering within it — someone typing
   * "nutella" wants the item, and making them find the right tab first would be a step for
   * nothing.
   */
  /** For the "All" chip's count, so every chip carries the same information as the others. */
  protected readonly totalProductCount = computed(() =>
    this.menu().reduce((sum, category) => sum + category.products.length, 0),
  );

  /**
   * Which products are waffles, and the box to charge for. Both derived from the loaded menu.
   *
   * Computed rather than resolved once in the load callback so they stay correct if the menu is
   * refetched — a retry after a failed load, or an availability change. See `waffle-packaging.ts`
   * for why these are matched by name.
   */
  private readonly waffleIds = computed(() => waffleProductIds(this.menu()));
  private readonly packagingProduct = computed(() => findPackagingProduct(this.menu()));

  protected readonly visibleProducts = computed<readonly Product[]>(() => {
    const term = this.search().trim().toLowerCase();
    const categories = this.menu();

    const pool =
      term.length > 0 || this.category() === 'all'
        ? categories.flatMap((category) => category.products)
        : (categories.find((category) => category.id === this.category())?.products ?? []);

    if (term.length === 0) {
      return pool;
    }

    return pool.filter((product) => product.name.toLowerCase().includes(term));
  });

  /**
   * Each product's category emoji, for the card that has no photo yet.
   *
   * `visibleProducts` deliberately flattens to a `Product[]` so the grid can mix categories under
   * search and the All chip, which loses the category the product came from — hence a lookup rather
   * than reading it off the row.
   *
   * This used to be a hardcoded 🍫 in the template. That was invisible while every category was
   * chocolate or waffle, and wrong the moment it was not: a ₹10 takeaway packaging charge rendered
   * as a bar of chocolate. `menu-master.ts` already documents the fallback as *the category emoji*,
   * so the template was the thing disagreeing with the intent.
   */
  private readonly categoryIconByProduct = computed(() => {
    const map = new Map<string, string>();

    for (const category of this.menu()) {
      for (const product of category.products) {
        if (category.icon !== null && category.icon.length > 0) {
          map.set(product.id, category.icon);
        }
      }
    }

    return map;
  });

  /** 🍫 remains the last resort, for a category that never set an icon. */
  protected fallbackIcon(product: Product): string {
    return this.categoryIconByProduct().get(product.id) ?? '🍫';
  }

  protected fmt(value: number): string {
    return money(value);
  }

  /**
   * A category chip.
   *
   * `min-h-12` rather than padding alone: 48px is the floor for a thumb, and these are the
   * most-tapped control on the screen after the cards themselves.
   *
   * The selected chip takes the brand gradient — the same surface as the Add bar and the charge
   * button, so "this is the thing acting right now" looks the same everywhere on the screen. An
   * unselected chip is a hairline outline that warms on hover; it never gets a fill, because a row
   * of eight filled chips has no selected state left to show.
   */
  protected tabClass(id: string): string {
    const base =
      'flex min-h-12 shrink-0 cursor-pointer appearance-none items-center gap-pb-2 rounded-pb-full px-pb-4 text-sm font-semibold transition-[background-color,border-color,box-shadow,transform] duration-pb-fast ease-pb-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100';

    return this.isSelected(id)
      ? `${base} pb-gradient-brand border border-transparent`
      : `${base} pos-light-surface border border-pos-gold/50 bg-pos-vanilla text-pos-brown hover:border-pos-gold hover:bg-pos-gold/10`;
  }

  /**
   * The count pill inside a chip.
   *
   * On the selected chip it needs its own translucent plate: a bare number in vanilla ink on the
   * gradient is legible but reads as part of the label, and the count is a different kind of fact
   * from the name. Unselected, an opacity shift is enough.
   */
  protected countClass(id: string): string {
    const base = 'grid min-w-5 place-items-center rounded-pb-full px-1 text-xs tabular-nums';

    return this.isSelected(id)
      ? `${base} bg-white/20 text-inherit`
      : `${base} bg-pos-brown/8 text-pos-brown/70`;
  }

  /** A search overrides the tab highlight, matching what the grid is actually showing. */
  private isSelected(id: string): boolean {
    return this.category() === id && this.search().length === 0;
  }

  /**
   * The card's own frame, shared by both shapes.
   *
   * `overflow-hidden` is what lets the Add bar and the stepper sit flush against the rounded bottom
   * edge instead of being inset by the card's padding — the padding moved onto the body so the
   * footer can reach the corners.
   *
   * `inCart` gets the gold border at full strength rather than 40%: on a counter screen of sixteen
   * cards, which ones are already on the order has to be answerable at a glance from across the
   * counter, and the stepper alone is too small to carry that from a metre away.
   */
  /**
   * The card's own frame, shared by both shapes.
   *
   * `overflow-hidden` is what lets the photo, the Add bar and the stepper sit flush against the
   * rounded edges instead of being inset by the card's padding — the padding moved onto the body so
   * the photo can reach the top corners and the footer the bottom ones.
   *
   * ## Three states, three signals
   *
   * **At rest** a hairline and a barely-there shadow: a white card on a white counter screen needs
   * an edge, and the shadow is what stops sixteen of them reading as a grid drawn on the page.
   *
   * **Hover lifts 2px** and deepens the shadow. Not 6px — a card that leaps under the pointer looks
   * cheap, and on a grid of sixteen the whole page twitches as the cursor crosses it. The lift is
   * pointer-only in practice: a touch device has no hover, which is why press is animated
   * separately.
   *
   * **In the cart** takes the gold border at full strength, a warm gradient wash and a permanent
   * shadow. Three signals for one state, because on a counter screen at a metre "what is already on
   * this order" has to be answerable in one sweep — and the badge, which is the fourth, is the only
   * one that survives being read across a room.
   *
   * `active:scale` on every state including sold-out: pressing something that does nothing should
   * still feel like a press, or the screen reads as frozen.
   */
  protected cardClass(product: Product, inCart: boolean): string {
    // Tailwind preflight is not loaded, so a bare <button> keeps the browser's border and
    // grey face — these reset it, the same way the data-table cards do.
    const base =
      'pos-light-surface group relative flex cursor-pointer appearance-none flex-col overflow-hidden rounded-pb-xl border p-0 text-left font-[inherit] text-pos-brown transition-[transform,box-shadow,border-color] duration-pb-fast ease-pb-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100';

    if (!product.isAvailable) {
      return `${base} border-pb-border bg-pos-vanilla opacity-60`;
    }

    return inCart
      ? `${base} pb-gradient-selected border-pos-gold shadow-pb-sm`
      : `${base} border-pb-border bg-pos-vanilla shadow-pb-xs hover:-translate-y-0.5 hover:border-pos-gold hover:shadow-pb-md motion-reduce:hover:translate-y-0`;
  }

  protected onSearch(value: string): void {
    this.search.set(value);
  }

  protected clearSearch(): void {
    this.search.set('');
    this.focusSearch();
  }

  protected selectCategory(id: string): void {
    this.category.set(id);
    this.search.set('');
  }

  /**
   * Adds a product, and asks about a box when it is a waffle.
   *
   * The waffle goes in **before** the prompt opens, deliberately. The cashier tapped a product and
   * the cart must show it immediately; making the line wait on an answer would mean a visible pause
   * between the tap and the total, on the one screen where that is least acceptable. Declining the
   * box then changes nothing rather than undoing something.
   *
   * `void`-returning despite awaiting, because it is a template handler — a click has nobody to
   * return a promise to. Rejections cannot escape: `ask` resolves rather than throws on dismissal.
   */
  protected async add(product: Product): Promise<void> {
    if (!product.isAvailable) {
      return;
    }

    this.cart.add(product);

    await this.offerPackaging(product);
  }

  /**
   * Enter adds the first match and clears the box.
   *
   * The keyboard path for a counter with one: three letters, Enter, repeat. No pointer at all.
   *
   * Routed through `add` rather than calling `cart.add` directly, so the keyboard path gets the
   * packaging prompt too. It had its own call to the store before, which is exactly how a rule ends
   * up applying on one of two routes into the same action.
   */
  protected async addTopMatch(): Promise<void> {
    const first = this.visibleProducts().find((product) => product.isAvailable);

    if (first === undefined) {
      return;
    }

    this.search.set('');
    this.focusSearch();

    await this.add(first);
  }

  /**
   * Asks whether a waffle is being taken away, and charges for the box if it is.
   *
   * Asked per waffle added, so three waffles is three questions and three boxes — which is the
   * honest model: two friends eating in and one order to go is one box, not three, and nothing
   * cheaper than asking can tell those apart.
   *
   * Silent — no prompt at all — when the product is not a waffle, or when the packaging product is
   * missing or sold out. See `findPackagingProduct` for why availability decides this here.
   *
   * A dismissed dialog counts as "eating in". `ConfirmDialogService` resolves Escape and a backdrop
   * click to `false`, and declining is the answer that adds nothing, so an accidental dismissal
   * leaves the cart exactly as the tap left it rather than charging for a box nobody asked for.
   */
  private async offerPackaging(product: Product): Promise<void> {
    if (!this.waffleIds().has(product.id)) {
      return;
    }

    const packaging = this.packagingProduct();

    if (packaging === null) {
      return;
    }

    const wantsBox = await this.confirm.ask({
      title: 'Packing this waffle?',
      message: `${product.name} — is it going in a box to take away?`,
      detail: `Adds ${money(packaging.price)} for ${packaging.name}.`,
      confirmLabel: 'Yes, pack it',
      cancelLabel: 'No, eating in',
      icon: 'takeout_dining',
    });

    if (wantsBox) {
      this.cart.add(packaging);
    }
  }

  protected openCart(): void {
    this.cartOpen.set(true);
  }

  protected closeCart(): void {
    if (this.saving()) {
      return;
    }

    this.cartOpen.set(false);
  }

  /**
   * Opens the payment sheet.
   *
   * The sheet stays open for the whole save and reports the outcome itself, so the page passes
   * its own state in and keeps the reference to close it on success. `disableClose` matters more
   * than usual here: a backdrop tap mid-request would leave the cashier with no idea whether the
   * order was taken.
   */
  protected openPayment(): void {
    this.submitError.set(null);
    this.submitted.set(null);

    const ref = this.dialog.open<PaymentSheetComponent, unknown, undefined>(PaymentSheetComponent, {
      data: {
        total: this.cart.grandTotal(),
        itemCount: this.cart.itemCount(),
        saving: this.saving,
        error: this.submitError,
        success: this.submitted,
        confirm: (result: PaymentSheetResult) => this.submit(result),
      },
      width: '520px',
      maxWidth: '96vw',
      disableClose: true,
    });

    /*
     * No reference is kept.
     *
     * The page used to hold one so it could close the sheet on success; the sheet now closes itself
     * once its confirmation has been up long enough to read, and there is no other path on which
     * this page closes it — a failure deliberately leaves it open so the retry keeps the method and
     * reference already keyed.
     */
    ref.afterClosed().subscribe(() => {
      this.submitError.set(null);
      this.submitted.set(null);
    });
  }

  private submit(payment: PaymentSheetResult): void {
    if (this.saving()) {
      return;
    }

    this.saving.set(true);
    this.submitError.set(null);

    // Generated once per order and reused by every retry of it — see `attemptKey`.
    this.attemptKey ??= crypto.randomUUID();

    const discountAmount = this.cart.discountAmount();

    this.service
      .place(
        {
          lines: this.cart.toRequestLines(),
          discountType: this.cart.discountType(),
          discountValue: this.cart.discountValue(),
          ...(discountAmount > 0 ? { discountReason: this.cart.discountReason().trim() } : {}),
          ...(this.cart.notes().trim().length === 0 ? {} : { notes: this.cart.notes().trim() }),
          customer: this.cart.customerPayload(),
          // Straight through from the sheet: it already resolved a single method into a split of
          // one, so this page has no branch for how the customer paid. The server re-checks that
          // the amounts add up to its own total — see `checkTenders`.
          payments: payment.payments,
        },
        this.attemptKey,
      )
      .subscribe({
        next: (order) => {
          this.saving.set(false);
          this.attemptKey = null;

          /*
           * The sheet is told the order landed and closes itself two seconds later, rather than
           * being closed here the instant the response arrives.
           *
           * Everything else happens now, exactly as before — the cart resets, the search clears,
           * focus returns — so the counter is ready for the next customer while the confirmation is
           * still on screen. The dwell delays only the panel, never the till.
           */
          this.submitted.set({ orderNumber: order.orderNumber, grandTotal: order.grandTotal });
          this.cartOpen.set(false);

          // Reset, then back to the search box. There is no "new order" step — the next
          // customer is already at the counter.
          this.cart.reset();
          this.search.set('');
          this.focusSearch();

          /*
           * No success toast.
           *
           * The sheet's own panel now carries the order number and the amount for two seconds,
           * which is the same information in the place the cashier is already looking. Firing a
           * snackbar as well put it on screen twice — and the snackbar is the worse of the two:
           * it appears at the bottom edge, behind the payment sheet that is still open, and it
           * carries a Dismiss action, so the confirmation for every order in the day was one more
           * thing to tap or ignore.
           *
           * Failures still surface, inside the sheet, exactly as before.
           */
        },
        error: (error: AppError) => {
          this.saving.set(false);

          /*
           * Reported into the sheet, which is still open, rather than as a toast.
           *
           * `attemptKey` is deliberately *not* cleared: the retry has to carry the same key, or
           * an order the server did save behind a lost reply would be placed a second time.
           */
          this.submitError.set(error.message);
        },
      });
  }

  protected leave(): void {
    void this.router.navigate(['/pos']);
  }

  private focusSearch(): void {
    /*
     * Only where there is a keyboard.
     *
     * Focusing the search box on a phone opens the on-screen keyboard over the product grid,
     * which is the opposite of useful when the next action is tapping a card.
     */
    if (this.isCompact()) {
      return;
    }

    // A microtask, so the input exists after the branch that renders it commits.
    queueMicrotask(() => this.searchBox()?.nativeElement.focus());
  }
}
