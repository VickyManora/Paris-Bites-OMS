# Daily sales

One hand-entered total per trading day, split by channel and payment method. Recorded by
an admin at close of business, correctable afterwards with the correction on the record.

---

## What this is, and what it deliberately is not

**It is a daily figure, not a record of each sale.** There is no product, no quantity, no
customer and no order. A day is four numbers:

| Bucket | Meaning |
|---|---|
| Walk-in — cash | notes and coins counted at the cart |
| Walk-in — online | UPI and card taken at the cart |
| Zomato | order value, before commission |
| Swiggy | order value, before commission |

That is the shape the business actually works in. There is no till that itemises, so a
per-order model would be filled in from memory or not at all, and a total that genuinely
gets entered every evening is worth more than a line-item model that does not.

Two consequences follow, and both are worth stating plainly rather than discovering later:

**Ingredient usage cannot be derived from a sale.** Recipe-driven stock deduction needs to
know which desserts were sold; a rupee total cannot say. Stock is drawn down by the
[consumption module](./CONSUMPTION.md), which is entered separately. The `Recipe` and
`RecipeIngredient` tables exist and are still unused — they become useful the day sales are
captured per product, not before.

**Discounts are not modelled.** The figure entered is **net** — what was actually received.
That is the only number that reconciles against a bank statement or a cash count, and a
gross figure plus a discount field would produce two numbers that can disagree.

---

## One entry per day

The rule the whole module hangs on. It is enforced by a **partial unique index** on
`entry_date WHERE deleted_at IS NULL`, hand-written in the migration because Prisma cannot
express one:

```sql
CREATE UNIQUE INDEX "daily_sales_entries_entry_date_live_key"
    ON "daily_sales_entries" ("entry_date")
    WHERE "deleted_at" IS NULL;
```

Partial rather than plain, so a day soft-deleted in error can be re-entered instead of
having its date reserved forever.

The use case also checks before writing, but only for the error message: the index is what
holds when two submissions race, and a read-then-write check alone would let both pass and
double-count the day.

The form uses the same fact more usefully. **Picking a date that has already been recorded
switches the dialog into correcting that day, pre-filled**, rather than letting someone key
in four figures and meet a conflict on submit.

---

## The till fills the form in

The counter already knows what it took. Retyping it at close was duplicate data entry, and the
dashboard's headline sales figure sat at an em dash all trading day while the POS two tiles over had
the answer.

Two places changed, both display-and-prefill only:

**The dashboard hero** shows the till's revenue when the day is unrecorded, captioned
`₹298 cash · ₹447 online at the counter`, with an amber `From the till · not yet confirmed` badge and
a `Confirm today's takings` button. It is still an em dash when there is genuinely nothing — "no
declared entry yet" and "no idea what today took" are different facts and only the second deserves a
blank. It is never `₹0.00` on an unrecorded day, for the reason already given above.

**The form** prefills Walk-in — cash and Walk-in — online from `GET /pos/summary?date=`, and says so
in an info panel naming the order count and the split.

### Why this is a prefill and not the answer

Declared sales and POS orders are two records of the same walk-in trade, and this app **compares**
them rather than adding them — `walkInReconciliation` on the dashboard ships the variance, and
[ANALYTICS.md](./ANALYTICS.md) states the same for the "Through the till" tile. Writing the till's
figure straight in would make that variance identically zero and it would stop detecting anything: an
order rung up wrong, an order never rung up at all, a short drawer.

So the fields stay editable and the panel says *"Count the drawer and correct the cash figure if it
differs."* The cash count stays a real count; only the typing is gone. Note the asymmetry that makes
this safe — a drawer **can** be counted independently, whereas the UPI total simply *is* whatever the
QR recorded, so there was never anything to cross-check on that half.

### Three guards worth keeping

**Scope.** `/pos/summary` answers within the caller's permission: a manager sees only their own
orders and the payload says `scope: 'own'`. Prefilling from that would seed a whole day's declared
takings with one operator's shift while looking authoritative — a silent under-report, worse than an
empty field. Only `all` is offered.

**Empty fields only.** By the time the request resolves the user may already have typed. Overwriting
what somebody entered is never the friendlier behaviour.

**Never when correcting.** Switching the dialog to an existing day drops the offer entirely.
Overwriting stored figures with the till's would destroy the independent count that is the point of
storing them, and a prefill hint pointing at fields the user did not fill would misdescribe where
those numbers came from.

