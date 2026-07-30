# Point of sale

Walk-in orders taken at the counter. Built for one number: a customer served in ten to
fifteen seconds.

---

## A product catalogue had to come first

The spec said "load from Product Management". No such module existed. `inventory_items` holds
**ingredients** — Dark Chocolate, Dessert Bowl, Whipping Cream — while the POS sells
**finished goods**: a Death By Chocolate bowl at ₹149. Those are different things and nothing
in the system held the second.

So `ProductCategory` and `Product` are new, and the menu is seeded from
`prisma/menu-master.ts` — the four categories and sixteen products exactly as specified.
`npm run prisma:seed:menu` is idempotent: it refreshes prices and ordering, never deletes
(order lines reference products with `RESTRICT`), and never re-enables something the counter
has marked sold out.

Four waffles share a name with a bowl. Product names are unique across the menu, so those
carry a `Waffle` suffix — a card reading just "Death By Chocolate" in the waffle tab would be
indistinguishable from the ₹149 bowl on an order.

---

## What makes it fast

| Decision | Why |
|---|---|
| One request per order | The cart is built entirely in signals. Payment is attached to the create call, so the common path is **one** network round trip, not create-then-pay |
| No dialogs in the hot path | Tap a card to add. Quantity is `+`/`−` on the line. The only dialog is the payment sheet — the one moment the staff member genuinely stops to look at something |
| Search focused on arrival | Type three letters, press Enter, the top match is added. A keyboard counter never touches the screen |
| Self-resetting | After saving, the cart clears and focus returns to search. There is no "new order" step — the next customer is already there |
| Quantity badge on the card | The feedback for "did that tap register", without looking at the cart |
| Sold-out items shown, greyed | A customer asking for one needs to be told it has gone. An item silently missing looks like a broken POS |

A scripted run of the full flow — three taps, charge, method, confirm — completes in **4.4
seconds**, leaving the rest of the budget for the human.

---

## The money is the server's

Nothing about a total is trusted from the browser.

**The request carries product ids and quantities. No prices.** Every line is priced from the
live product row, and the name and price are **snapshotted onto the order line**, so
repricing the menu next month cannot rewrite what a customer was charged tonight. Sending
`unitPrice: 1` alongside a ₹149 bowl was verified to charge ₹149.

**Totals are computed in the domain** (`computeTotals`), and the discount is clamped to the
subtotal — a ₹500 flat discount on a ₹300 order would otherwise produce a negative grand
total that every downstream sum quietly absorbs.

**An order is only paid if a payment came with it.** The client cannot assert `PAID`, so
unbacked revenue cannot reach the day's figures.

---

## Discounts

Flat or percentage, and a **reason is always required** — a reduction with no stated cause is
indistinguishable from a staff member undercharging a friend.

A Store Manager may give up to **20%**; an admin is unlimited. The check runs against the
*effective* percentage, which is the part that matters: "₹200 off" on a ₹250 order is an 80%
discount however it was keyed in, and a cap that only inspected percentage discounts would be
bypassed by typing the same reduction as a flat figure. Verified — a flat ₹250 on a ₹298 order
is refused as 83.89%.

The cart disables the charge button and explains before the round trip. That is a courtesy;
the server is what enforces it.

---

## Order numbers

`PB-20260728-0001`, restarting at 1 each day so staff can call out "order forty-two".

Allocated from an `order_sequences` row per day, upserted-and-incremented **inside the order
transaction**. The obvious alternative —
`SELECT count(*) + 1 FROM sales_orders WHERE created_at::date = today` — hands the same number
to two tills taking an order in the same instant, and the unique index then rejects one of
them with a customer waiting.

Ten orders fired together produced ten unique, gapless numbers.

> **Caveat worth knowing:** development runs against PGlite with `DATABASE_POOL_MAX=1`, so
> those ten requests serialised at the connection pool. The test proves the counter increments
> correctly; it does **not** exercise the true race. Point `DATABASE_URL` at a real Postgres
> to test that path.

---

## Payment

Cash, UPI, Card. **No gateway.**

Cash and Card confirm in one tap. UPI shows a static QR — rendered inline as an SVG data URI,
because the cart runs on mobile data and the QR is the one thing that must never fail to
appear — and then waits for a person to say the money arrived.

