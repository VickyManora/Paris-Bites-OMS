# Testing guide

How to exercise every feature by hand, in an order that builds its own data as it goes.

Written as a walkthrough rather than a checklist, because the modules depend on each other: a
purchase needs a supplier, a transfer needs stock, and the analytics only say anything once
something has been sold. Following it top to bottom is also the fastest way to understand what
the product actually does.

Where a feature can only be tested by breaking something — a dropped connection, a double tap,
the wrong role — that is called out with how to break it.

---

## Before you start

```bash
npm run install:all     # once
npm run db:migrate      # apply migrations
npm run db:seed         # accounts, inventory master, menu
npm run dev             # api on :4000, web on :4200
```

The app is at **http://localhost:4200**. The API is at **http://localhost:4000/api/v1**, with
liveness at `/api/v1/health/live` and readiness at `/api/v1/health/ready`.

### Accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@parisbites.local` | `SEED_ADMIN_PASSWORD` in `backend/.env` |
| Store Manager | `manager@parisbites.local` | `SEED_MANAGER_PASSWORD` in `backend/.env` |

**Test with both.** The role split is a feature, not decoration: the two see different
dashboards, different order lists and different discount ceilings. Anything below marked
**(Admin only)** is a permission boundary worth confirming rather than assuming.

### Route map

| Path | Permission required |
| --- | --- |
| `/auth/login` | — |
| `/dashboard` | any signed-in user |
| `/inventory` | `PRODUCT_READ` |
| `/suppliers` | `SUPPLIER_READ` |
| `/purchases`, `/purchases/record` | `PURCHASE_ORDER_READ` |
| `/transfers` | `TRANSFER_READ` |
| `/consumption` | `STOCK_READ` |
| `/pos`, `/pos/new`, `/pos/orders` | `POS_OPERATE` |
| `/sales` | `SALE_READ` |
| `/reports` | `REPORT_VIEW` |
| `/analytics` | `REPORT_VIEW_FINANCIAL` **(Admin only)** |
| `/notifications`, `/account/profile`, `/account/password` | any signed-in user |

---

## 1. Suppliers — `/suppliers`

Start here; a purchase cannot exist without a supplier.

Add **two** suppliers, and make their states differ:

