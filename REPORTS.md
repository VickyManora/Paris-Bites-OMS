# Reports

Nine reports over the data the rest of the app records — inventory, purchases, transfers,
consumption, suppliers, low stock, sales, POS orders and product sales — each filterable,
sortable, chartable, and downloadable as Excel or PDF.

The design goal was **one definition per report, three renderings**. A report says once
what its columns are; the table, the spreadsheet and the PDF all read that. Adding a column
is a one-line change that appears in all three, and none of them can drift from the others.

---

## The shape of a report

`ReportDefinition` (`backend/src/core/application/reports/report-definitions.ts`) is the
single source of truth:

```ts
{
  id: ReportId.INVENTORY,
  label: 'Inventory',
  description: 'Every active item with its stock level, reorder point and value.',
  permission: Permission.REPORT_VIEW,
  supportsDateRange: false,   // inventory is a snapshot, not a period
  supportsLocation: true,
  supportsSupplier: false,
  searchHint: 'Item name or notes',
  sortFields: ['name', 'category', 'currentQuantity', 'stockValue'],
  defaultSortField: 'name',
  defaultSortDirection: 'asc',
  columns: [
    { key: 'name',       header: 'Item',      type: TEXT,   width: 28 },
    { key: 'stockValue', header: 'Value',     type: MONEY,  width: 14,
      total: true, financial: true },
    …
  ],
}
```

Three flags carry most of the behaviour:

| Flag | Effect |
|---|---|
| `type` | How the value renders — right-aligned and `₹`-prefixed for `MONEY`, a real number in Excel, `—` when null |
| `total` | Included in the totals row and the stat cards above the table |
| `financial` | Withheld entirely from callers without `REPORT_VIEW_FINANCIAL` |

`supportsDateRange` / `supportsLocation` / `supportsSupplier` drive the filter bar. The UI
renders only the filters the report honours, so a control on screen always affects the rows
beneath it.

---

## Filters, and saying what they are

Every response carries `appliedFilters` — the filters in force, already worded for a human
(`"2026-07-01 to 2026-07-31"`, `search: "chocolate"`, `location: Home Warehouse`). It is
shown above the table and **printed onto every exported file**.

This is not decoration. A spreadsheet of eleven invoices says nothing about whether that is
the year or one week, and separated from the screen it came from it will be read as the
former. The wording is generated once, server-side, so the file and the screen cannot
disagree about what they contain.

Switching reports drops filters the new report does not honour rather than carrying them
across. A date range still visible in the bar while the query ignores it is a lie about the
rows.

---

## Totals are over the filtered set, never the page

The totals row and the stat cards are computed by **SQL aggregates over the whole `WHERE`
clause**, not by summing the rows in hand:

```ts
// Over the whole filtered set, not the page. A totals row beneath "1–25 of 214"
// that sums only what is visible is read as the total and is wrong by definition.
totals: { stockValue: num(counted[0]?.stock_value) },
```

An early version summed the mapped page and reported `₹2,700` for a 40-row inventory worth
`₹16,694` — a number that looks entirely plausible and is simply false. The stat cards also
label their scope (`across all 40 rows`), because a total beside a paginated table is read
as the page's total unless it says otherwise.

Paging is the test: the figures must not move when you change page or page size.

---

## Exports

`GET /reports/:id/export?format=xlsx|pdf`. Both go through `IReportExporter`, and both
receive the **whole filtered set** — paging is explicitly cleared:

```ts
// No paging: an export is the whole filtered set.
//
// Exporting the page on screen is the classic version of this feature and it is wrong —
// someone filters to a quarter, sees "1–25 of 214", exports, and files a spreadsheet of
// 25 rows as the quarter's figures.
const filters = resolveSort(definition, { ...input.filters, page: undefined, pageSize: undefined });
```

**Excel** (`exceljs`). Numbers stay numbers: a money cell holds `1416` with a `₹#,##,##0.00`
*format*, not the string `"₹1,416.00"`. The entire reason to export to a spreadsheet is to
sort, filter and total it yourself, and a grid of pre-formatted text does none of that. The
sheet gets a header block (title, description, who generated it, the filters), an
autofilter over the data, and frozen panes.

**PDF** (`pdfkit`). Amounts print as `Rs. 1,416.00`, not `₹1,416.00`: the built-in PDF
fonts use WinAnsiEncoding, which has no glyph for the rupee sign, so `₹` rendered as
`ˡ1,416.00` in every exported file. The bytes parsed and the page count was right, which is
why it took *looking* at one to find. See `pdf-support.ts`. Landscape A4 — these tables are seven to nine columns wide and portrait
would clip them. The column header repeats on every page, rows are banded, and the footer
reads `Page 3 of 7`, which is the part that tells a reader whether a printout is complete.
`pdfkit` rather than a headless browser: the output is a table, and shipping Chromium to a
container for it costs 200 MB.

