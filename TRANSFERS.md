# Stock Transfers

Moving stock from the **Home Warehouse** to the **Cart**.

This document covers the design, the transactional guarantees, the audit trail, and an honest
account of what has and has not been verified.

---

## 1. Why two phases, not one

The obvious design is one action: "transfer 10 kg of butter to the cart", which deducts the
warehouse and credits the cart in a single step.

That design cannot represent reality. Goods physically leave the warehouse before they arrive
at the cart, and between those two moments the stock is in neither place. A single-step
transfer forces a choice between two lies — either the cart holds stock it has not received,
or the warehouse still holds stock that has already gone.

So the transfer has two stock-moving steps and four states:

```
  PENDING ──approve──▶ APPROVED ──complete──▶ COMPLETED
     │                (in transit)
     └────reject────▶ REJECTED
```

| Status | Meaning | Where the stock is |
|---|---|---|
| `PENDING` | Requested, awaiting a decision | Warehouse (nothing has moved) |
| `APPROVED` | Authorised and dispatched | **In transit** — deducted from source, not yet credited |
| `REJECTED` | Declined with a reason | Warehouse (nothing moved, ever) |
| `COMPLETED` | Received at the cart | Cart |

`APPROVED` is labelled **"In transit"** in the UI. The status name records the decision; the
label describes where the goods are, which is what the reader actually needs to know.

`REJECTED` and `COMPLETED` are terminal.

### The transition table is data, not `if` statements

`backend/src/core/domain/enums/stock-transfer.enum.ts`:

```ts
const ALLOWED_TRANSITIONS: Readonly<Record<StockTransferStatus, readonly StockTransferStatus[]>> = {
  [StockTransferStatus.PENDING]:   [StockTransferStatus.APPROVED, StockTransferStatus.REJECTED],
  [StockTransferStatus.APPROVED]:  [StockTransferStatus.COMPLETED],
  [StockTransferStatus.REJECTED]:  [],
  [StockTransferStatus.COMPLETED]: [],
};
```

Two consequences matter:

- **`PENDING → COMPLETED` is not legal.** Skipping approval would move stock into the cart
  with nobody having authorised it leaving the warehouse.
- **`APPROVED → REJECTED` is not legal.** The source has already been deducted; "rejecting"
  at that point would leave the stock recorded nowhere at all.

The same table drives the server's guards *and* the `canApprove` / `canReject` / `canComplete`
flags the API returns, so the buttons the UI offers and the transitions the server accepts
cannot drift apart.

---

## 2. Transactional guarantees

Both stock-moving steps are interactive Prisma transactions in
`backend/src/infrastructure/database/repositories/stock-transfer.prisma-repository.ts`.

### Approve — deduct the source

Inside one transaction:

1. Re-read the transfer **inside** the transaction and re-check the state machine.
2. Lock every source row:

   ```sql
   SELECT id::text AS id, name, current_quantity
   FROM inventory_items
   WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
   ORDER BY id
   FOR UPDATE
   ```

3. Check availability against the **locked** values, collecting *all* shortfalls before
   throwing, so a five-line transfer reports every problem at once rather than one per retry.
4. Deduct each quantity.
5. Write a `TRANSFER_OUT` history row per item.
6. Set status `APPROVED`, stamp the reviewer and timestamp.

### Complete — credit the destination

Inside one transaction: find-or-create the matching cart item (case-insensitive name match
against live rows only), add the quantity, write `TRANSFER_IN` history per item, set status
`COMPLETED`.

The destination item is created on demand, so the first transfer of a new product to the cart
does not require someone to pre-create an empty record.

### Three specific hazards, and what handles them

**Lost updates.** Availability is checked against row-locked values, never against a value
read before the transaction. There is no read-then-write window.

**Deadlock between two concurrent approvals sharing items.** Rows are locked in a
deterministic order — the id list is de-duplicated and sorted before the locking query — so
two transactions touching an overlapping set acquire them in the same sequence and one simply
queues. `maxWait` / `timeout` are raised to 10s / 20s so that legitimate queueing is not
turned into a failed request.

**History diverging from stock.** History rows are written *inside* the same transaction as
the quantity change. This was a real defect during development: history was originally written
after the transaction committed, which produced 7 committed quantity changes but only 5
recorded — so a rollback lost the audit of what it rolled back.

### Availability is deliberately *not* checked at request time

Requesting more than is currently on the shelf is legitimate — stock may arrive before the
request is reviewed. Checking at request time would also be a false guarantee, since the
number is stale the moment it is read. Approval checks it against locked rows, which is the
only point where the answer is authoritative.

The UI still *shows* an availability warning while composing a request. It advises; it does
not block.

