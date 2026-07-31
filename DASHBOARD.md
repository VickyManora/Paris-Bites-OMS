# Dashboard

Two dashboards, one endpoint, one screen per role.

---

## 0. Layout: three weights and named bands

The screen used to be twenty `pb-stat-card`s in five rows of four, then six chart cards, then three
panels — every one the same size, with the same border, and no stated relationship. Nothing on it was
wrong; it gave "today's revenue" and "how many invoices someone typed in" identical billing, so the
reader had to do the ranking the page should have done for them.

**Three weights, and each is three changes rather than one font size.** A hierarchy built only from
type size reads as an accident:

| Weight | Figure | Component | What it is for |
|---|---|---|---|
| Hero | 52px, gold card, proportional figures, optional sparkline | `pb-hero-metric` | **Exactly one per screen.** If you read one number, read this one. |
| Primary | 30px, icon in a tinted tile | `pb-metric-tile` | The three or four you check on purpose. |
| Strip | 18px, tabular figures, several to one surface | `pb-metric-strip` | Everything else. |

**Colour is the fourth channel, and it is rationed.** The hero is the only gold card on the page and
the Business health tiles are the only filled ones. That scarcity is what makes them work: on a page
of white cards a single warm one is found before it is read, and four coloured cards in a band
labelled "is anything wrong" are the answer to that question before any figure on them is parsed.
Everywhere else `tone` tints the icon tile only — a dashboard where four of five tiles are washed
amber has taught its reader to ignore amber.

The strip is where most of the old page went. Sixteen bordered boxes was a lot of chrome spent
flattening a real difference in importance; one divided surface says "these belong together and none
of them is the point".

**Bands, not a grid.** `pb-dashboard-section` gives each group a heading and a one-line qualifier, and
the gap *between* bands (40px) is much larger than any gap inside one (24px). That single ratio does
most of the work of making a dense screen readable.

Admin reads: **Hero KPI → Business health → Sales → At the counter → Inventory → Buying → Tasks ·
Recent activity**. Store Manager reads: Hero KPI → Business health → the consumption prompt → Tasks ·
Recent activity → Inventory, because that role's question is "what do I do now", not "how did the
month go" — so its hero is the workload, and it carries no sparkline, since no history of task counts
exists to draw.

### Business health

The one band whose content *is* its colour. Four signals the page already showed, lifted out of four
different rows and given the billing their severity deserves: out of stock, needing restock, awaiting
approval, and whether the till agrees with what was declared.

**Deliberately not a score.** A single "health: 82%" would be a business rule invented in a template,
and it would hide which of the four needs attention. Each tile is a fact with a tone; the band's
heading names the worst of them so the section says something before anything is read.

Two tones were re-derived when this band split the old combined tile in two, and both were bugs the
split exposed rather than introduced:

- **Restocking is amber, never red.** It used to escalate to danger whenever anything was at zero,
  which was right when one tile carried both facts. Beside a separate "Out of stock" card it painted
  two red cards for one problem, with no way to see that the second count contains the first.
- **Zero is green, not grey.** In a band that answers a question, a neutral card leaves "is anything
  waiting on me" looking unanswered — the reader cannot tell an empty queue from a tile that failed
  to load.

**Tasks and Recent activity are two headed bands, not one called "Today's work".** They answer
different questions — what to do next, and what just happened — and the shared heading made the
activity feed read as a list of outstanding work.

**Charts live in the band they explain**, not in a charts block of their own. A row of six charts is
the same mistake as a row of twenty tiles: it groups by what a thing *is* rather than by what it is
*about*.

**Trends only where data exists.** The hero sparkline is drawn from `charts.salesTrend`, the same array
the trend chart plots, and only when it has three or more points — below that a shape would assert a
direction the data cannot support. No delta is computed anywhere: there is no comparison period in the
payload, and inventing "+12% vs last week" would be a calculation nobody asked for.

Nothing on this screen is computed differently and no request changed. Two charts changed **form** —
see §4 — but plot exactly the numbers they plotted before.

**One figure lost its headline slot.** `pendingRequests.total` was a primary tile and is now absent as
a number; the Business health tile shows `awaitingApproval` with "1 to approve · 6 in transit"
beneath it. Both components are still stated, and the total conflated two different kinds of waiting —
but it is a figure that was on the page and no longer is, which is a call worth knowing was made.

