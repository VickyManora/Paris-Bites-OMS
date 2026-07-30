# Inventory module

Stock tracking across two locations, with change history.

---

## 1. The model

An **inventory item** is one thing, measured in one unit, at one location. The same
ingredient in the warehouse and on the cart is **two items** — they have independent
quantities and independent reorder thresholds, which is the entire point of tracking the
two separately.

| Field | Type | Notes |
|---|---|---|
| `name` | text | Unique per location, case-insensitively |
| `category` | enum (20) | Chocolate, Waffle premix, Bowl premix, Dairy, Packaging, … |
| `unit` | enum (8) | `KG`, `GRAMS`, `LITERS`, `PIECES`, `BOXES`, `PACKETS`, `SHEETS`, `BOTTLES` |
| `location` | enum | `HOME_WAREHOUSE`, `CART` |
| `currentQuantity` | `Decimal(12,3)` | Changed only via the adjust endpoint |
| `openingQuantity` | `Decimal(12,3)` | What it held at set-up. Frozen — never editable |
| `minimumQuantity` | `Decimal(12,3)` | Reorder threshold; `0` disables the warning |
| `purchasePrice` | `Decimal(14,4)?` | Cost per unit ex-tax. Null means "not priced" |
| `supplierId` | uuid? | Usual vendor. Advisory — a purchase may name any supplier |
| `lowStockAlertEnabled` | boolean | Whether the item may raise an alert. Default true |
| `batchNumber` | text? | Supplier's lot marking for the stock held |
| `expiryDate` | `date`? | Calendar day, not an instant |
| `status` | enum | `ACTIVE`, `INACTIVE` — **lifecycle, not stock level** |
| `notes` | text? | Searchable |

### Decisions worth knowing

**The alert toggle does not touch the stock figures.** `needsRestocking` stays a statement
about quantities; `shouldAlertLowStock` is `needsRestocking` filtered by the toggle and by
the item being active. Collapsing the two would mean silencing a noisy consumable also
removed it from the reorder list and the dashboard counts — quietly shrinking the numbers
someone silenced an alert to stop being nagged about.

**`purchasePrice` is nullable, and `stockValue` is null with it.** "Worth nothing" and "we
have not priced this" are different facts; a valuation report that totals the second as
the first understates the inventory without saying so.

**`openingQuantity` is frozen at creation.** It defaults to whatever the item was created
holding, not to 0 — an item entered with stock already on the shelf did not open empty.
There is no endpoint to change it: editing it later would be a rewrite of history rather
than a correction.

**Packets, sheets and bottles are discrete.** They join pieces and boxes in rejecting
fractions. Half a packet of Oreos is either an open packet still sitting on the shelf, or
it is not there — "2.5 packets" is not a count anyone can act on.

**`status` is lifecycle; stock level is derived.** Whether an item is low or out of stock
is computed from `currentQuantity` versus `minimumQuantity` on every read and is **never
stored**. A stored copy would be one write away from contradicting the quantities it
describes. `deriveStockStatus` in `inventory.enum.ts` is the single definition, and the
SQL summary mirrors it exactly.

**`Decimal`, not `Float`.** 0.1 kg + 0.2 kg must equal 0.3 kg. Three decimal places covers
grams-within-kilograms, which is the finest measure this business needs.

**Pieces and boxes reject fractions.** "2.5 boxes" is not a rounding problem, it is a
meaningless quantity, so it is an error. Excess precision on continuous units is *rounded*
instead — refusing `0.0001 kg` would be pedantic.

**A zero threshold means "not tracked".** Otherwise every item without a threshold would
sit permanently in the low-stock list and the warning would stop meaning anything. Such an
item is still flagged when it hits zero.

**Low stock includes out of stock.** Being out is the worst case of needing stock; a
warning that excluded it would hide the most urgent items.

**Category is an enum, not a table.** A fixed vocabulary with no requirement to manage it
at runtime. Promote it to a model the moment staff need to add their own — the migration
is additive.