---

## 3. Database-level invariants

These hold regardless of application code, which is the point — a future script writing
directly to the database cannot violate them.

```sql
CREATE SEQUENCE IF NOT EXISTS "stock_transfer_reference_seq" AS bigint START WITH 1;

ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_quantity_positive"
    CHECK ("quantity" > 0);

ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_distinct_locations"
    CHECK ("from_location" <> "to_location");

ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_rejection_requires_note"
    CHECK ("status" <> 'REJECTED' OR ("review_note" IS NOT NULL AND "reviewed_by_id" IS NOT NULL));
```

The last one is the interesting one: a rejection without a recorded reason and reviewer is
unrepresentable. "Someone rejected this, we don't know who or why" is not a state the
database will store.

References (`TR-000001`) come from a **sequence**, not `count(*) + 1`, which would hand the
same reference to two concurrent requests.

Quantities are `Decimal(12,3)`, never `Float` — 0.1 + 0.2 must equal 0.3 for stock.

---

## 4. Audit trail

Every transition is recorded in `audit_logs` with the actor, IP, and metadata:

| Action | Recorded metadata |
|---|---|
| `transfer.created` | reference, line count, each item and quantity |
| `transfer.approved` | reference, and per item the `from` → `to` quantity actually applied |
| `transfer.rejected` | reference, the reason given |
| `transfer.completed` | reference, and per item the `from` → `to` quantity applied |
| `transfer.approval-refused` | reference, and **why** it was refused |

Two details worth keeping:

**Refusals are audited, not just successes.** A repeated failed attempt to approve a transfer
with insufficient stock is exactly the pattern worth being able to see later. Since a refusal
is the rare path, the reference is looked up only when one occurs, so the common path costs
nothing extra.

**The refusal reason is recorded, not inferred.** This action was originally named
`transfer.insufficient-stock`, which mislabelled *state* violations ("already approved") as
stock problems. It is now `transfer.approval-refused` with the actual reason in metadata.

Alongside the audit log, each affected item gets an inventory history row (`TRANSFER_OUT` /
`TRANSFER_IN`), so the item's own timeline explains every quantity change.

---

## 5. Permissions

| Operation | Permission | Admin | Store Manager |
|---|---|---|---|
| List / details / summary | `TRANSFER_READ` | yes | yes |
| Request a transfer | `TRANSFER_CREATE` | yes | yes |
| Approve (deducts source) | `TRANSFER_APPROVE` | yes | **no** |
| Reject | `TRANSFER_APPROVE` | yes | **no** |
| Complete (credits destination) | `TRANSFER_COMPLETE` | yes | yes |

**Approval is the control point** — the moment stock actually leaves the warehouse — so the
person who raises a request cannot also authorise it.

**Completion is deliberately not restricted the same way.** Whoever is running the cart
confirms what arrived; blocking that would leave dispatched stock stranded in transit with no
way to record its arrival.

**Approve and reject share one permission.** They are the same decision with two outcomes.
Separating them would allow granting someone the power to reject everything but approve
nothing, which is not a role anyone wants.

---

## 6. API

All routes require authentication; `authenticate` is applied to the router itself so a newly
added route cannot accidentally be public.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/transfers` | Paginated, filter by status, search by reference or item name, sortable |
| `GET` | `/api/v1/transfers/summary` | Counts per status |
| `GET` | `/api/v1/transfers/:id` | Details with lines and the decision timeline |
| `POST` | `/api/v1/transfers` | Request a transfer (max 50 lines) |
| `POST` | `/api/v1/transfers/:id/approve` | Deducts the source |
| `POST` | `/api/v1/transfers/:id/reject` | Reason required, min 3 characters |
| `POST` | `/api/v1/transfers/:id/complete` | Credits the destination |

`/summary` is declared **before** `/:id`, or "summary" would be parsed as an id and rejected
by UUID validation.

Direction is not a request parameter. It is fixed at Home Warehouse → Cart, because accepting
a parameter would imply the reverse direction works. The schema stores both endpoints, so
adding a return leg later needs no migration.

Request-time validation rejects: an empty transfer, the same item listed twice (combine the
quantities instead), an item not held at the source, an inactive item, and a fractional
quantity for a discrete unit such as boxes or pieces.

### Summary uses raw SQL

```sql
SELECT count(*) FILTER (WHERE status = 'PENDING')   AS pending,
       count(*) FILTER (WHERE status = 'APPROVED')  AS in_transit,
       count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
       count(*) FILTER (WHERE status = 'REJECTED')  AS rejected