### Typography, and two values that are not figures

The value slot has to render both `₹16,271` and `Not declared`, and the same 30px semibold treatment
cannot serve both — a two-word phrase at figure weight fills the card and outshouts the counts beside
it. `pb-metric-tile` detects a letter in the value and drops to title weight.

The hero does the same for its placeholder. An em dash is passed when there is nothing at all to show
— deliberately, since a confident `₹0.00` on a Saturday evening reads as "we sold nothing" rather than
"nobody has typed it in" — but at 52px semibold an em dash is a solid black bar that looks like a
redaction, and it was the loudest mark on the page for the one card with no news. The placeholder now
renders smaller and muted. The value is unchanged; only its weight is.

That placeholder is also rarer than it was: on an unrecorded day the hero now shows the **till's**
revenue from `posToday`, with an amber `From the till · not yet confirmed` badge and a
`Confirm today's takings` button. The em dash is reserved for a day with no declared entry *and* no
counter takings. The badge is not decoration — the till figure excludes aggregators by definition, so
on a Zomato day it is genuinely lower than the day's real total, and a provisional number that looked
like a confirmed one would quietly undermine the `walkInReconciliation` variance this page also
ships. See [SALES.md](./SALES.md#the-till-fills-the-form-in).

---

## Sales

Admin-only, and **absent from a Store Manager's payload rather than hidden by the
template** — the same rule the rest of this page follows. A number that reaches the browser
has been disclosed, whatever the client does with it, so `salesTrend` and `salesByChannel`
are emptied and the tiles omitted entirely.

| Tile | Shows |
|---|---|
| Today's sales | the declared takings; the till's figure (badged provisional) while unrecorded; `—` when neither exists |
| Sales this month | month to date, captioned "N of M days recorded" |
| Cash today | today's cash, and its share |
| Platforms today | today's Zomato + Swiggy, and its share |

**`—` rather than ₹0.00 for an unrecorded day.** "Not entered yet" and "took nothing" are
different facts and only one is bad news; a confident zero on a Saturday evening is the
sort of figure that gets screenshotted before anyone checks whether it was simply not typed
in. The same applies to the cash and platform tiles, which read "today not recorded".

**The trend chart omits unrecorded days rather than plotting them as zero**, and says
underneath how many it omitted. This is the opposite choice from the stock-movement chart,
which *does* generate a zero for every quiet day — deliberately, because a day with no
stock activity genuinely had none, whereas a day with no sales entry has an unknown figure.
Drawing it as zero would put a trough in the line that never happened.

Unrecorded days also become a task linking to `/sales`. Today is excluded: takings are
entered after close, so it is not late yet.


## 1. The split is server-side

`GET /dashboard` returns **only what the caller's role may see**. An admin's stock
valuation, purchase spend, GST and write-downs are absent from a Store Manager's response —
not sent and hidden by the client. A number that reaches the browser has been disclosed,
whatever the template does with it.

The layout is chosen from the `role` on the *response*, not from the client's own token, so
the two cannot disagree about which dashboard is being rendered.

| | Admin | Store Manager |
|---|---|---|
| Today's purchases, GST | yes | — |
| Inventory value | yes | — |
| Write-downs | yes | — |
| Top used ingredients | yes | — |
| Transfers today | yes | — |
| Today's consumption | yes | yes |
| Low stock, pending requests | yes | yes |
| Today's tasks, recent activity | yes | yes |

---

## 2. "Today" is the caller's day, not the server's

The client sends `?date=YYYY-MM-DD` from its own clock. The database runs in UTC and the
business does not: at 02:00 in Mumbai it is still the previous day in UTC, so a
server-computed "today" would show yesterday's purchases for five and a half hours every
night. Defaulted rather than required, so a `curl` still works.

---

## 3. Two things the data could not honestly support

**Wastage is not tracked.** There is no write-off record anywhere in the system. The tile is
therefore labelled **"Write-downs"** and counts *manual downward stock adjustments*, which
is where waste actually lands today — someone bins a spoiled tub and adjusts stock down. It
also catches stocktake corrections, so calling it wastage would overstate a figure people
would act on. A real wastage number needs a write-off feature that captures a reason; the
`STOCK_WRITE_OFF` permission for it already exists.

**There is no task table, and there should not be one.** "Today's tasks" is derived from
live state: items out of stock, items below their reorder level, transfers awaiting your
approval or receipt, purchases with no bill attached, and today's consumption sheet not yet
recorded. A stored task lingers after the work is done; "four items are below their reorder
level" stops being true the moment someone restocks them. Only non-zero entries are
returned, so an empty list genuinely means nothing needs doing, and every row is a link —
a count you cannot act on is a nag, not a task.

---

## 4. What the charts do and do not add up

**Stock movement counts movements, it does not sum quantities.** Adding a kilogram to a
litre to a packet produces a number with no unit and no meaning. Counting how many times
stock moved is comparable across every item in the business, and the chart says so beneath
itself.

**Top used ingredients ranks by how often an ingredient appears on a sheet**, for the same
reason — 3 litres of cream and 1.2 kilograms of chocolate do not compare, and a bar chart
putting them on one axis would invent a relationship. The total is printed beside each bar
in the ingredient's own unit.

**Stock value by category is a ranked bar, not a donut.** `InventoryCategory` has twenty members and
there is no set of twenty hues a reader can tell apart, so past a handful a donut stops being readable
however the colours are chosen — it was already drawing five categories in three. A ranked horizontal
bar answers the same question at any category count: one colour, labels beside their own bars instead
of in a legend to be matched up, and the ordering does the comparison the donut asked you to do by eye.
The centre total is not lost — it is the "Inventory value" tile at the top of the page.

**Stock movement is four lines, not four overlapping areas.** Same series, same numbers; but four
translucent fills on one plot produce a region whose colour belongs to none of them, and no single
series can be followed through it. Still unstacked, for the reason the caption gives.

**Purchase spend and stock value are in rupees**, which *is* additive, so those are summed.

**Spend is grouped by invoice date; movement by when the stock actually moved.** They answer
different questions — "what did we spend on the 24th" is a fact about the invoice, "when did
stock change" is a fact about the shelf — so a bill dated last week and entered today
appears on last week's spend and today's movement.

**The valuation says how much of the shelf it covers.** `₹16,694 · 32 items unpriced` rather
than a bare total: a stock value quoted without that is the kind of number that ends up in
a report unchallenged.

---

## 5. Implementation

`DashboardPrismaRepository` runs fourteen aggregate queries **in one transaction**, so the
whole screen describes a single snapshot — without it, a purchase recorded mid-render could
be counted by a tile and missed by a chart, and the two would disagree by one for no visible
reason. Raw SQL throughout, because every figure is a group-by, a filtered count or a
cross-column comparison.

Charts use a `generate_series` left join so a day with no activity is a zero rather than a
gap: a line chart that skips empty days compresses time and makes a quiet week look busy.

Every raw result passes through one `toNumber` at the boundary. Three different shapes come
back and all three break JSON if they escape: `count()` is a bigint that `JSON.stringify`
refuses, `sum()` on a numeric column is a `Prisma.Decimal` that serialises as a *string*,
and some driver paths return plain strings.

### Charts

ApexCharts, wrapped once in `pb-chart`. The wrapper **destroys and rebuilds on a theme change**,
because Apex bakes label and grid colours in at construction, so a chart built in light mode
keeps near-black text on a dark card otherwise.

#### The palette was broken, and silently

It drew from `--mat-sys-primary`, `-tertiary`, `-secondary` and `-error`. On this app's **rose**
palette that is not four colours: `primary` and `tertiary` resolve to the *same value*. Measured on
the running app, the stock-movement chart drew "Purchased" and "Consumed" in one colour, and the
category donut drew five slices in three — three of them identical.

There was a helper, `expandPalette`, written specifically to prevent that by stepping lightness per
cycle. It never ran: it delegated to a `shade()` that only parsed `#rrggbb`, and the tokens are
`light-dark(#a, #b)` functions, so every call returned its input unchanged. A dead safety net over a
palette that already contained duplicates.

Both halves are fixed. `resolveColour` assigns the token to a probe element and reads it back through
`getComputedStyle`, which forces `light-dark()` to resolve, so what the module handles is always a
concrete `rgb(...)`. And the marks now come from a purpose-built categorical palette in
`design-system.css` — five slots, fixed order, **validated** for lightness band, chroma floor,
colour-vision separation, normal-vision separation and contrast against this app's own surfaces
(`#fff8f8` and `#171213`). Worst adjacent CVD ΔE is 24.7 light and 26.0 dark against a target of 8.

The order is the safety mechanism: violet sits between orange and green because orange↔green is the
pair that collapses under protanopia (ΔE 3.2). Do not reorder without re-validating. Single-series
charts — most of them — use one brand-rose mark colour instead, where there is no separation problem
to solve.

#### Other fixes in the same pass

- **Solid hairline gridlines.** They were dashed, which borrows a "projection" or "threshold" meaning
  the grid does not have.
- **`curve: 'monotoneCubic'` — smooth, and provably unable to overshoot.** This was `straight`, for a
  real reason: Apex's `smooth` fits a Catmull-Rom-style spline, and a spline through sparse data
  overshoots its own inputs — the movement chart drew daily movement counts dipping *below zero*
  between two quiet days. A chart may not invent values between the ones it was given.

  `monotoneCubic` resolves that rather than trading it away. A monotone cubic interpolant is
  constrained to stay within the interval of its neighbouring points, so it is smooth everywhere and
  cannot introduce a maximum or minimum the data does not contain. The curve reads as premium; the
  zero floor holds. Worth knowing the residual tradeoff: any interpolation between daily counts is a
  claim about days that have no reading, and a curve suggests continuity more strongly than a
  straight segment does. The values are honest; the *shape between* them is still a drawing
  convention.
- **The value formatter follows the axes on a horizontal bar.** It did not, so the ranked charts
  labelled their categories "₹Chocolate", "₹Dairy" and "Wooden Spoon×" — the top-ingredients chart has
  been horizontal since it was written, so it had been doing this all along. The horizontal value axis
  is also capped at four ticks, because six ₹-prefixed labels collide in a narrow card.
- **The donut's slice gap uses the surface colour**, not a hardcoded `#fff` that drew white seams
  across a dark card.
- **No legend for a single series.** One colour and a card title that already names it: a box with one
  swatch restates the title and costs a row.
- **The area gradient's strength depends on how many series are plotted.** A lone area gets a real
  gradient — 45% at the line falling to nothing at the baseline — which is what makes a trend read as
  a volume rather than a wire, and with one series there is nothing for it to obscure. **Two or more
  drop back to a 14% wash**: four overlapping fills at 45% is a muddy stack in which no series can be
  followed, and the colour where two overlap belongs to neither of them. The same component draws the
  hero sparkline and the four-series movement chart, so the strength is computed rather than set.
- **Legend markers are circles, not squares.** The marks they key are lines and rounded-end bars; a
  hard-cornered swatch was the only shape on the chart with a corner in it. The circle also matches
  the hover marker on the line, so the legend and the plot agree about what a series looks like.
- **More room around the plot.** Apex packs it to the container's edges, so a chart in a card reads as
  a picture pressed against a frame; the padding lets the top gridline breathe under the subtitle and
  keeps the last data point off the card's border.
- **Grid and text bind to the design system's own chart tokens** (`--color-pb-chart-grid`,
  `--color-pb-text`), not to the card-border and Material colours they used to borrow. A card's edge
  has to be visible and a gridline should be barely there; one token cannot be both.