The confirm button is worded **"Payment received"**, as an assertion rather than a status,
because a human assertion is all it records. `confirmedById` is who said so.

`Payment` is its own table rather than columns on the order, so a split payment — half cash,
half UPI — is rows rather than a migration. The order settles when the payments cover the
total, computed from the rows, so a split settles on the last part and not the first.

---

## Roles

| | Admin | Store Manager |
|---|---|---|
| Take orders, receive payment | yes | yes |
| See orders | **all, every day** | **own, today only** |
| Cancel an order | yes | **no** |
| Discount above 20% | yes | no |

`POS_OPERATE` is the counter, and an admin holds it too — on a bad evening they will be the
one serving.

**Read scoping is enforced in the use case, not by a second endpoint.** One `GET /pos/orders`
serves both roles; the restriction is applied over whatever filter arrived, so no combination
of query parameters escapes it. A Store Manager requesting another user's order gets **404,
not 403** — the two are deliberately indistinguishable, because a 403 on a real id and a 404
on a fake one together let anyone enumerate which orders exist.

Cancelling keeps the payment rows. A refunded order and an order that never took money must
be distinguishable when the cash is counted; the status is what excludes it from revenue.

---

## REST API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/pos/menu` | Whole menu, one request. `includeUnavailable=true` for the counter |
| `GET` | `/api/v1/pos/summary` | Today's figures, scoped. Carries `scope: all \| own` |
| `GET` | `/api/v1/pos/orders` | Paginated. `search`, `fromDate`, `toDate`, `status`, `paymentMethod`, sorting |
| `GET` | `/api/v1/pos/orders/:id` | Full order |
| `POST` | `/api/v1/pos/orders` | Places it, payment optional |
| `POST` | `/api/v1/pos/orders/:id/payment` | Confirms money received. Amount is not a parameter — it is what the order owes |
| `POST` | `/api/v1/pos/orders/:id/cancel` | Admin only, reason required |
| `PATCH` | `/api/v1/pos/products/:id/availability` | The sold-out toggle |

Search reaches the **line snapshots**, so searching "Nutella" still finds an order placed
before that product was renamed.

---

## What this does NOT do

Excluded on purpose, as specified — and none of it is stubbed or half-wired:

no invoice or receipt generation, no PDF, no printing, **no inventory deduction, no recipe
deduction**, no forecasting, no supplier or purchase integration, and no analytics
calculations.

