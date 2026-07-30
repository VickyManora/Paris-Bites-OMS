# Analytics

Revenue, cost and movement over a period you choose, on one page and in one request.

---

## What it answers

| Metric | Source |
|---|---|
| Revenue | daily sales entries, split by channel and tender |
| Food cost | consumption valued at each item's purchase price, against revenue |
| Inventory value | stock on hand at cost — **today, not the period** |
| Most used ingredients | consumption lines, ranked by quantity |
| Top selling products | POS order lines, ranked by units |
| Counter takings | POS orders — shown beside declared revenue, never added |
| Revenue trend | bucketed by day, week or month |
| Purchase trend | supplier invoices, same buckets |
| Transfer trend | transfers raised, same buckets |

### Top selling products — now answered

This section used to say the metric was impossible: a daily total per channel has no product
in it. The **POS changed that**, and the `unavailable` entry that explained the gap is gone.

Products are ranked by units with a share of POS revenue, and the one remaining caveat is
stated on the page: the ranking covers **counter trade only**, because aggregator orders are
still declared as a daily total with no items.

Counter takings appear as a separate "Through the till" tile, captioned as a *share of*
declared revenue (`66.1%`) rather than a figure to add — the two describe the same walk-in
trade from two sources. See [POS.md](./POS.md#declared-versus-counter).

The `unavailable` array remains in the payload and the page still renders it when it is
non-empty, so the next genuine limitation reaches the exports the same way this one did.

---

## One request, one range

Every figure comes from a single `snapshot()` in one transaction. Splitting them across
calls would let a headline tile and the chart beneath it disagree after a write landed
between the two, and on a page whose entire job is comparison that is worse than being slow.

Both dates are **required** — there is no implicit default range. An analytics number
quoted without its period is the easiest thing in the app to misread, so the caller has to
say, and the response echoes the range back.

Presets carry a grain that suits them: a year at daily grain is 365 unreadable bars, a week
at monthly grain is one. They resolve against *today at click time*, so a tab left open
overnight does not keep showing yesterday's "last 30 days".

---

## The shared time axis

All four trends are bucketed by **one** `generate_series` in **one** statement:

```sql
WITH buckets AS (SELECT generate_series(…, …, '1 month'::interval)::date AS period),
     sales AS (…), cost AS (…), purch AS (…), xfer AS (…)
SELECT b.period, coalesce(s.revenue, 0), coalesce(c.cost, 0), …
FROM buckets b LEFT JOIN sales s ON … LEFT JOIN cost c ON … …
```

Four separately-bucketed queries would each be defensible and would still drift by a day at
the edges — which is exactly where someone draws a conclusion from a purchase spike sitting
next to a revenue dip. Identical categories, including the empty ones, is the point.

The granularity reaches `date_trunc` through a **closed lookup**, never interpolated — the
same rule the report repository follows for `ORDER BY`.

---

## Refusing to overstate

This is the page's recurring theme, and most of its code.

**Revenue says how much of the range was entered** — "5 of 30 days · ₹7,048/day". The
average is per *recorded* day, not per calendar day; dividing by the range would report a
lower average for anyone who does not trade daily.

**A partially-entered bucket is marked.** A month bar built from three entered days is not
a month's revenue. The bucket carries `salesDaysRecorded` and `salesDaysInPeriod`, the chart
appends `*` to the label — so the caveat survives the chart being screenshotted away from
the note beneath it — and the note says how many.

Buckets at either end of the range have their day count **clipped to the range**, so a part
month is judged against the days actually requested rather than against a whole one.

**Food cost is flagged when the cost side is incomplete.** Every consumed line whose item
has no purchase price counts as costing nothing, which makes the ratio *flattering* rather
than merely imprecise — it reads as a healthy margin when the truth is unknown. That earns a
banner rather than a caption:

> **Food cost is understated.** 16 of 17 consumed lines are for items with no purchase
> price, so they counted as costing nothing. Set prices on those items in Inventory to get a
> real figure.

`percent` is **null**, never `0` or `Infinity`, when there is no revenue: a ratio against
zero is not a number, and either stand-in would be charted as though it meant something.

**Inventory value is labelled "today" on every surface** — tile caption, footer, Excel note
and PDF note. It is the one figure on a period-scoped page that ignores the period, because
there is no stock ledger to reconstruct a historical valuation from, and without the label
it reads as "inventory value during July".

**An unpriced ingredient shows "unpriced", not ₹0.00.** Not knowing a cost is not the same
as it being free, and a zero would drag down any total the reader computes.

---

## Export

`GET /analytics/export?format=xlsx|pdf`, re-running the same query server-side. A file built
from figures the browser supplied would be a file anyone could put any number into.

**Excel: one sheet per dataset** — Summary, Trend, Revenue by channel, Most used
ingredients. Not one sheet with four tables stacked down it, which is why exported
dashboards get opened once: nothing can be sorted or filtered without dragging a selection
around a block. Numbers stay numbers with a currency format. Every caveat has its own
`Notes` column, and the trend sheet carries a `Complete?` column per row — a spreadsheet
gets sorted, at which point a partial month next to complete ones is otherwise invisible.

**PDF: portrait**, unlike the landscape report tables, because this is a stack of figures
and short tables rather than a nine-column grid. Caveats are printed in red beside the
figures they qualify; on paper there is no tooltip to recover them from.

### `Rs.`, not `₹`, in PDFs

pdfkit's built-in fonts are the PDF standard fourteen, which use WinAnsiEncoding — a
character set that predates the rupee sign (U+20B9, 2010) and has no glyph for it. Every
amount rendered as `ˡ35,240.00`. The bytes were valid and the page count was right, which is
why it survived a round of "does the PDF parse" checks; only *looking* at one found it.

The fix is `Rs.`, shared by both PDF exporters in `pdf-support.ts`. Embedding a font that
carries the glyph would cost half a megabyte of binary for one character. Excel and the
browser render `₹` correctly and keep using it.

---

## Permissions

`REPORT_VIEW_FINANCIAL` — admin-only, for the whole page.

The three figures it exists to show are revenue, stock valuation and food cost. The two that
are not financial — ingredient usage and transfer volume — are already available to a Store
Manager through the consumption and transfer reports. Projecting this page per figure, the
way the reports module does, would leave a manager with two tiles and four empty charts,
which is a worse answer than withholding it whole.

---

## Guards

| Guard | Why |
|---|---|
| Both dates required | an unstated period is the easiest number here to misquote |
| Start on or before end | refused in the page before the request, so the fix is local |
| Range ≤ 1,096 days | three years at daily grain is a thousand buckets no chart renders and a scan of every table it touches |
| Granularity from a closed set | it reaches `date_trunc` as an identifier |

---

## Verified

Twenty-one browser checks plus figures reconciled by hand against the database:

- revenue, its cash/online split and its per-channel split all add back to the same total;
- day, week and month grains re-bucket the axis, with part periods clipped to the range and
  marked;
- an understated food cost raises the banner, and a zero-revenue range reports `—` rather
  than a ratio;
- inventory value is labelled "today" on the tile, in the footer, and in both exports;
- both exports download, and the workbook's four sheets carry the caveats;
- the PDF renders `Rs.` correctly with no blank pages — checked by rendering it, not by
  parsing it;
- a backwards range is refused in the page; a four-year range is refused by the API;
- a Store Manager gets no sidebar entry and is redirected away from `/analytics`;
- no horizontal scroll at 390 px.

All sales data created during verification was removed afterwards.
