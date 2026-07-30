# Daily consumption

What the kitchen actually used, entered by hand. Recording deducts stock immediately.

---

## 1. The model

A **consumption entry** is one day's usage at one location, holding a line per item. It is
the mirror image of a purchase: a purchase adds stock from outside the business, an entry
takes stock out of it, and both move inventory inside the transaction that records them.

| Field | Type | Notes |
|---|---|---|
| `entryDate` | `date` | The day the stock was **used** |
| `location` | enum | Consumption at the cart and in the kitchen draw down different rows |
| `revision` | int | 1 is the original; every correction increments it |
| `deletedAt` / `voidReason` | — | Voided, not deleted — the row survives the reversal |

### Why an entry is editable when a purchase is not

A purchase is a document someone else issued and we transcribe; correcting it would mean
rewriting their invoice, so a mistake is fixed with a separate stock adjustment. A
consumption sheet is **our own observation** of what the kitchen used. "We used 1.2 kg, not
2.1" is a correction to that observation, not a second event — and forcing it through a
compensating adjustment would leave the sheet permanently wrong while the stock was right.

The trade is that an editable stock movement is only trustworthy if the edits are visible,
which is what §3 is for.

### The date is not the timestamp

`entryDate` is a calendar day; `createdAt` is when someone typed it in. Sheets are
routinely written up the next morning, so a report keyed on `createdAt` would answer a
different question from the one anybody asks.

---

## 2. Stock movement

Every mutation follows the same three steps in one transaction: lock the affected
inventory rows, apply the net change through `InventoryQuantity`, write the entry and a
history row per item.

| Operation | Stock change per item |
|---|---|
| Record | `-quantity` |
| Edit | `previouslyConsumed - nowConsumed` |
| Void | `+quantity` for every line |

**An edit applies the difference, not a reversal-and-replay.** Consuming more takes more
off the shelf; consuming less puts some back; an item dropped from the sheet has its whole
quantity returned. An unchanged line therefore never touches its item at all — it writes
no history and cannot fail a stock check it already passed. Verified: a sheet of 1.2 kg
chocolate / 3 L cream / 0.5 kg Nutella, edited to 2 kg chocolate with the cream removed,
moves chocolate 8.8 → 8, returns cream 17 → 20, and leaves Nutella untouched at 4.5.

**Items are locked in one statement ordered by id.** Two people recording usage of an
overlapping pair of ingredients would otherwise be able to deadlock against each other.

**Over-consumption is refused, naming the ingredient.** `InventoryQuantity.applyDelta`
already rejects a result below zero; the repository re-throws it with the item's name,
because "Cannot remove 5 — only 3 in stock" is not actionable on a sheet with six lines.

**`CONSUMED` is one history action for record, edit and void.** The signed before/after
already says which way stock moved, and keeping them under one action means "what did we
consume this month" is a single sum in which a correction nets off against the figure it
corrects. It is distinct from `RECIPE_CONSUMED`, which automatic recipe deduction will use:
the two will answer different questions once they sit side by side — what the recipes say
should have gone, versus what went.

---

## 3. History and audit

Two records, deliberately:

- **`consumption_entry_revisions`** is the entry's own story and what its screen renders:
  who changed it, when, why, and the per-item movement (`Dark Chocolate: 1.2 → 2`). An
  edit's snapshot carries `changedItems`; a void's carries `returnedItems`.
- **`audit_logs`** records the same events for the system-wide trail, which answers "what
  did this user do" and is queried by actor and time rather than by entry.

The revision table exists because a first-class, displayable edit history cannot be
reconstructed from the item-by-item stock trail without reading every ingredient's history
and correlating by timestamp.

---

## 4. Entering grams against a kilogram item

The kitchen uses 500 g of Nutella from a store room that counts kilograms. Each row in the
form offers the item's own unit **plus a finer sibling** — g for kg, ml for L — and shows
the converted figure inline (`= 0.5 kg recorded`) before you save.

The conversion happens on the way out, so the API only ever sees the item's own unit and
the record holds one canonical figure rather than two competing ones. These are exact
scalar conversions **within one dimension**; the inventory model still refuses mass↔volume,
which needs a density per item.

Discrete units (packets, pieces, bottles) have no sibling — half a packet is not a
measurement — so those rows get one option and step by 1.

---

## 5. Permissions

