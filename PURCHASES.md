# Purchase module

Supplier invoices, GST, and the stock they add.

---

## 1. What a purchase is — and is not

A **purchase** is an invoice recorded *after the fact*. The goods have already arrived and
the money is already spent or owed; recording one increases stock immediately, in the same
transaction.

This is deliberately **not** a purchase order. Nothing here is requested, approved or
awaited. A `PurchaseOrder` — the future half of buying — remains a separate, later thing.

**A purchase is immutable once written.** It has already moved stock and money, so a
correction is an inventory adjustment rather than an edit. This is the same rule stock
transfers follow, and for the same reason: a document that can be rewritten after it has
moved goods makes the stock ledger unreconstructable. The only mutable part is the
attached bill, because scanning it is a separate physical step from entering the numbers.

**Recording is not admin-only**, unlike transfer approval. A transfer approval is a
*decision* — it authorises stock to move, so the requester must not also grant it.
Recording a purchase is data entry: requiring an admin would mean invoices pile up
unrecorded while stock silently understates the shelf. The control here is the audit trail
and immutability, not an approval gate.

---

## 2. GST

Three treatments, decided by the supplier relative to the business:

| Treatment | When | Split |
|---|---|---|
| `INTRA_STATE` | Supplier's state == `BUSINESS_STATE_CODE` | CGST + SGST, half each |
| `INTER_STATE` | Different state | One IGST amount |
| `UNREGISTERED` | Supplier has no GSTIN | No tax, no input credit |

**Unregistered wins over the state comparison.** A supplier with no GSTIN charges no GST
even when they are next door, so checking the state first would produce a CGST/SGST split
on an invoice with no tax line at all.

**The treatment is stored on the row, not recomputed on read.** The business could
relocate, or a supplier could register — and a historical invoice must keep reporting the
split it was actually filed with.

**Rates are a fixed list**, not a free number: `0, 0.25, 1.5, 3, 5, 12, 18, 28`. A typo'd
1.8% instead of 18% is a ten-fold tax error nothing downstream would catch. The fractional
rates are real (0.25% on rough diamonds, 1.5% on job work), so the list is the actual
schedule rather than a convenient subset.

**Rounding happens per line, not on the total.** Rounding only at the end would drift from
the sum of the lines printed above it by a paisa or two — exactly the discrepancy that
makes someone distrust the whole screen. The two halves of an intra-state split are
derived as `half` and `lineTax - half`, so they always re-add to the line's tax.

### The client duplicates the arithmetic — on purpose

`computeGstTotals` in `purchase.model.ts` mirrors the server's maths so the record form can
show a running total as you type. A purchase form that cannot show a total until it is
submitted is one nobody can reconcile against the paper bill in their hand.

The duplication is bounded and one-directional: the preview is never stored. The server
recomputes everything from the supplier row and its own rates, and what it returns is what
is displayed from then on. The business's own state comes from `GET /api/v1/` rather than a
frontend constant, so the preview cannot disagree with the server about which split applies.

---

## 3. Database

`suppliers`, `purchases`, `purchase_lines`. Money is `Decimal(14,2)`; per-unit rates are
`Decimal(14,4)`, because a per-gram rate is routinely finer than currency scale and
rounding it to paise before multiplying by 5000 units would visibly miss the invoice total.

Four constraints are **hand-written in the migration** because Prisma cannot express them:

```sql
CREATE UNIQUE INDEX "suppliers_gstin_live_key" ON "suppliers" ("gstin")
    WHERE "deleted_at" IS NULL AND "gstin" IS NOT NULL;
CREATE UNIQUE INDEX "suppliers_name_live_key" ON "suppliers" (LOWER("name"))
    WHERE "deleted_at" IS NULL;
ALTER TABLE "suppliers" ADD CONSTRAINT … CHECK ("state_code" ~ '^[0-9]{2}$');
```

Both uniques are **partial**, scoped to live rows: a soft-deleted supplier must not hold
its GSTIN or its name hostage forever.

`@@unique([supplierId, invoiceNumber])` is the one that matters most. Invoice numbers are
the *supplier's*, not ours, so they are unique per supplier rather than globally — two
vendors may both issue "INV-001". A duplicate within one supplier is nearly always the same
bill entered twice, which would double-count stock, so the database refuses it rather than
trusting every caller to check.

`PurchaseLine` snapshots `itemName`, `unit` and `category`, and `Purchase` snapshots
`supplierGstin` and `supplierStateCode`. A filed invoice must not change meaning because
master data moved on.

---

## 4. Recording a purchase

One transaction does all of it:

1. Create any inline new items at zero quantity.
2. Insert the purchase and its lines.
3. Add each line's quantity to its item, writing a `PURCHASED` history entry.

Stock lands at the **Home Warehouse** only. A line naming a Cart item is rejected rather
than redirected: the two are separate records even for the same ingredient, and silently
picking the other one would credit an item the user did not choose.