**No enum value has ever been removed.** Seven of the original thirteen categories are
unused by the current master list, and `BOXES`/`GRAMS` are unused by any item. They stay
because `stock_transfer_lines` and `purchase_lines` snapshot the unit and category of what
they moved: an apparently unused value is still held by historical rows, and Postgres
cannot drop one that is.

---

## 1a. The master list

`backend/prisma/inventory-master.ts` is the source of truth for what the business stocks —
40 items across 10 categories, each set up at both locations. `seed-inventory.ts` makes the
database match it and prints what it did.

```
npm run prisma:seed:inventory     # inventory only
npm run prisma:seed               # accounts, then inventory
```

**A row carries a definition, never a stock level.** Re-running the seed refreshes
category, unit, reorder threshold, status, the alert flag and notes — and leaves
`currentQuantity`, `openingQuantity`, price, supplier, batch and expiry untouched. A
fixture that reset counted stock to zero on every deploy would be a data-loss bug wearing
a fixture's costume. It is safe against a live database and idempotent: a second run
reports 80 unchanged and writes no history.

**Every item is set up at both locations** — 40 names, 80 rows. An item is one thing at
one location, so the warehouse and the cart hold separate rows with independent counts and
thresholds. Seeding only the warehouse meant the cart could hold a thing only once a
transfer had sent it there, and anyone counting cart stock had to create the row by hand
first. Both sides now carry the full list; the ones nothing has reached open at zero, which
is a true statement rather than a missing one.

An existing database is brought to that shape by
`npm run inventory:mirror-locations`, which backfills the missing counterpart for every
live item — copying the definition and the usual supplier, opening quantities at zero, and
leaving price, batch and expiry null, since those are facts about stock that was actually
bought. It is idempotent and takes `--dry` to report without writing.

**Removal degrades rather than fails.** An item not on the master list is hard-deleted,
taking its history with it. One referenced by a stock transfer or a purchase invoice is
**soft-deleted instead** — those foreign keys are `RESTRICT` because a completed transfer
or a filed invoice records goods that physically moved. The item disappears from every
list, filter, dashboard and API response; the documents naming it stay readable. The seed
names each one it retained, so an item count that disagrees with the master list has a
visible explanation rather than a mysterious one.

**Cleaning and hygiene units are assumptions.** The master list names those seven items
but, unlike every other category, specifies neither unit nor reorder level. The seeded
values are defaults, and each such item carries a note saying so — flagged in the data
rather than silently chosen and forgotten.

---

## 2. Database

Two tables: `inventory_items` and `inventory_item_history`.

Three constraints are **hand-written in the migration** because Prisma cannot express
them. They will not be regenerated by `prisma migrate diff`, and `prisma db push` would
drop them:

```sql
-- Name unique per location, scoped to LIVE rows only.
CREATE UNIQUE INDEX "inventory_items_name_location_live_key"
    ON "inventory_items" (LOWER("name"), "location")
    WHERE "deleted_at" IS NULL;

ALTER TABLE "inventory_items" ADD CONSTRAINT … CHECK ("current_quantity" >= 0);
ALTER TABLE "inventory_items" ADD CONSTRAINT … CHECK ("minimum_quantity" >= 0);
```

**Partial** on purpose: a plain unique index would let a soft-deleted item hold its name
hostage forever, so re-adding "Unsalted butter" after deleting it would fail with a
conflict the user cannot see or resolve. **`LOWER(name)`** so "Butter" and "butter" collide
— case-sensitive uniqueness would let near-duplicates accumulate, which is exactly what an
inventory system must not allow.

The `CHECK`s are a backstop. Quantities are validated in the domain too; these hold even
for a direct SQL write or a bug that bypasses the use case.

---

## 3. History

`inventory_item_history` is append-only — the repository exposes only `record`. Actions:
`CREATED`, `UPDATED`, `QUANTITY_ADJUSTED`, `STATUS_CHANGED`, `DELETED`, `RESTORED`.

Quantity changes store before/after; metadata edits store a field-level diff
(`{ "minimumQuantity": { "from": 5, "to": 15 } }`) containing only fields that genuinely
changed, so submitting an unmodified form records nothing.

**History survives deletion.** Items are soft-deleted because the history is a record of
stock that physically existed. A deleted item returns 404 from the API, disappears from
lists, and its history remains readable — which is what someone investigating a
discrepancy needs.