| Operation | Permission | Admin | Store Manager |
|---|---|---|---|
| List / read / summary | `STOCK_READ` | yes | yes |
| Record | `STOCK_ADJUST` | yes | yes |
| Edit | `STOCK_ADJUST` | yes | yes |
| **Void** | `STOCK_WRITE_OFF` | yes | **no** |

Recording and editing are `STOCK_ADJUST` — "record a normal movement: goods in, goods out",
which is exactly what a Store Manager entering the day's usage is doing. Editing belongs
with it rather than behind a higher gate: a correction made the same evening is ordinary,
and putting it out of reach would mean the sheet stays wrong.

**Voiding is admin-only.** It returns a whole day's stock in one call with no counter-record
of what was used instead — precisely the "make physical and recorded stock agree without an
explanation" risk `STOCK_WRITE_OFF` exists to contain. Correcting a mistake is an edit;
erasing the day is not. A reason is required by the validator, the use case and a database
CHECK.

---

## 6. REST API

| Method | Path | Permission |
|---|---|---|
| `GET` | `/consumption` | `STOCK_READ` |
| `GET` | `/consumption/summary` | `STOCK_READ` |
| `GET` | `/consumption/:id` | `STOCK_READ` |
| `POST` | `/consumption` | `STOCK_ADJUST` |
| `PUT` | `/consumption/:id` | `STOCK_ADJUST` |
| `POST` | `/consumption/:id/void` | `STOCK_WRITE_OFF` |

`PUT`, not `PATCH`: the body is the entry's complete desired state, and the stock effect is
computed as a diff against what is stored. A partial update would leave the server guessing
which lines were meant to disappear.

Void is `POST /:id/void` rather than `DELETE /:id`, because the row survives and the call
carries a required body — `DELETE` with a mandatory payload, on something that is not
deleted, would describe none of that.

```
GET /consumption
  ?search=chocolate        item names and the sheet's notes
  &location=CART
  &itemId=<uuid>           every sheet that used one ingredient
  &fromDate=2026-07-01&toDate=2026-07-31
  &includeVoided=true      hidden by default
  &page=1&pageSize=25
  &sortField=entryDate&sortDirection=desc
```

---

## 7. Verified behaviour

**API — against real Postgres:** recording 1.2 kg / 3 L / 0.5 kg deducts exactly that ·
editing applies per-item deltas (−0.8 more, one returned in full, one untouched) · the
revision history carries the actor, the reason and the `changedItems` diff ·
over-consumption refused with the ingredient named · voiding returns every line · voiding
twice refused · editing a voided entry refused.

**UI — 22 checks in headless Chrome:** the Consumption link under Stock · recording the
example sheet with **500 g typed against a kilogram-tracked Nutella**, showing
`= 0.5 kg recorded` and storing 0.5 kg · stock decreasing automatically to 8.8 / 17 / 4.5 ·
the sheet appearing in the log · the detail view listing all three items · the edit form
pre-filled · an edit landing 8 / 20 / 4.5 · the entry flagged Edited with who, why and
`Dark Chocolate: 1.2 → 2`, `Whipping Cream: 3 → 0 (removed)` · voiding prompting for a
reason and returning all stock · voided sheets hidden by default and restored by the
toggle · no horizontal scroll at 390px · no 5xx.

### A bug this testing found

**The gram selection was silently discarded at submit.** `form.disable()` emits
`valueChanges` on every control, which re-ran the item-changed handler and reset each row's
entry unit — so 500 g was sent as 500 kg and the server refused it. Fixed twice over: the
row values are snapshotted before the form is disabled, and the handler now only resets the
unit when the item id genuinely changes.

### Not verified

- **From a Store Manager's session.** The permission split is declared on the routes and
  the UI hides what it should, but every check above ran as an admin — including the void
  path, which a Store Manager should *not* be able to reach.
- **Concurrent entries touching the same ingredient.** The rows are locked in id order and
  the arithmetic goes through the same value object as every other path, but the local
  database serialises everything (see `DATABASE_POOL_MAX`), so the lock has not been
  exercised under real parallelism.
- **Large sheets.** Tested with three lines; the API caps at 100 and each line locks an
  inventory row for the transaction.
- **Recipe-driven deduction.** Still schema-only. When it lands it will write
  `RECIPE_CONSUMED` alongside these manual entries, not replace them.