- Bars capped at 24px, markers on hover only with a surface ring.

These are in the shared wrapper, so Analytics and Reports get them too — verified below.

### Icons and empty states

The dashboard draws through `pb-icon` (Lucide) rather than `mat-icon`, matching the shell — see the
icon note in `UI.md`. `pb-empty-state` gained an **additive** `iconName` input for it: the original
`icon` still takes a Material name, so the dozen feature pages using this component are untouched.
Passing `iconName` opts a call site in.

Every empty state on the page now names the *state* rather than the subject — "Everything is
stocked" carries a tick, not a box — which is the difference between a placeholder that reads as good
news and one that reads as missing data.

The **skeleton carries the hero's gold tint** and leaves the Business health tiles neutral. That
split is deliberate: the warm card is the most recognisable thing about this page, so a grey box in
its place means the layout visibly changes colour on arrival — the flash a skeleton exists to
prevent. The health tiles go the other way: a skeleton that guessed a tone would be telling the user
something is wrong before anything has loaded, and would be wrong most of the time. The shape is the
promise; the colour is the answer, and the answer is not known yet.

---

## 6. Verified behaviour

**38 checks in headless Chrome, across both roles:** all eight admin tiles · the valuation
showing `₹16,694` with `32 items unpriced` · four admin charts drawing real SVGs · the donut
carrying category slices and a centre total · ingredients ranked with per-unit totals · the
task panel and activity feed · **charts surviving a light/dark toggle** · the manager layout
rendering instead of the admin one, with `Inventory value`, `GST paid`, `Purchase spend` and
`Stock value by category` **absent from the DOM** · no horizontal scroll at 390px on either ·
no 5xx and no page errors.