This is an *audit trail*, not the source of truth: `currentQuantity` on the item remains
authoritative. When a full `StockMovement` ledger lands, that becomes authoritative and
`currentQuantity` becomes a cached projection of it.

---

## 3a. Recipes — schema only

`recipes` and `recipe_ingredients` exist in the database. **No code reads or writes them
yet**, and there is no API or UI. They are here so that recipe-driven deduction needs no
change to `inventory_items` when it lands.

A `Recipe` holds one `RecipeIngredient` per thing a dessert consumes. Using the worked
example: *Death by Chocolate Bowl* would list Chocolate Bowl Premix, Dark Chocolate, Dark
Chocolate Filling, Whipping Cream, Oreo Cookies, Dessert Bowl, Wooden Spoon, Tissue Paper
and Butter Paper. Packaging sits in the same list as the chocolate because both are
consumed per serving — splitting them into "ingredients" and "supplies" would mean two
deduction paths for one event.

Quantities are **per batch**, with `Recipe.yieldQuantity` saying how many servings a batch
makes. That is how a kitchen writes a recipe; deduction divides.

The intended flow on order completion is to multiply each line by the quantity sold and
call the existing `adjustQuantity` per item — reusing the path that already locks the row
and writes history in one transaction, rather than introducing a second way to move stock.
The history action is `RECIPE_CONSUMED`, distinct from a noted `QUANTITY_ADJUSTED` because
"what did selling desserts consume" is a question a report groups by, and a free-text note
is not something it can group by.

`RecipeIngredient.unit` snapshots the item's unit so a later unit change on the item is
detectable rather than silently reinterpreting "200" from grams to kilograms. The item
remains the authority for deduction.

---

## 4. Concurrency

Adjusting a quantity is a read-modify-write, which is where inventory systems quietly lose
data. `IInventoryItemRepository.adjustQuantity` takes a function from the current quantity
to the new one, and the implementation runs it inside `SELECT … FOR UPDATE`:

```ts
await items.adjustQuantity(
  id,
  (current, unit) => InventoryQuantity.applyDelta(current, delta, unit),
  (before, next) => (before === next ? null : { action: 'QUANTITY_ADJUSTED', actorId }),
);
```

The lock is what makes two staff each removing 5 kg from 20 kg land at 10, not 15. The
arithmetic rules stay in the domain; only the locking lives in infrastructure.

**The history insert is in the same transaction.** This was a real bug found by testing:
with the history written *after* the transaction, ten concurrent adjustments produced
committed quantity changes with no record of them, because the second write failed on an
exhausted connection pool. Stock changed, nobody knew who changed it — precisely the
failure an audit trail exists to prevent.

There is also **no read before the write**. The lock query returns the unit as well as the
quantity, so the use case needs no separate fetch: one fewer round trip, one fewer
connection held, and no stale value to reason about.

Verified: 10 simultaneous `-1` adjustments against a quantity of 100 leave exactly 90, with
10 × 200 responses and one history entry each.

---

## 5. REST API

All routes are authenticated, then gated on a **capability** rather than a role.

| Method | Path | Permission | Store Manager |
|---|---|---|---|
| `GET` | `/inventory/items` | `PRODUCT_READ` | yes |
| `GET` | `/inventory/items/:id` | `PRODUCT_READ` | yes |
| `POST` | `/inventory/items` | `PRODUCT_CREATE` | yes |
| `PATCH` | `/inventory/items/:id` | `PRODUCT_UPDATE` | yes |
| `PATCH` | `/inventory/items/:id/quantity` | `STOCK_ADJUST` | yes |
| `DELETE` | `/inventory/items/:id` | `PRODUCT_DELETE` | **no** |
| `GET` | `/inventory/items/:id/history` | `PRODUCT_READ` | yes |
| `GET` | `/inventory/dashboard` | `STOCK_READ` | yes |

Delete is the one a Store Manager cannot do: running the store day to day never requires
removing an item's record, and a mistaken delete takes stock history with it.

### Stock changes are a separate endpoint