**New items can be created inline.** Discovering mid-invoice that an ingredient was never
set up, and having to leave for the inventory screen and come back, is where data entry
gets abandoned half-done. Exactly one of `itemId` and `newItem` must be set per line —
both, or neither, is rejected rather than guessed at, because guessing would either create
a duplicate item or price the wrong one.

`PURCHASED` is its own history action, distinct from `TRANSFER_IN`, because the origin is
outside the business — which is the line a stock-in report has to draw between goods bought
and goods moved between our own locations.

---

## 5. The invoice file

`POST /purchases/:id/invoice`, multipart, field name `invoice`. PDF, JPEG, PNG or WebP, up
to 10 MB.

**The declared MIME type is checked against the actual bytes.** Multer's `fileFilter` runs
before any content exists, so it can only see the header the client claims; the magic-byte
check happens in the controller. A text file renamed `.pdf` is refused.

Stored under an opaque generated name, separate from the user's filename, so an upload
called `../../etc/passwd` cannot influence where bytes land. A SHA-256 of the stored bytes
makes silent corruption or substitution detectable.

Download requires the `Authorization` header, so the client fetches it as a blob and opens
an object URL rather than linking directly — a browser navigation cannot carry the header.

---

## 6. REST API

All routes authenticated, then gated on a capability.

| Method | Path | Permission |
|---|---|---|
| `GET` | `/purchases` | `PURCHASE_ORDER_READ` |
| `GET` | `/purchases/summary` | `PURCHASE_ORDER_READ` |
| `GET` | `/purchases/:id` | `PURCHASE_ORDER_READ` |
| `POST` | `/purchases` | `PURCHASE_ORDER_CREATE` |
| `POST` | `/purchases/:id/invoice` | `PURCHASE_ORDER_CREATE` |
| `GET` | `/purchases/:id/invoice` | `PURCHASE_ORDER_READ` |
| `GET` | `/suppliers`, `/suppliers/options`, `/suppliers/:id` | `SUPPLIER_READ` |
| `POST` `PATCH` `DELETE` | `/suppliers…` | `SUPPLIER_MANAGE` |

`/summary` takes **the same query as the list**, and returns the totals for that filter.
A totals row that ignored the filters would say ₹2,00,000 next to four rows adding to
₹8,000, and the reader would have no way to tell which number answered their question.

On the upload route, authorisation runs *before* the multipart parser: parsing means
buffering megabytes, and doing that for a caller about to be refused is the cheap way to be
DoS'd.

### List query

```
GET /purchases
  ?search=MCC            invoice number or supplier name
  &supplierId=<uuid>
  &gstTreatment=INTER_STATE
  &fromDate=2026-07-01&toDate=2026-07-31   inclusive; toDate is end-of-day
  &hasInvoiceFile=false                    chase missing paperwork
  &page=1&pageSize=25
  &sortField=invoiceDate&sortDirection=desc
```

---

## 7. Frontend

```
features/purchases/
├── models/purchase.model.ts            enums, DTOs, computeGstTotals
├── services/
│   ├── purchase.service.ts             stateless HTTP + blob upload/download
│   └── purchase-store.service.ts       signal-based list state
├── components/purchase-detail-dialog/  lines, GST breakdown, bill upload
└── pages/
    ├── purchase-list/                  history, summary, search, filters
    └── purchase-record/                the multi-line invoice form

features/suppliers/
├── models/supplier.model.ts            state codes, GSTIN pattern
├── services/{supplier,supplier-store}.service.ts
├── components/
│   ├── supplier-detail-dialog/         record + purchase history + remove
│   └── supplier-form-dialog/
└── pages/supplier-list/
```

**A supplier row opens the record, not the editor.** Reading a vendor — who they are and
what is bought from them — is far more common than correcting one, and dropping straight
into a form makes the common case an accidental edit waiting to happen. Edit and Remove are
actions taken from the record.

**The record carries that supplier's purchase history**: spend totals and the five most
recent invoices, both fetched with the same `supplierId` filter so the count describes what
the table is a slice of. "View all invoices" links to `/purchases?supplierId=…`, which the
purchase list reads on entry — so a filtered ledger is a real link rather than an
instruction to go and set a filter.

**Removal reports which of two things the server did.** A supplier with invoices is
*deactivated* — it must keep appearing on them — and one without is removed outright. The
confirmation says which will happen before you agree to it, and the toast afterwards says
which happened; promising removal and then leaving the row visible reads as a failed
delete.

**The record form is a page, not a dialog** — the only form in the app that is. An invoice
has a header, an unbounded list of lines and a totals block; at three lines it already
exceeds a comfortable dialog height, and a dialog that scrolls internally hides the running
total the user is checking against the bill.

**A failure loading the form's reference data is reported, not swallowed.** Defaulting the
item list to empty on error renders a form that looks usable and offers nothing to pick, so
the user retypes their invoice into a dropdown that will never contain their ingredient.
The page shows the error and a retry instead. Only the business state code degrades
quietly, because the form still works without it — the totals simply show no tax split
until it arrives, which is visible rather than misleading.