### Redesign — 32 further checks

**Admin (20/20).** One hero figure at 44px with proportional numerals · three distinct value sizes
(44 / 28 / 18) · section gap 40px against an inner gap of 24px · five titled bands · no `pb-stat-card`
left on the page · card titles measured **quieter than the section heading above them** (15px/500 vs
18px/600) and headers down from 121px to 75px · no `h1`/`h2` nested inside a card · the hero carries a
prompt rather than a void when the day is unrecorded · movement chart drawing **four distinct** stroke
colours · single-series charts with no legend and multi-series charts with one · zero dashed gridlines ·
charts still rendering after a light/dark toggle · no horizontal scroll at 1440 or 390.

**Store Manager (11/11).** Manager layout rather than admin · hero is the workload and draws **no**
sparkline · three weights present · no underlined links · **`Inventory value`, `GST paid`,
`Purchase spend`, `Stock value by category` and `Revenue by channel` all absent from the DOM**.

**Shared-wrapper regression (12/12).** Analytics (5 charts), Reports (1) and the design-system page all
render, with no colour collisions and no currency prefix leaking onto a category label.

**The palette, measured rather than argued.** The old mapping was resolved against the live stylesheet
for comparison: `--mat-sys-primary` and `--mat-sys-tertiary` returned the identical string
`light-dark(#ba005c, #ffb1c5)`. The five new slots resolve to five distinct hues, and the Reports donut
was confirmed using all five with the surface-coloured gap between slices.