A failed request is swallowed. This is a convenience on top of a form that worked without it; an
error banner about the till would be noise on a screen whose job is entering a figure the user is
holding in their hand.

### What the till figure is not

It excludes aggregators by definition, so on a Zomato day the provisional dashboard number is
genuinely lower than the day's real total. Saying "from the till" on the badge is what keeps that
honest rather than merely decorative.


## Corrections

A day's takings gets corrected — a card machine total read wrong, an aggregator payout
reconciled days later. Every correction:

- replaces the whole set of figures (a day is one statement, not four independent ones),
- bumps the revision number,
- appends a `DailySalesEntryRevision` row holding the new lines, the new total **and the
  previous total**,
- **requires a reason** when it is genuinely a correction — see below.

The reason is not optional politeness. Revenue is the number the business is judged on, and
one that changed with no explanation attached is worse than one never corrected — the trail
exists so a later reader can tell a reconciliation from a mistake.

### Completing a day is not correcting one

A reason used to be demanded for *every* edit, and that was wrong about how the shop works. The
counter total goes in at close; Zomato is added later, once the platform settles. Filling a bucket
that held nothing states something new and contradicts nothing, so asking "why is this changing?"
for the second half of a normal evening only teaches people to type a character to get past the
prompt — which costs the trail more than it gains.

`UpdateDailySalesUseCase.classifyChange` sorts an edit into three cases by comparing the submitted
buckets against the stored ones:

| Kind | What happened | Reason |
|---|---|---|
| `completing` | every change fills a bucket that held nothing | not required; the revision note is auto-written as e.g. `Added Zomato` |
| `correcting` | a bucket that held a figure now holds a different one | **required** |
| `unchanged` | amounts identical, only notes moved | not required; note reads `Notes updated` |

Two things are easy to get wrong here and are settled deliberately:

**A reduction is a correction, including to zero.** "Zomato was 1,240 and is now nothing" is a claim
about a figure somebody already committed to. The classifier walks the *union* of the stored and
submitted buckets, because the form submits a cleared bucket by omitting it — comparing only the
submitted lines would miss the single most important case.

**A revision always carries a note**, even when the user was not asked for one. A blank entry
against a changed total is what makes a later reader distrust the whole history.

The schema no longer pretends to enforce this: `reason` is optional in `updateDailySalesSchema` and
required by the use case, because only the use case can see the previous amounts. The client applies
the same rule to show and hide the field as the user types, and the server stays the authority.

Editing is deliberately not gated behind a higher permission than recording. A figure fixed
the same evening is ordinary work, and putting it out of reach would only mean the wrong
number stays.

There is **no delete route**. A day recorded in error is corrected, not erased: the totals
feed month-to-date figures, and a day that silently vanished would leave a gap nobody can
explain. Soft delete exists on the repository for a future admin tool.

---

## Why lines rather than four columns

`DailySalesLine` is a row per (channel, payment mode) instead of four columns on the entry.
Adding a channel — a third aggregator, a catering line — becomes data rather than a
migration plus a change in four layers.

Payment mode sits on the line rather than being implied by the channel, because "how much
of today was cash" is a question about a *day*, not about a channel, and answering it from
a channel enum would need a second table the moment that changed.

**A zero is not stored.** "No Swiggy orders today" and "Swiggy was not part of this entry"
are the same statement for a total. The DTO fills every bucket back in, so neither the form
nor the table has to know that an absent line means zero.

The channel/payment pairs are a **closed set** checked in the use case: Zomato paid in cash
is not a combination this business has, and accepting it would put a figure in the database
that no screen offers and no report expects.

---

## Guards

| Guard | Why |
|---|---|
| No future dates | almost always a typo in the month, and it silently corrupts every date-ranged figure |
| No negative amounts | a refund-heavy day is still a smaller positive number |
| Cap of ₹1,00,00,000 per bucket | a slipped decimal poisons every average and chart axis, and nobody notices for weeks |
| At most two decimal places | rupees and paise; more is a paste error |
| At least one non-zero figure | a day with no trade does not need an entry |

The date is parsed as **UTC midnight** and stored in a `DATE` column. A value carrying a
local offset can land on the previous day once Postgres casts it, which would file a
Monday's takings under Sunday for anyone east of UTC — including here.

---

## Permissions

`SALE_READ` and `SALE_RECORD`, **both admin-only**.