**The item picker walks every page.** The obvious shortcut — asking for `pageSize=200` — is
wrong: the API caps a page at 100 and answers 422, which surfaced as a silently empty
dropdown during testing. `listAllSelectable()` follows `hasNext` instead, bounded by a
20-page backstop so a server bug degrades to a truncated list rather than an infinite chain.

**The GST treatment is shown, not chosen.** Offering it as a field would let someone file
IGST on a local invoice, and the server would overrule them anyway.

**Only the tax rows that apply are rendered.** Printing "IGST ₹0.00" on an intra-state
invoice invites reading it as a missing figure.

**The supplier form warns on a GSTIN/state mismatch rather than blocking it.** The first two
characters of a GSTIN are the state code, so a disagreement means one of the two is wrong —
and getting it wrong flips every future invoice between CGST/SGST and IGST. It is a warning
because the server is the authority and a legitimate edge case should not be un-saveable.

---

## 8. Verified behaviour

**API — against real Postgres:** all three GST treatments with exact arithmetic
(10 × ₹845.50 @ 18% → CGST ₹760.95 + SGST ₹760.95, line ₹9,976.90; invoice subtotal
₹14,725, tax ₹2,097.90, total ₹16,822.90) · multi-line with two existing items and one
inline new item, created and stocked in the same transaction · automatic stock increase
with `PURCHASED` history carrying before/after, delta and actor · duplicate invoice number
per supplier refused, the same number under a different supplier accepted · invoice upload,
byte-identical download with `nosniff` and `Content-Disposition`, and a text file renamed
`.pdf` refused on its magic bytes · search over invoice number and supplier name · filters
for supplier, GST treatment, date range and missing-bill · sorting, and an unknown sort
field rejected · summary honouring the same filter.

**UI — 28 checks in headless Chrome against the live stack:** Buying nav section · supplier
list with an unregistered vendor labelled rather than blank · supplier creation including
the GSTIN/state warning appearing and then clearing · purchase history with summary tiles ·
GST treatment predicted from the supplier · **the live total matching the server's stored
total exactly (₹2,570.00)** across two lines at different rates · inline new-item fields
appearing on demand · detail dialog showing both lines, the CGST/SGST rows and no IGST row ·
bill attached and the row updating to "Attached" without a reload · search, GST-treatment
and bill-attached filters · a backwards date range reported rather than silently swapped ·
**stock increasing by exactly the quantity bought** (12 kg → 16 kg) · no horizontal scroll
at 390px on either page.

**Supplier management — 27 checks in headless Chrome:** search across name, GSTIN, contact,
city and email · pagination · the record showing every field · purchase history listing the
supplier's invoice with correct spend totals (₹1,416.00 from 3 × ₹400 @ 18%) · "View all
invoices" producing `?supplierId=` and the purchase list applying it on entry, with the
filter control reflecting it · edit from the record, persisted · **both removal outcomes** —
a supplier with no invoices removed outright, one with invoices kept and marked Inactive,
each with the matching confirmation wording · invalid GSTIN and email blocking submission ·
no horizontal scroll at 390px on the list or the record · no 5xx.

### Bugs this work found

1. **`record-purchase.use-case.ts` called `findByNameAtLocation`** — a typo for
   `findByNameAndLocation`. Recording an invoice with a new item would have thrown at
   runtime. The module had never been executed.
2. **A duplicate GSTIN was reported as a duplicate name.** Both supplier uniques are
   hand-written partial indexes, for which Prisma reports no `meta.target`; the fallback
   blamed the name whenever one was supplied, which on create is always. The message named
   a field the user had not got wrong. Now the repository looks up which value actually
   collides and returns a field-scoped error the form attaches to the right input.
3. **Action buttons vanished from two new pages.** `pb-page-header` projects with
   `select="[slot=actions]"`, and content without that attribute is silently dropped.
4. **The item picker requested `pageSize=200`** and got a 422 the form swallowed, leaving
   an empty dropdown with no error.
5. **Supplier delete was unreachable.** `remove()` existed on the list page with a
   confirmation, but no control ever called it — the `D` in CRUD worked over the API and
   not in the app.
6. **Supplier search did not cover email**, while the form collects one and the record
   displays it. Added, and the search placeholder now names every field it actually
   searches.

### Not verified

- **A purchase from a Store Manager's session.** Permissions are declared on the routes and
  the nav respects them, but every check above ran as an admin.
- **Large invoices.** Tested with two and three lines; the API caps at 100 and each line
  locks an inventory row for the transaction's duration.
- **Real scanned bills.** Upload was exercised with a 69-byte PDF and a deliberately
  corrupt one, not a 5 MB phone photo.
*(The concurrent-request 500s that this module first surfaced have since been diagnosed and
fixed — see “The local database serialises” in the README and `DATABASE_POOL_MAX` in
`env.ts`. The record form's load error and retry remain, because a reference-data failure
is still worth reporting honestly rather than rendering an empty picker.)*