Both writers build in memory, so exports are capped at `MAX_EXPORT_ROWS` (10,000). When the
cap bites, the file **says so on its own face** rather than quietly ending — a spreadsheet
that silently stops at row 10,000 looks complete and is not.

---

## Permissions

Two permissions:

- `REPORT_VIEW` — inventory, transfers, consumption, suppliers, low stock
- `REPORT_VIEW_FINANCIAL` — additionally the purchase, sales, POS orders and product sales
  reports, and every column marked `financial` in the others

Enforcement is **projection, not hiding**. For a caller without the financial permission:

- the column is removed from `columns`,
- the value is removed from every row, so it is not in the JSON at all,
- its entry is dropped from `totals`,
- a chart that plots money is withheld entirely — the inventory valuation donut hands over
  the same figures in a different shape,
- `GET /reports` omits the reports they cannot run, so the picker cannot offer a 403.

`authorise()` is shared by the run and export use cases, so the two cannot disagree about
who is allowed what. An export that enforced less than the screen would be the more
dangerous of the pair — and it is checked directly: a Store Manager's exported inventory
workbook has no `Value` column and no currency-formatted cell anywhere in it.

Permissions come from the authenticated role and are never read from the request.

---

## Sorting

`sortField` is a free string at the HTTP boundary and resolved against the report's own
`sortFields` in the use case; anything unrecognised falls back to the report's default. The
repository then maps the field name to a column through a fixed lookup:

```ts
const column = map[filters.sortField ?? ''] ?? map[fallback] ?? fallback;
return Prisma.sql`ORDER BY ${Prisma.raw(column)} ${direction}`;
```

`Prisma.raw` is reached for only after the value has passed through a closed map, so no
caller-supplied string ever reaches the SQL.

---

## The page

One Angular page for all seven reports (`features/reports/pages/reports/reports.page.ts`),
because they are the same shape of thing — filter a set of rows, look at it, take it away
as a file — and seven near-identical pages would drift apart within a month.

**The columns are not declared in the frontend.** They arrive with the data and are turned
into `TableColumn<ReportRow>` at runtime. That is what lets one table render an invoice
ledger and a stock list, and it is what makes the permission rule work without the UI
knowing it exists: the payload simply has no cost column, so no cost column is drawn.

The selected report and its filters live in the URL (`?report=purchase&from=…&search=…`),
so a filtered view is a link you can paste to someone. Navigation uses `replaceUrl` so a
debounced search box does not fill the back button with one entry per keystroke.

Below `sm` the table becomes one card per row, reusing the same column definitions.

---

## REST API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/reports` | Reports this caller may run |
| `GET` | `/api/v1/reports/:id` | Run one. `page`, `pageSize`, `search`, `fromDate`, `toDate`, `location`, `supplierId`, `sortField`, `sortDirection` |
| `GET` | `/api/v1/reports/:id/export?format=xlsx\|pdf` | Whole filtered set as a file |

Dates are `YYYY-MM-DD` and parsed as UTC midnight — a calendar day, never re-interpreted in
a timezone. The export sets `Content-Disposition: attachment` plus
`Access-Control-Expose-Headers`, without which the browser cannot read the filename
cross-origin and saves the file under a generated name.

---

## The sales report

One row per trading day, with the four channel buckets pivoted out of the lines by filtered
aggregates in SQL rather than transposed in JavaScript. Days are never synthesised: a day
with no entry is absent, because its takings are unknown and a zero row would assert the
business took nothing. The dashboard is what names the missing days.

Its chart is a channel donut computed from the **totals**, not the page — the question
"where does revenue come from" is about the whole filtered period, so a donut of one page
of days would answer a question nobody asked. (The supplier report charts its own rows for
the opposite reason: "who are the biggest of the ones listed" *is* about the page.)

---

## The POS reports

**POS orders** is the itemised detail behind the walk-in half of the sales report — *not*
extra revenue on top of it. Anyone adding the two together is double-counting the same trade,
which is why the description names whose record it is. Cancelled orders appear as rows with
their status shown, but are excluded from the money totals: the row count is honest about what
happened, the footer is honest about what was taken.

**Product sales** is the report the declared daily totals cannot produce. Ranked by units, with
a weighted average price so a discounted line pulls the average down honestly, and a share
column against POS revenue. Paid orders only — a cancelled order's items were not sold.

Both cover counter trade only, because aggregator orders are declared as a daily total with no
items in them.

---

## Verified

Exercised end to end against the real database and a real browser
(33 checks, admin and Store Manager):

- all seven reports render, chart and page;
- filters, search and sorting change the rows, and are stated on screen;
- totals do not move when the page or page size changes;
- both exports download, parse, and contain the filtered set — money cells are numeric,
  PDFs are valid and multi-page;
- a filtered export is smaller than an unfiltered one (the filters really reach the file);
- a pasted URL restores the report and its filters;
- a Store Manager sees five reports, no cost columns, no valuation chart, no `₹` anywhere,
  a 403 on the purchase report, and a stripped export;
- no horizontal page scroll at 390 px, rows render as cards.