FROM stock_transfers
```

Not `prisma.stockTransfer.groupBy()`. On this stack (Prisma 7 with the `pg` driver adapter)
`groupBy` failed with Postgres error `08P01` — *"bind message supplies 1 parameters, but
prepared statement requires 0"* — which broke every page load of the transfers screen. One
`count(*) FILTER` aggregate is also a single scan rather than a group-and-count.

---

## 7. Frontend

`frontend/src/app/features/transfers/`

| Piece | Responsibility |
|---|---|
| `transfer.service.ts` | Stateless HTTP calls |
| `transfer-store.service.ts` | Signal store: list, filters, pagination, summary |
| `pages/transfer-list/` | The work queue, with per-status stat cards |
| `create-transfer-dialog/` | Multi-line editor with live availability warnings |
| `transfer-detail-dialog/` | Timeline plus the actions the current user may take |
| `reject-transfer-dialog/` | Captures the mandatory reason |

**Which actions appear** is the intersection of the server's `canApprove` / `canReject` /
`canComplete` flags and the user's permissions. The server remains the authority; the UI just
avoids offering buttons that would fail.

**Approval asks for confirmation** before it fires, because it moves real stock.

**On failure the dialog refetches** rather than leaving a stale view — if the action failed
because someone else already acted, the user sees the current truth immediately.

The store loads on an explicit `load()` call rather than from a reactive effect, and carries a
request sequence number so a slow response cannot overwrite a newer one.

---

## 8. What has been verified

Against real PostgreSQL, with a real browser driven over CDP.

**93/93 API checks** — the full state machine including every illegal transition; both stock
legs applying correctly; atomic rollback leaving stock untouched when one line of a multi-line
transfer is short; conservation of total quantity across a full request → approve → complete
cycle; the permission split (a Store Manager receives 403 on approve); audit log contents
including refusals; and all three database invariants.

**Concurrency, specifically:** two simultaneous approvals of the same transfer — exactly one
succeeds, stock is deducted exactly once (12 → 10, not 12 → 8), and the loser gets a clean
`400 BUSINESS_RULE_VIOLATION` reading *"Transfer TR-000034 has already been approved."* This
last part was a real fix: the loser originally returned a 500, because a stale
non-transactional pre-read was being used before the transaction.

**84 unit tests**, 16 of them on the transfer state machine and entity guards — including that
no transition at all is possible out of a terminal state, checked against every status rather
than the two that came to mind.

**63/63 UI checks** — creating a multi-line transfer with availability warnings; a Store
Manager seeing no approve button; an admin approving and the source dropping `30 → 20`;
completing and the cart item being created at 10 kg; conservation visible as 20 + 10 = 30;
rejection with a mandatory reason; filtering, searching and sorting; the mobile card layout
below 600px; and the audit entries and `TRANSFER_OUT` / `TRANSFER_IN` history rows.

Backend: `tsc --noEmit`, `eslint --max-warnings 0`, `prettier --check`, `vitest run` (84
passing), `npm run build` — all clean. Frontend: `typecheck`, `lint`, `prettier --check`,
`build` — all clean, zero warnings, 141 kB initial gzip.

## 9. What has *not* been verified

**Behaviour under heavy concurrent load.** Local testing runs against `prisma dev`, which is a
proxy in front of Postgres with its own `connection_limit=10`. Under 20 concurrent requests it
drops connections with `ECONNRESET` — and this reproduces with plain `pg` and no Prisma or
application code involved, so it is a property of the local proxy, not of this system. The
connection pool is therefore sized at 4 locally to leave the proxy headroom, and 10 in
production. **Production should be sized against Neon's per-branch connection ceiling for the
plan in use, not against that number** — interactive transactions pin a connection for their
whole duration, so this needs deliberate sizing rather than a copied default.

What this means concretely: correctness under *contention* is verified (the two-simultaneous-
approvals test passes reliably). Throughput and stability under *sustained parallel load* are
not, and cannot be from this environment.

**No load, soak, or failover testing** against a production-like database.

**No automated integration or E2E test suite is committed.** The 93 API and 63 UI checks were
run as scripts during development, not wired into CI. The 84 committed unit tests cover the
domain layer only. Turning those scripts into a committed suite is the most valuable next step
for this feature.

**Partial completion is not supported.** A transfer completes in full or not at all. If nine of
ten boxes arrive, the current model has no way to record that — the transfer would have to be
completed in full and the discrepancy corrected as a separate inventory adjustment.

**No cancellation.** A `PENDING` transfer can only be approved or rejected, and an `APPROVED`
one can only be completed. Stock dispatched in error must be corrected with a manual inventory
adjustment, since `APPROVED → REJECTED` is deliberately illegal.