Two threshold notes: the light-mode green↔red adjacency (slots 4↔5) sits at CVD ΔE 7.2, inside the band
that is only legal with a second identity channel — it is reached only by a five-mark chart, and the
one that exists (the Reports donut) has both the slice gap and a legend. Three of the reference hues
were rejected for light mode on contrast grounds before this order was chosen.

### Not verified in the redesign

- **A five-series line or area chart.** Nothing in the app plots one, so slot 5 has only been seen on a
  donut, where the gap supplies the secondary encoding. A five-line chart would need direct labels.
- **A category count above five on the ranked bar.** The form scales to twenty, but only five priced
  categories exist in this dataset.
- **Real touch input**, and screen-reader output. The heading outline was corrected and asserted
  structurally, but no assistive technology was run.

### Changes this work required elsewhere

1. **Recording a purchase now refreshes the item's `purchasePrice`** from the line's
   `unitRate`. Without it the valuation sat at ₹0 for items the business demonstrably
   bought. Latest cost, not a weighted average — that is a costing method to choose
   deliberately, not to arrive at by accident.
2. **`InventoryHistoryEntry` gained `itemName`.** The activity feed said "Consumed" without
   saying what, which is a line nobody can act on. Joined only on the feed query; a
   per-item history already knows its item.
3. **`pb-stat-card` gained a `caption` input.** It only rendered supporting text when a
   *trend* was set, so the "32 items unpriced" caveat never appeared. A caption is not a
   delta: there is no comparison period, and dressing the caveat as a trend would assert a
   movement nobody measured.

### Not verified

- **A day boundary.** The caller-supplied date is the right design but has only been
  exercised inside one day; the 00:00 IST rollover has not been watched.
- **Chart behaviour at scale.** Fourteen daily points and six ranked ingredients. A
  90-day window is allowed by the API and has not been rendered.
- **Print or export.** Apex's toolbar is deliberately disabled and no export path replaces
  it yet.