- one in **Maharashtra** (the business's own state — `BUSINESS_STATE_CODE=27`)
- one in **any other state**

That single field decides the tax treatment of every invoice from them, in step 2. Give at least
one a GSTIN.

Then: open the detail dialog, edit a supplier, and delete one. The delete is soft — the record
stays for the invoices that reference it, and the name is released for reuse.

## 2. Purchases — `/purchases/record`

The richest form in the app, and the one that puts stock and prices into the system.

Add several lines and watch the totals move **as you type** — that arithmetic is local so it can
keep up with typing, and the server recomputes it authoritatively on save.

Three things worth doing deliberately:

1. **Pick the Maharashtra supplier.** Tax splits into **CGST + SGST**.
2. **Change to the out-of-state supplier.** The same invoice becomes **IGST**. Notice the
   treatment is *shown*, never chosen — see [PURCHASES.md](./PURCHASES.md) for why offering it as
   a field would let someone file the wrong tax.
3. **Choose "+ New item…"** in the Item dropdown to create an inventory item inline, without
   leaving the invoice half-entered.

Save, then confirm the consequences:

- `/purchases` lists the invoice; the detail dialog shows the GST breakdown.
- Upload an invoice file on the detail dialog, then download it back.
- **`/inventory`** — the quantities went up, and the items now have a purchase price.

## 3. Inventory — `/inventory`

Create, edit and delete an item, then the parts that matter more:

- **Adjust quantity** — requires a reason. There is no silent stock edit anywhere in the system.
- **History** — every movement for that item with actor, reason and timestamp, including the
  increases from step 2.
- Set one item's **minimum quantity above its current quantity**. It becomes low-stock, which is
  what the alert sweep in step 10 will pick up.

## 4. Stock transfers — `/transfers`

A two-phase workflow, and the clearest place to see the role split.

1. **Create** a transfer request with a couple of lines.
2. **Approve** it, then **Complete** it.
3. On a second request, **Reject** it — a reason is required.

Then open `/inventory` → History on a transferred item: both legs are recorded separately,
`TRANSFER_OUT` at the source and `TRANSFER_IN` at the destination, because "what did we move
between our own locations" and "what did we buy" are different questions.

## 5. Consumption — `/consumption`

Record a daily consumption sheet with a few lines. Stock decreases.

Then **edit** it and reopen the detail: the change is kept as a **revision**, not an overwrite.
Finally **void** one — a reason is required, and the entry stays on the record as voided rather
than disappearing.

## 6. Point of sale — `/pos`, then `/pos/new`

The core flow, and the one built to a stopwatch. Full design in [POS.md](./POS.md).

**The happy path:** tap product cards → adjust with `+`/`−` in the cart → **Charge** → **Cash**
or **UPI** → **Payment received**. The cart clears itself and focus returns to search; there is
no "new order" step, because the next customer is already there.

Then exercise the details:

- **Keyboard path.** Type three letters in search and press **Enter** — the top match is added
  without touching the screen. Repeat. No pointer at all.
- **UPI.** Choosing UPI shows the store's real QR at a size verified to scan, with the UPI ID
  printed as text beneath it rather than relying on the copy baked into the image.
- **Discounts.** Open *Notes, discount, customer* and enter a discount. A **reason becomes
  mandatory** — a reduction with no stated reason is indistinguishable from undercharging a
  friend. Now push the discount past the ceiling: as **Store Manager** it is refused with the
  percentage named; as **Admin** the same discount goes through.
- **Sold out.** Toggle a product unavailable, then look at `/pos/new`: it greys out rather than
  vanishing, because a customer asking for it needs to be told it has gone.
- **`/pos/orders`.** Order list and detail; **cancel with reason**; and **take payment later** on
  an order left awaiting payment.

## 7. Daily sales — `/sales`

Declared takings per channel, one entry per day. Record one, then edit it to see the revision
history.

**These are not POS orders.** Declared sales and counter orders are two records of the same
walk-in trade — compare them, never add them together. [SALES.md](./SALES.md) explains why both
exist.

## 8. Reports — `/reports`

Nine reports: inventory, low-stock, purchase, transfer, consumption, supplier, sales, POS orders
and product-sales. Run each, and **export to both XLSX and PDF**.

## 9. Analytics — `/analytics` **(Admin only)**

Revenue, food cost, top sellers and trends.

Expect food cost to **flag unpriced inventory rather than print a flattering number** — most
seeded items have no purchase price, and a food-cost figure derived from a third of the
ingredients would be worse than no figure. Priced items come from step 2.

## 10. Notifications — `/notifications`

The low-stock item from step 3 and the completed transfer from step 4 should both appear. Check
the unread badge in the topbar, mark one read, then mark all read.

Low-stock and expiry alerts are generated by a scheduled sweep, not on save — so they do not
appear the instant you cross a threshold. It runs 30 seconds after boot and then every
`ALERT_SCAN_INTERVAL_MINUTES`, which defaults to **15**. To see one promptly, set it to `1` in
`backend/.env` and restart the API. Setting it to `0` disables the sweep, which is the correct
value for every instance but one once the API runs on more than one — see
[NOTIFICATIONS.md](./NOTIFICATIONS.md).

## 11. Account — `/account/profile`, `/account/password`

Change your password, sign out, and sign back in with the new one.

---

## Things you can only test by breaking them

### Permission boundaries

Sign in as **Store Manager** and type `/analytics` into the address bar. You should land on a
*Forbidden* page — not a blank screen, not a silent redirect. Then compare `/pos/orders` between
the two accounts: the manager sees only their own day, decided server-side inside the use case
rather than by a parameter the client could change.

### Poor connectivity

Chrome DevTools → **Network** tab:

| Do this | Expect |
| --- | --- |
| **Offline**, then open `/pos/new` | Amber "No connection" banner. The cart still builds — the warning never blocks. |
| **Offline**, then reload `/pos/new` | The menu shows a real error state with a **Try again** button, not "No products on the menu". |
| **Slow 3G**, place an order | The payment sheet stays open with a spinner; the button disables. It does not vanish and leave you guessing. |
| **Offline** mid-save | Inline **"Not saved"** inside the payment sheet with **Try again** — beside the amount and method you just keyed, not a snackbar in the corner. |

Every request is also bounded by a timeout, so nothing hangs indefinitely behind a disabled
button.

### Double-charge protection

The case that actually happens on mobile data is not a double tap — it is the server saving the
order and the **reply being lost**. The obvious reaction is to tap again.

Each order attempt carries an `Idempotency-Key`, held across every retry of that order, so the
second request returns the *original* order instead of creating a new one. Proving that by hand
means dropping a response mid-flight, so it is scripted:

```bash
cd backend
npm run verify:idempotency     # replay, race, fresh key, card refusal, malformed key
npm run verify:order-race      # 8 simultaneous double-taps
npm run clean:test-orders      # removes every order the scripts created
```

`verify:idempotency` produces:

```
1. REPLAY WITH SAME KEY
   first  -> PB-20260730-0001 ₹298
   second -> PB-20260730-0001 ₹298
   same order: YES ✓
3. FRESH KEY          -> distinct from first: YES ✓
4. CARD PAYMENT       -> HTTP 422 rejected ✓
5. MALFORMED KEY      -> HTTP 422 rejected ✓
ORDERS CREATED: 3 (expected 3)
```

**Always run `clean:test-orders` afterwards** — these scripts write real orders into whatever
database `DATABASE_URL` points at, and they would otherwise sit in the day's figures. It only
deletes orders that carry an idempotency key, so hand-placed orders are left alone.

#### A known local limitation

`verify:order-race` fires two *simultaneous* requests on one key. Measured over 20 runs locally:

- **19 created exactly one order**, and **none ever created two**. The safety property holds.
- The losing request usually gets a `409` that the payment sheet's **Try again** resolves,
  returning the original order. Occasionally it gets the original order directly.
- **One run in 20 created no order at all** — both requests failed and the cashier must retry.

That last case is a development-environment artefact, not the design. `prisma dev` runs PGlite,
which multiplexes every connection onto one backend session and cannot serve two concurrent
transactions; `DATABASE_POOL_MAX` defaults to `1` locally for exactly this reason. On a real
Postgres each connection is an isolated session, the loser's insert blocks on the unique index
until the winner commits, and it then reads the winning order back. **That path is unverified
locally** — point `DATABASE_URL` at a real Postgres to exercise it.

### Responsive layout

DevTools device toolbar. The POS is mobile-first; the phone is the primary device.

| Width | Expect |
| --- | --- |
| **390px** | 2 product columns. Cart is a slide-up sheet opened from the floating **View cart** button, with a sticky total always in reach. |
| **834px** | 3 columns, cart as a sticky right-hand column. |
| **1440px** | 4+ columns, with a category rail as a third column. |

The product grid sizes itself from the space it actually has rather than from viewport
breakpoints, so drag the window slowly across the whole range: the column count should change
smoothly and cards should never squash. There should be **no horizontal scrolling at any width**,
on any page.

### PWA install

Chrome shows an install icon in the address bar. Installed, the app launches with no browser
chrome and its own icon.

The service worker precaches the **app shell only** and caches **no API responses** — a POS
showing a cached menu would be quoting stale prices. It is enabled in production builds only, so
test it with `npm run build` and a static server rather than `npm run dev`.

---

## Automated suites

```bash
npm run typecheck      # both apps
npm run test           # 177 backend, 51 frontend
cd backend  && npm run lint
cd frontend && npm run lint
```

Frontend coverage is a foundation rather than a suite — see the remaining gaps in
[REVIEW.md](./REVIEW.md).

---

## Not implemented — so don't go looking

- **Selling deducts no ingredients.** `Recipe` and `RecipeIngredient` exist in the schema but
  nothing uses them, and there is no link from a recipe to the product it produces. Stock moves
  only via purchases, transfers and hand-entered consumption.
- **No user-management screens**, despite the `USER_*` permissions existing.
- Notifications are polled rather than pushed, and the alert sweep assumes a single API instance.