`PATCH /items/:id` **refuses `currentQuantity`** (422). Stock moves only through
`PATCH /items/:id/quantity`. Two reasons: it is gated on a different permission, and it
records a quantity-specific history entry. Letting an edit form silently overwrite a stock
level would make the history unreliable and bypass the gate.

The adjust endpoint takes **either** a signed `delta` (relative, concurrency-safe: "10 kg
arrived") **or** an absolute `quantity` (a stocktake correction) — never both. Supplying
both is rejected rather than resolved by precedence, because the caller's intent would be a
guess and guessing wrong silently changes stock.

### List query

```
GET /inventory/items
  ?search=butter          name or notes, case-insensitive
  &category=DAIRY
  &location=CART
  &unit=KG
  &status=ACTIVE
  &needsRestocking=true   low OR out of stock
  &page=1&pageSize=25
  &sortField=name         closed set of 8 sortable columns
  &sortDirection=asc
```

Filtering, sorting and pagination are **all applied in SQL**. Filtering a page after
fetching it would return fewer rows than requested and report a total that does not match
the filter, so the paginator would offer empty pages. `needsRestocking` compares two
columns using a Prisma field reference; `sortField` is restricted to a closed set so a
caller cannot sort by an unindexed column and turn a list request into a table scan.

---

## 6. Frontend

```
features/inventory/
├── models/inventory.model.ts          enums, DTOs, dropdown options
├── services/
│   ├── inventory.service.ts           stateless HTTP
│   └── inventory-store.service.ts     signal-based list state
├── components/
│   ├── item-form-dialog/              add + edit
│   ├── adjust-quantity-dialog/        add / remove / set
│   ├── history-dialog/                paginated timeline
│   └── item-actions-dialog/           row action sheet
└── pages/inventory-list/              the main screen
```

**Service and store are separate.** The service is stateless — every method is a request —
so it can be called from anywhere (the dashboard reads it) without inheriting a list page's
filters. `InventoryStore` is provided by the list page, not at the root, so its filters and
paging are scoped to the page and reset when the user leaves.

**Fetching is explicit, not reactive.** An `effect` refetching whenever the query signal
changed would look elegant and misbehave: changing a filter and resetting the page in one
handler would fire two requests, and the responses could arrive out of order. Every mutator
calls `load()` once, deliberately, and a **request sequence number** discards superseded
responses — typing quickly produces overlapping requests and the slower one can land last.

**The URL owns the search term.** Both the topbar's global search and the page's own search
box write `?search=`; a single effect pushes it into the store. One direction of flow —
input → URL → store → request — means the two boxes cannot fight, and a filtered list is
linkable and survives a reload.

**Edit vs adjust in the UI.** In edit mode the current quantity is shown **read-only** with
a lock icon and a pointer to "Adjust quantity", mirroring the API split. The adjust dialog
shows a **live projection** of the resulting quantity, warns when it would fall below the
minimum, and disables Apply when it would go negative — catching a wrong mode or a mistyped
figure before it is committed.

**Row tap opens an action sheet** listing only the actions the user's permissions allow.
Four actions do not fit in a table row on a phone, and a row that does nothing when tapped
reads as broken; one affordance that works at every size beats two that each work at one.

Below 600px the table becomes a card list, generated from the same `TableColumn`
definitions.

---

## 7. Verified behaviour

**API — 79 checks** with `curl` against real bcrypt, real Postgres and the real migration:
create with derived status and labels · case-insensitive duplicate rejected per location
while the same name is allowed at another · fractional quantity rejected for boxes ·
negative rejected · pagination totals and non-overlapping pages · sorting by name and
quantity · unknown sort field rejected · filters for location, category, unit, search over
name and notes · **the low-stock rule** including out-of-stock inclusion, zero-threshold
exclusion and correct totals · low-stock combined with search (AND, not overwritten) ·
metadata edit flipping stock status via the threshold · edit endpoint refusing
`currentQuantity` · empty update rejected · delta, decimal-drift-free arithmetic
(`10 + 0.1 + 0.2 = 10.3`), over-withdrawal rejection with the available figure, absolute
stocktake, both-parameters rejection, zero-delta rejection · **10 concurrent adjustments
losing nothing** · history with actions, notes, signed deltas, actor and field-level diffs ·
dashboard counts including bigint serialisation · Store Manager permitted everything except
delete · soft-delete semantics including name reuse and surviving history.

**UI — 79 checks** in headless Chrome against the live stack: dashboard reading real
figures (no sample data left) · sidebar link and breadcrumb · search narrowing and its empty
state · category filter · **low-stock filter reducing 11 rows to 4, every row verified low
or out, and toggling back off** · **sorting flipping the first row and reporting
`aria-sort="descending"`** · add with a success toast · client length validation and a
server duplicate-name conflict shown on the field · row action sheet · adjust with a live
projection, the resulting quantity in the row, and a low-stock warning toast ·
over-withdrawal blocking Apply · history showing creation, adjustments, before → after,
the note and the actor · edit with a read-only quantity · mobile card layout with no
horizontal scroll · delete with confirmation · Store Manager's action sheet hiding delete.

**Unit tests — 121 passing**, no database: quantity rules (rounding, discrete units,
drift, over-withdrawal), the stock-status rule including its boundaries, and the
master-list additions — the alert toggle staying out of `needsRestocking`, stock value
being null rather than zero when unpriced, and expiry comparing calendar days so stock is
not expired on its own expiry date.

**Master-list update — verified against the running API and real Postgres:** all 40 items
present with the specified category, unit and reorder level (3 · 2 · 2 · 3 · 3 · 4 · 8 ·
1 · 7 · 7); every new category and unit filterable; the seed idempotent on a second run;
users, suppliers, transfers and notifications untouched by the purge. Write paths for
every new field, including clearing each with `null`, `stockValue` tracking an adjustment
(4 × 845.50 = 3382), and the alert toggle flipping `shouldAlertLowStock` while
`needsRestocking` stays true. Rejections: negative price, non-existent supplier,
malformed UUID, over-long batch number, `2027-02-30`, a full timestamp where a date is
required, and a fractional count of packets.

### Bugs this testing found

1. **Quantity changes could commit with no history entry** — the history write was outside
   the transaction. Fixed by moving it inside.
2. **The low-stock filter chip could be switched on but not off** — a single-select
   `mat-chip-listbox` does not reliably deselect its only option. Replaced with a checkbox.
   My first assertion for it was too weak to catch this; strengthened to compare row counts
   and read every row's status cell.
3. **The topbar search was a dead control.** Now routes to the inventory list with the term.

### Not verified

- **The row lock itself, locally.** The development pool is capped at **one connection**,
  because the default local database (`prisma dev` / PGlite) multiplexes every connection
  onto a single session and corrupts it when a transaction overlaps another query. Ten
  simultaneous `-1` adjustments against 100 still land on exactly 90 with ten history
  entries — re-verified after that change — but at a pool of one they are serialised by the
  driver, so what the test now demonstrates is the arithmetic, not `SELECT … FOR UPDATE`.
  Confirming the lock needs a real Postgres and `DATABASE_POOL_MAX` raised. See the README.
- **Load beyond 10 concurrent writers.** Size the pool against Neon's connection budget
  before real traffic.
- **A second API instance.** Nothing here is instance-local, but it has not been run that way.
- **Large datasets.** Tested with ~12 items. The indexes suit the default sort and filters;
  confirm query plans at a few thousand rows.
- **Restore.** `restore()` exists on the repository and `RESTORED` is in the history enum,
  but no endpoint or UI exposes it — a deleted item cannot currently be brought back
  without direct database access.
- **The item form's new fields in a browser.** Price, supplier, batch, expiry and the
  alert toggle were exercised through the API, and the frontend typechecks, lints and
  builds — but the dialog itself has not been driven in headless Chrome the way the
  original 79 UI checks were.
- **The expiry column across timezones.** `expiryDate` is passed through as the API's
  `YYYY-MM-DD` string and never parsed into a `Date` on the client, which is what avoids
  an off-by-one day; that reasoning has not been confirmed against a browser running in a
  negative UTC offset.
- **Recipes.** Tables and constraints only. Nothing has been inserted into them.