POS orders **are** now wired into the dashboard, reports and analytics — see
[Declared versus counter](#declared-versus-counter) below for the rule that keeps them from
double-counting.

---

## Photography and the QR

Real product photos and the store's real UPI QR, added after the module was built.

### Where the files live

| | |
|---|---|
| `frontend/public/products/*.jpg` | 13 photos, 400 px, **644 kB total** — what the app serves |
| `frontend/public/upi-qr.jpg` | the payment QR, cropped to its quiet zone |
| `design-assets/` | the untouched originals, **19 MB** — never served, never built |

The originals arrived as 1254x1254 PNGs at ~2.3 MB each for a slot rendered 64 px tall, in a
mix of `.PNG`, `.JPG` and `.jpg`. Both were problems worth fixing before wiring anything up:
`public/` is copied wholesale into the bundle, so every deploy would have shipped 19 MB to a
counter on mobile data; and macOS serves `.JPG` for a path spelled `.jpg` while Linux does not,
so a working development path would have 404'd in production.

Transcoding to lower-case JPEG at 400 px cut it **30x** with no visible loss at card size.
Filenames are the hyphenated product name, so the next photo's name needs no lookup table.

### 13 of 16, on purpose

Tiramisu Indulgence and both combos have no photo, and the card falls back to the category
emoji in a tinted tile the same size as a photo — so a partly photographed menu reads as
deliberate rather than half-loaded. `imageUrl` is written as `?? null`, never left
`undefined`, so removing a photo from `menu-master.ts` actually clears the path instead of
stranding one that points at a deleted file.

`npm run prisma:seed:menu` **refuses to run** if a listed photo is missing from
`frontend/public`. The seed is the last cheap moment to catch a typo; after it, the same
mistake is a broken card at the counter mid-shift. The check is skipped when the frontend is
not checked out beside the backend, since the API deploys on its own.

The photo carries `alt=""`. The product name is already printed on the card, so naming the
image too makes a screen reader announce it twice.

### The QR had to be verified, not eyeballed

The QR is cropped from the printed IDFC card down to the code and its quiet zone, with the
bank header dropped and the UPI ID re-rendered as **text** — the printed version is a small
serif face that turns to mush at card size, and as text it stays legible and lets a customer
whose camera will not focus type `parisbites2@idfcbank` in by hand.

**My first crop looked perfect and decoded to nothing.** The card's printed border sat exactly
where the quiet zone belonged, so there was no white margin outside the code. Nothing about the
image looked wrong; it simply would not scan. The fix was to measure the black rules (rows
518-522 and 1067-1072) and the code's own corners, then crop inside both.

It is now verified by *decoding*, twice over: from the file at every width the sheet might
render it, and from a screenshot of the **live rendered element** at 1x, 2x and 3x device pixel
ratios — the actual pixels a customer's camera meets. All decode to
`upi://pay?...pa=parisbites2@idfcbank`.

> **Re-cropping this image without re-running that check is a way to break payments silently.**
> A QR that fails to scan looks exactly like a QR that works.

Resampling is not monotonic, either: the uncropped card decoded at 120 px and 160 px but *not*
at 140 px. That is why the displayed size is fixed at 240 px rather than left to fill its box,
and why the image is not squeezed into a square — a stretched QR is a QR that might not scan.

### Kept out of the JS bundle

The QR is a static asset, not a base64 data URI. Inlined it would add ~80 kB to the POS chunk
on every visit, including the majority of orders paid in cash that never open it. The order
page issues a `<link rel="preload">` for it on load instead, so the bytes are cached long
before anyone reaches the payment sheet — which keeps the original guarantee that the QR never
waits on the network, without charging every order for it.

---

## Reused, not rebuilt

Authentication, the app shell, guards, interceptors, the error envelope, `pb-data-table`,
`pb-page-header`, `pb-card`, `pb-search-box`, `pb-spinner`, `pb-empty-state`,
`*pbHasPermission`, the shared formatters and the audit log are all existing infrastructure.

The existing `SalesChannel` enum is reused rather than duplicated, so Zomato, Swiggy and any
future channel are a value in one place — every order carries `channel`, defaulted to
`WALK_IN`, and the queries already filter on it.

New only: the POS palette (chocolate `#3B2416`, gold `#C89B5B`, pink `#F7D6E4`, vanilla
`#FFF8F2`), added as its own Tailwind block deliberately **outside** the Material token bridge
so it cannot repaint the rest of the app.

---

## Verified

177 backend tests (25 new on the money rules and the status machine) plus 29 browser checks:

- server-side pricing ignores a client-supplied price;
- discount ceiling holds against both percentage and flat entry;
- ten concurrent orders get ten unique numbers;
- unpaid order → pay in a second call → settled; paying twice is refused;
- role scoping (manager 14 orders, admin 15) and a 403 on cancel;
- the full order flow in 4.4s, cart self-resets, focus returns to search;
- keyboard-only add, UPI QR, 20% ceiling shown before submit;
- **zero WCAG 2.1 AA violations** on all three POS routes;
- no horizontal scroll at 820 px or 390 px, with a sticky mobile checkout bar so the total is
  never a menu's worth of scrolling away.

On the photos and the QR specifically:

- all 13 photos load and **decode** at desktop, tablet and phone widths — checked by reading
  each image's `naturalWidth`, since a broken image still occupies its box and reads as a
  styling bug rather than a missing file;
- every seeded path returns 200, and the old mixed-case paths return 404;
- the UPI QR decodes from a screenshot of the **live rendered element** at 1x, 2x and 3x DPR,
  not merely from the source file;
- the seed's missing-photo guard was exercised both ways: 0 missing against the real directory,
  13 against an empty one;
- zero WCAG violations after the markup change, on the grid and on the payment sheet.

All probe orders were deleted afterwards and the daily sequence reset, so the first real order
is `PB-…-0001`. The sixteen products remain — that menu is real data.


---

## The counter redesign

The flow was already fast — a scripted run measured 4.4 seconds. What follows is about the taps the
script did not measure, and about the three widths where the layout was quietly wrong.

### The product card carries the stepper now

The card used to be one button with a floating quantity badge in the corner. Adding was one tap;
**correcting a mis-tap was three interactions and a context switch** — open the cart, find the line,
press minus. On a counter that is where the ten-second budget actually goes, because a mis-tap is
common and the correction is not on screen.

So a card in the cart swaps its Add bar for a real stepper. The quantity and the two keys that change
it are one object, 48px each, where the cashier is already looking.

It has to be **two card shapes**, not one card with an overlaid stepper:

| State | Element | Why |
|---|---|---|
| Not in the cart | a single `button` | The whole 170px card is one target, and one tab stop per product for a keyboard counter |
| In the cart | an `article` with a body button + stepper | A `button` cannot contain a `button` — nesting is invalid and browsers recover from it unpredictably, which at a counter would look like a dead minus key |

The "Add" bar is a `span` inside the card button rather than a nested control. It reads as a large
button because it *is* the bottom third of one, so the card stays a single target and gains no tab
stop for a control that would do exactly what the card already does.

### Never one column, and it took three attempts

The grid is the part that was wrong at real widths, and both earlier fixes failed **silently**:

1. A viewport breakpoint ladder cannot see the 72–256px app sidebar or the cart column, so at 820px
   it divided 228px into three columns.
2. `repeat(auto-fill, minmax(9.5rem, 1fr))` asked the right question — but given less than twice the
   floor it answers **one**, and a one-column POS grid is a scrolling list rather than a menu.
3. Capping the floor with `min(9.5rem, 48%)` generated real CSS and still measured one track: a
   percentage inside the floor makes the track indefinite, so `auto-fill` stops counting.

It now asks its own container, the way the cart line already did. **Two columns is the floor at every
width** and it steps up as the container earns it. One more trap on the way: `@container` and the
`@min-*` variants cannot sit on the same element — a container query resolves against the nearest
*ancestor* container, so an element querying itself fails closed and cost the desktop a column before
it was measured.

Measured columns, with the app sidebar both collapsed and expanded:

| Width | Grid | Collapsed | Expanded |
|---|---|---|---|
| 390 | 358px | 2 × 171px | 2 × 171px |
| 820 | 412 / 228px | 2 × 198px | 2 × 106px |
| 1024 | 392 / 208px | 2 × 188px | 2 × 96px |
| 1440 | 624 / 528px | 3 × 197px | 3 × 165px |

The expanded-sidebar tablet column is genuinely cramped at 106px. That is the honest consequence of a
256px app sidebar plus a 272px cart on an 820px screen, and two small columns beat one huge one for a
menu — but **collapsing the shell rail is what this screen actually wants**, and doing it automatically
on the POS route would persist globally and change every other screen. Left alone deliberately.

### The rest

**Category chips are sticky.** They used to scroll away with the grid, so switching category from
halfway down Waffles meant scrolling back up first — two gestures and a hunt, on the control tapped
most after the cards. Every chip now carries its product count, including All.

**The mobile cart is a floating pill, not a flush bar.** Inset and rounded so it reads as a control
hovering over the grid rather than as the bottom of the page; a full-bleed bar at the screen edge reads
as chrome and gets ignored. The whole pill is one button — splitting it into "a total you cannot press"
and "a button you can" wastes the 200px the total occupies.

**The cart's stepper is one bounded control.** Same 48px targets, but grouped, so minus and plus read as
belonging to the quantity between them instead of as two of four icon buttons on the row. The previous
version put delete immediately beside plus with nothing separating them — the pair you least want
confused.

**Payment targets are 8rem tall** and the amount due is a 44px hero. This is the one dialog in the hot
path, so its two questions are as large as the sheet allows: at 128px a method is hit without aiming.

**Animation is feedback, not decoration.** A 140ms pop on any quantity that changes, keyed on the value
so it replays rather than firing once on creation; a 4px rise on a new cart line. Both respect
`prefers-reduced-motion`.

---

## The counter's second pass — surface, not flow

The flow was already right; this pass changed only how it looks and feels. **No business logic, no
request, no total, and no step in the order of operations moved.**

### Categories are chips at every width

The desktop used to get a vertical rail and the phone got chips — two interfaces to learn for one
control. The rail was defensible (every category visible at once, fixed targets) but it cost a whole
column of the product grid to say what a wrapping row of chips says in two lines. Chips now **wrap**
above `md` and scroll horizontally below it, so "all visible at once" survives on the counter screen
and the phone keeps the row it had. They carry the category's emoji, its name and its count.

### Product cards

Square, full-bleed photos reaching the card's top corners — the padding moved onto the body so the
image and the footer can touch the rounded edges. Four states, and each is more than a font change:

| State | Signals |
|---|---|
| At rest | hairline, `shadow-pb-xs` — a white card on a white counter screen needs an edge |
| Hover | lifts 2px, `shadow-pb-md`, gold border |
| Press | `scale(0.97)`, on every card **including sold-out** — pressing something inert should still feel like a press, or the screen reads as frozen |
| In the cart | gold border, a warm diagonal gradient wash, permanent shadow, **and a quantity badge** |

**The badge is back, alongside the stepper rather than instead of it.** The previous pass replaced it
with the stepper on the reasoning that a floating pill was a poor place for the one number the cashier
checks. That was right about the *hand* and wrong about the *eye*: the stepper corrects a mis-tap
where the cashier is already looking, but "what is already on this order" has to be answerable in one
sweep across sixteen cards, and a figure inside a 48px control at the bottom of a card cannot do that
from a metre away. They answer different questions at different distances, so both are present.

### The brand gradient

Chocolate falling to a darker brown — `brown-700` to `brown-900`, a shade either side of the brand.
Deliberately narrow: a gradient wide enough to be *noticed* as a gradient dates an interface
immediately, and on a colour this dark it muddies the bottom third into near-black, so white text
loses its footing on the part of the button most likely to be under a thumb. At this width nobody
sees a gradient; they see a button that looks lit.

Hover lifts both stops rather than shifting the angle — the object gets brighter, it does not change
shape. Press flattens to the darker end and drops the shadow: the whole vocabulary of a physical key
in two properties. It carries the selected category chip, the card's Add bar, the mobile cart pill,
Charge, and Payment received, so "the thing acting right now" looks the same everywhere.

### Cart

**Product thumbnails**, which it did not have. Not decoration: the cashier reads this list back to
the customer, and a 40px photo is recognised faster than a name is read — especially for the four
bowls whose names differ by one word. It also makes a mis-tap visible without parsing text, which is
the error this panel exists to let someone catch.

**The total is 36px against the subtotal's 13.** It is the number read out loud and the number the
customer checks; at 28px it was a size and a half above the line totals above it.

**The checkout block is `sticky bottom-0`**, not merely last in the column. In the phone sheet the
lines scroll inside the panel, and a total that scrolls away with them is the one number needed while
scrolling.

### Payment, and the two seconds after it

The sheet gained a QR that **scales up from 92% as it fades in**. This is the one animation on the
screen the *customer* sees — they are waiting for something to scan, and a code that appears
instantly is indistinguishable from one that was always there and they missed.

**The success panel is new, and it changed where the confirmation lives.** The page used to close the
sheet the instant the response landed and report the outcome in a snackbar; at a counter that is a
confirmation the cashier reads *after* turning back to the customer, if at all. The sheet now shows a
full panel — a tick that draws itself, "Payment successful", the order number, and the amount — and
**closes itself after two seconds**.

Three things are worth knowing about how that is wired, because none of them is a logic change:

- **The page still owns everything.** The request, the idempotency key, the cart reset and the focus
  return all happen the moment the response arrives, exactly as before. The dwell delays only the
  panel, never the till — the counter is ready for the next customer while the confirmation is still
  on screen.
- **The sheet closes itself**, because the dwell is a property of that panel and the page's job ended
  when the order came back. It also means the timer cannot outlive the thing it closes; `DestroyRef`
  clears it, which matters because a route change tears the overlay down and `disableClose` does not
  cover that path.
- **The success toast is gone.** The panel carries the same information in the place the cashier is
  already looking; firing a snackbar as well put it on screen twice, and the snackbar was the worse
  of the two — bottom edge, behind the still-open sheet, with a Dismiss action to tap or ignore on
  every order of the day. Failures still surface inside the sheet, unchanged.

Two seconds is a ceiling, not a target: this is the hot path, the next customer is already there, and
a confirmation that has to be dismissed is a tap added to every order.

### Verified — 32 checks

Three viewports, in headless Chrome against the live API:

**Structure:** 16 cards render · **zero nested buttons anywhere** · an untouched card is a single
`button` · the Add bar is present · all 13 photos decode (`naturalWidth > 0`, since a broken image still
occupies its box) · images ≥ 140px wide.

**Touch:** every control inside the order page measured ≥ 44px on both axes — the whole page, not a
sample.

**The stepper flow:** tapping a card turns it into a stepper card, `+` takes it 1 → 2 **in place**, `−`
takes it back, and the cart line follows.

**Checkout:** Charge opens the sheet · two methods · targets 128px tall · amount due 44px.

**Responsive:** desktop shows rail + cart column; tablet drops the rail, keeps the cart, chips compute
`position: sticky`; mobile drops the cart column, floats a 64px fully-rounded pill 12px clear of the
edge, and opens the sheet with a 64px Charge button. No horizontal scroll at 390 or 820.

**Regression:** the 84-check list suite, 20-check dashboard, 63-check form suite and 64-check shell
suite all still pass.

### Not verified in the redesign

- **A real order placed end to end after the redesign.** The add/stepper/charge path is exercised up to
  the payment sheet; no probe order was committed, so the 4.4-second figure above is the *previous*
  measurement and has not been re-timed.
- **Real touch input.** Targets are measured in CSS pixels; a thumb on glass is not the same test.
- **The WCAG sweep.** The original run reported zero AA violations on all three POS routes; the card
  markup has changed since and that sweep has not been re-run.

## Declared versus counter

There are now two records of the same walk-in trade, and this is the rule that keeps them
honest:

| | `DailySalesEntry` | `SalesOrder` |
|---|---|---|
| What it is | the **declared** daily total, typed in at close | the **counter's** own itemised record |
| Covers | every channel — walk-in, Zomato, Swiggy | walk-in only |
| Detail | one figure per channel | every product, every order |

**They are never summed.** Adding them would double-count every order taken: the same bowl
appears once when the POS records it and again inside the figure the admin declares. Declared
revenue therefore remains the revenue everywhere it already was — it is the only place the
aggregators exist — and POS orders are reported *beside* it as the detail behind its walk-in
part.

Where they are related, it is by **comparison**:

- **Dashboard** — a headed "At the counter today" section, and a reconciliation strip:
  *"Declared walk-in is ₹75 more than the till recorded (₹1,000 declared, ₹925 through the
  POS) — sales taken without going through the till."* Three states: not yet declared (the
  normal state before close, and **not** a shortfall), matching, or a discrepancy.
- **Analytics** — a "Through the till" tile captioned as a *share* of declared revenue
  (`66.1%`), never as a figure to add.

`declared` is **null**, never zero, until the day is written up. At 6pm that means "not yet
counted", and reporting it as a ₹925 shortfall would be alarming nonsense.

### What POS added that nothing else could

Per-product data. A rupee figure per channel has no product in it, which is why analytics
used to carry an explicit *"Top selling product — unavailable"* entry. **That entry is gone**,
replaced by:

- **Analytics: Top selling products**, ranked by units with a share of POS revenue.
- **Reports: Product sales** — units, orders, revenue, weighted average price and share.
- **Reports: POS orders** — every order itemised, with status and payment method.
- **Dashboard:** the day's best seller named on a tile.

The one caveat that still applies is stated on the page: the ranking covers **counter trade
only**, because aggregator orders are declared as a daily total with no items in them.

Both new reports are gated on `REPORT_VIEW_FINANCIAL` — these are takings — and both inherit
filters, sorting and Excel/PDF export from the existing framework.