This is a choice, not an oversight. Revenue is financial data — the same reasoning that
keeps `REPORT_VIEW_FINANCIAL` from a Store Manager applies — and the entry itself is an
admin task: a day is reconciled against a bank statement and two aggregator dashboards,
none of which a manager holds. A Store Manager sees no Selling section in the sidebar and
is redirected away from `/sales`.

Admins receive every permission by construction, so both were granted automatically and
had to be *withheld* explicitly, which is the safe direction.

---

## Totals

The summary endpoint takes the **same filter as the list** and is fetched in the same
`load()`. A totals strip describing a different filter from the rows beneath it is the
specific way this kind of screen misleads people.

The tiles say what they cover — `all recorded days`, or `2026-07-01 to 2026-07-31`, or
`days using Zomato`. An early version kept saying "all recorded days" while a channel
filter was active: the numbers were right and the caption was not, which is worse than
either being wrong alone.

`averagePerDay` is **per recorded day, not per calendar day**. Dividing by calendar days
would silently report a lower average for a business that does not trade daily, and the
caption says which it is.

---

## Where the figures surface

**The dashboard** (admin only) carries a sales row — today's takings, month to date, and
today's cash and platform splits — plus a takings-per-day chart and a revenue-by-channel
donut.

Three things it is careful about:

- **An unrecorded day shows `—`, not ₹0.00.** Those are different facts and only one is
  bad news; a confident ₹0.00 at 6pm on a Saturday reads as "we sold nothing today".
- **The month-to-date total says how much of the month it covers** — "3 of 28 days
  recorded". A month-to-date figure covering three days is not a month's trading.
- **The trend chart omits unrecorded days rather than plotting zero**, and says how many it
  omitted. Unlike stock movement, where a day with no activity genuinely had none, a day
  with no sales entry has an *unknown* figure — drawing it as zero invents a trough.

A day in the window with nothing entered becomes a **task** on the dashboard, linking to
`/sales`. Today is excluded: the takings are entered after close, so it is not late yet.

**The sales report** is the seventh report in [REPORTS.md](./REPORTS.md), with a column per
channel, date filters, sorting and Excel/PDF export. It is gated on
`REPORT_VIEW_FINANCIAL`, which keeps it aligned with `SALE_READ` so the report cannot
become a side door into data the module withholds.

Its grand total sums the **lines**, not the entry's stored total. The line join fans each
day out to one row per bucket, so summing an entry-level column counts every day four
times — an early version reported ₹1,00,360 for three days worth ₹25,090. Summing the same
column the bucket totals do also guarantees the total equals the four figures beside it.

---

## REST API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/daily-sales` | Paginated history. `fromDate`, `toDate`, `channel`, `sortField`, `sortDirection` |
| `GET` | `/api/v1/daily-sales/summary` | Totals over the same filter, no paging |
| `GET` | `/api/v1/daily-sales/by-date/:date` | The day, or `null` — see below |
| `GET` | `/api/v1/daily-sales/:id` | Includes the full revision trail |
| `POST` | `/api/v1/daily-sales` | Records a day |
| `PUT` | `/api/v1/daily-sales/:id` | Corrects one. `reason` required |

`by-date` returns `null` rather than 404 when a day has not been entered. "Not recorded
yet" is the expected answer most of the time — it is what the form asks before deciding
between recording and correcting — and a 404 would make the normal case look like a
failure in the client's error handling.

`PUT`, not `PATCH`: the body is the day's complete desired state. A partial update would
leave the server guessing whether an omitted channel meant "unchanged" or "actually zero",
and those are different days.

---

## Verified

Unit tests (11, covering the derived splits and rounding) plus an end-to-end run against
the real database and a real browser (21 checks):

- a recorded day splits correctly into cash/online and counter/platforms, and the parts add
  back up to the whole on awkward amounts;
- aggregator share is null on a zero day, not 0%;
- the same day twice is refused with a sentence, not a constraint violation;
- future dates, negative amounts, a slipped decimal and Zomato-in-cash are all rejected;
- a correction without a reason is refused by both the form and the API;
- the revision trail records the previous total alongside the new one;
- the channel filter genuinely excludes days that did not use it, and the tiles follow it
  and say so;
- a backwards date range is refused rather than silently returning nothing;
- a Store Manager gets no sidebar entry, and `/sales` redirects to forbidden;
- no horizontal scroll at 390 px.

All data created during verification was removed afterwards; the table is empty and ready
for real figures.
