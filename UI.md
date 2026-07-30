# Layout & component library

The application shell and the reusable components every feature is built from.

---

## 1. Shell

```
MainLayoutComponent                 owns every responsive decision, and the scroll state
├── AppTopbarComponent              toggle · title + trail · search · ⌘K · actions · theme
│   ├── AppQuickActionsComponent    four routes, permission-filtered — navigates only
│   ├── AppNotificationBellComponent  unread pill · newest ten · mark read
│   └── AppUserMenuComponent        identity · appearance · password · sign out
├── AppSidebarComponent             brand · permission-filtered nav · identity + sign out
└── <router-outlet>                 the routed page
```

**⌘K has a visible control.** It had been bound since the palette landed and was discoverable only
by trying it — the one hint in the bar read `/`, which focuses the *data* search, so the shortcut
users arrive with from Linear and Stripe was invisible to anyone who did not already know it. The
button prints the chord rather than showing an icon with a tooltip: the point is to teach the keys,
and a label that *is* the keys does that without being opened. It opens the palette on click too,
so it is a control and not just a legend.

The sidebar reads **brand → navigation → identity**, top to bottom. The topbar deliberately leads
with the page title rather than the product name, which leaves the brand needing a home; before this
it had none, and no authenticated screen said the app's own name anywhere. Identity sits in the
footer because it is reference information, and it absorbs Sign out — which was previously a
full-width row directly beneath it, saying the same thing twice in two shapes.

`AuthLayoutComponent` is a separate, deliberately minimal shell for sign-in: it must
not render the sidebar or account menu, both of which read authenticated state that
does not exist yet.

### Icons — Lucide, behind `pb-icon`

The shell draws every icon through `<pb-icon name="…" />`, which wraps `lucide-angular`. **No shell
component imports Lucide directly**, and no call site names a glyph: `name="inventory"`, never
`name="package"`. Names are registered in `shared/components/icon/icon-registry.ts` and the type is
`PbIconName`, so a typo is a build error rather than a blank square.

Three things that buys:

- **Tree-shaking is the default.** Lucide ships ~1,600 icons; importing the barrel and passing a
  string pulls in all of them. The registry imports each icon by name, so the whole set costs
  **2.7 kB** of the bundle.
- **One place for defaults.** Size and stroke are decided in the component. The previous `mat-icon`
  call sites each carried `!h-5 !w-5 !text-[20px]` to undo a default nobody wanted — forty copies,
  about a third of which had drifted to a different size.
- **Stroke is 1.75, not Lucide's 2.** At 16–20px a 2px stroke competes with the text beside it;
  below ~1.5 the strokes alias into grey. `absoluteStrokeWidth` is off, so a 32px icon is not drawn
  in hairlines while a 16px one stays bold.

**The active nav state changed mechanism because of this.** It used to be Material Symbols' `FILL`
axis, and an outline set has no filled twin. Weight replaces it, bound from `routerLinkActive`'s own
`isActive` — a stroke width is an SVG attribute, not something CSS can reach, so it is an expression
next to the icon instead of a rule in a global stylesheet reaching into a component's DOM.

**Notification icons arrive as Material names and are translated client-side.** The API sends
`icon` derived server-side from the type (`'production_quantity_limits'`, `'task_alt'`), so every
client draws the same thing. That is a contract; `iconForServerName` maps it, and an unrecognised
name falls back to the bell rather than rendering nothing — a notification type newer than the build
must still be readable.

Feature pages still use `mat-icon` (62 files). They were out of scope for the shell pass; the two
sets are visually close enough at these sizes that the seam is not obvious, but it is a seam.

### Responsive strategy

| Viewport | Sidebar | Topbar search | Breadcrumbs | KPI grid | Table |
|---|---|---|---|---|---|
| `< 600px` | `over` drawer, closed, backdrop | icon → full-width row below the bar | hidden | 1 column | **card list** |
| `600–1279px` | persistent, 72px rail by default | inline, 224px | hidden | 2 columns | table |
| `>= 1280px` | persistent, 256px by default | inline, 320px | inline | 4 columns | table |

The trail is also dropped when it would only repeat the title. The topbar's title *is* the last crumb,
so a one-crumb route rendered the same word twice, one line apart, in two sizes — which is how the
Dashboard came to say "Dashboard" underneath "Dashboard". It renders from two crumbs up.

Three decisions in there are worth stating:

**The table becomes cards below 600px, not a horizontal scroller.** A scrolling
table is technically responsive and miserable in practice — you cannot see the row
you are reading and its column headers at once. The card layout is generated from the
same `TableColumn<T>` definitions, so there is no second source of truth.

**The rail is a default, not a rule.** Below 1280px the sidebar starts collapsed
because 256px out of 768px leaves too little for a data table, but the toggle works
at every size. Forcing the rail below some width would make the button look broken
on a tablet.

**Mobile search gets its own row.** A usable search field and the other topbar
controls cannot share 360px, so on mobile the field collapses to an icon that reveals
a full-width row beneath the bar.

Breakpoints come from `BreakpointObserver`, bridged into signals with `toSignal`, so
templates read them synchronously with no `async` pipe and no manual unsubscribe.
They are chosen where the *content* stops fitting, not at device sizes.

---

## 2. Components

All in `src/app/shared/components/`, all standalone, all `OnPush`, all prefixed `pb-`.

| Component | Purpose | Notes |
|---|---|---|
| `pb-card` | Content container | Optional header/actions/footer, four padding steps. `padding="none"` for cards whose body is a table. `dense` for a card inside a titled section — see the typography note below. |
| `pb-data-table` | Server-paginated table | Columns as data; card layout on mobile; sticky header, striping, density, selection + CSV export, skeleton loading. See §7. |
| `pb-list-toolbar` | Search + filters + applied-filter chips | One shape for all six list pages. Filter controls are projected; the chips are data. |
| `pb-inline-alert` | A message about the thing beside it | Four semantic tones; `role` derived from tone so no call site gets `alert` by accident. |
| `pb-dialog-shell` | Header, scrolling body, pinned footer | The frame every dialog sits in. `slot=error` puts form-level failures above the first field. See §8. |
| `pb-form-section` | A named group of fields | `role="group"` + `aria-labelledby`; 16px between fields. |
| `pb-submit-button` | Primary action with its in-flight state | Spinner inside the button at a held width, so submitting cannot resize it. |
| `pb-form-steps` | Stepper-style progress for a long form | A progress indicator, **not** a gated wizard — see §8 for why. |
| `pb-error-state` | A whole screen that failed | Inline SVG illustration — it is the error path, so it cannot fetch one. See §9. |
| `pb-fab` | Primary action, floating, on a phone | `sm:hidden`; pairs with an `sm:`-only header button so the action is never on screen twice. |
| `pb-paginator` | Pagination | Translates Material's 0-based `pageIndex` to the API's 1-based `page` at one boundary. |
| `pb-search-box` | Debounced search | 300ms debounce + `distinctUntilChanged`; keyboard-reachable clear button; Escape clears. |
| `pb-breadcrumbs` | Route trail | Derived from route `data`; `<nav><ol>` with `aria-current`; keeps the last two crumbs on mobile. `dense` drops the 44px touch target, for the topbar. |
| `pb-spinner` | Loading indicator | Inline or overlay; `role="status"` in both. |
| `pb-stat-card` | KPI tile | `positiveWhen` decides which trend direction is good. |
| `pb-empty-state` | No-data / no-results | Optional action button. |
| `pb-page-header` | Page title block | Optional breadcrumbs; stacks below `sm`. |
| `pb-loading-bar` | Global progress | Driven by the HTTP interceptor's in-flight counter. |
| `pb-confirm-dialog` + `ConfirmDialogService` | Confirmation | `variant: 'danger'` focuses **Cancel**; dismissal resolves to declined. |
| `*pbHasPermission`, `*pbHasRole` | Conditional UI | Hides UI only — never a security boundary. |
| `NotificationService` | Toasts | Severity-based durations, optional action, `withUndo()`. |

### Design decisions

**Cards over `MatCard`.** `pb-card` needs optional header/action/footer regions with
consistent dividers; expressing that through `mat-card`'s fixed slots means fighting
its internal padding at every call site. Colours still come from `--mat-sys-*`, so it
themes with everything else.

**Columns as data.** One table implementation serves every list feature. Adding
`primary`, `numeric` and `hideOnMobile` flags to `TableColumn<T>` is what makes the
mobile card layout possible without a parallel template.

**Paging and sorting are emitted, never applied.** The dataset lives on the server;
sorting the page in hand would silently give wrong answers. The dashboard's in-memory
filtering is a deliberate exception, because its data is static sample data.

**Toast durations differ by severity.** An error needs longer to read than "Saved". A
toast that disappears before it is read may as well not exist.

**Destructive dialogs focus Cancel.** A reflexive Enter press should not delete a
record. Escape and backdrop clicks both resolve to declined.

---

## 3. Material + Tailwind

Both, without conflict, via two decisions documented in
[ARCHITECTURE.md](./ARCHITECTURE.md#material--tailwind):

1. Tailwind's **preflight is not loaded** — its reset unstyles buttons and inputs and
   breaks Material form fields.
2. **One palette**: `mat.theme()` emits Material 3 tokens as CSS custom properties and
   Tailwind's `@theme inline` maps them onto its colour scale, so `bg-surface` and
   `text-on-surface-variant` are Material colours and dark mode fixes the whole page.

There is no `MaterialModule`. `shared/material/material-imports.ts` exposes curated
arrays (`MATERIAL_FORM_IMPORTS`, `MATERIAL_TABLE_IMPORTS`, …) instead — a barrel
re-exporting the library would pull all of Material into every lazy chunk.

### Gotchas worth knowing

Each of these was hit while building the layout.

**Tailwind variants cannot be `[class.x]` binding keys.** `[class.hover:bg-…]` and
`[class.sm:flex]` do not parse. Build the class list as a string and bind `[class]`.

**Backticks cannot appear in a component's inline template.** An HTML comment
containing `` `flex-1` `` terminates the TypeScript template literal, producing a
wall of confusing parse errors. Use quotes in template comments.

**Every `mat-*` typography class in this app was inert — all 238 are now gone.** `mat.theme()` in
`styles.scss` emits Material's design *tokens* (`--mat-sys-title-small-*`) but not its typography
*classes* — those need `mat.typography-hierarchy()`, which is not included. So `.mat-title-small`,
`.mat-body-medium`, `.mat-label-large` and friends matched no rule anywhere, and because preflight is
also absent, the bare elements underneath fell back to the browser's own styles.

What that actually cost, measured across all 13 routes before the fix: **every** page's `h1` rendered
at **32px/700** — the UA default, not the 28px/620 the design system specifies. `mat-title-small`
rendered **19px/700**, `mat-body-medium` **16px/400**, a `pb-empty-state` title **24px/700**. None of
those sizes was chosen by anyone. 329 elements were affected. The damage was not merely that the
numbers were wrong, it was that the app had *two* type systems — the designed `pb-` scale on screens
that had been touched, and the browser's defaults everywhere else — and they were visibly different.
A 19px bold card title out-shouted a 15px section heading, so the hierarchy read upside down.

**The fix, done in one sweep:** every `mat-*` typography class was replaced with its `text-pb-*`
equivalent. Material's 15 roles collapse onto the `pb-` scale's 7, which loses nothing — the finer
distinctions were never rendering. The mapping used:

| Material role | `pb-` role | Material role | `pb-` role |
| --- | --- | --- | --- |
| `display-*` | `text-pb-display` | `body-large` / `body-medium` | `text-pb-body` |
| `headline-*` | `text-pb-heading` | `body-small` | `text-pb-caption` |
| `title-large` / `title-medium` | `text-pb-title` | `label-large` | `text-pb-body font-medium` |
| `title-small` | `text-pb-subtitle` | `label-medium` / `label-small` | `text-pb-caption` |

Verified after: 0 inert elements on all 13 routes, every `h1` at 28/620, every former `mat-title-small`
at 15/500. Two files had `font-medium` already present and picked up a duplicate from the
`label-large` rule — worth grepping for after any bulk class rewrite, since the *later stylesheet*
declaration wins, not the later class in the attribute.

`text-pb-*` is the only real scale here. Do not reintroduce `mat-*` typography classes.

**Preflight is absent, so every UA default is still there — including the ones you cannot see.**
The underlined `<a>` and grey `<button>` in the sidebar were the obvious cases. The expensive one was
`<ol>`: the breadcrumb list kept the browser's default 16px block margin, top *and* bottom, adding
32px of invisible height to every trail in the app. In the topbar that turned a 43px title block into
75px inside a 64px bar, so the trail sat against the border with its descenders clipped — and the
class list looked complete, which is why it survived review. `m-0` and `pl-0` are load-bearing on that
element. When something in a hand-built block is mysteriously too tall, measure it before restyling it.

**`mat-icon` expects Material *Icons*, not Material *Symbols*.** Its default
`fontSet` is `material-icons`. Loading Symbols without overriding that leaves every
icon rendering as its raw ligature text — "search", "menu", "more_vert" — in the body
font. `MAT_ICON_DEFAULT_OPTIONS` with `fontSet: 'material-symbols-outlined'` fixes it,
and the icon stylesheet must use `display=block` rather than `swap` so a slow font
shows nothing instead of words. A typo'd icon name fails the same way, silently, so
all 35 names in use are verified to resolve to a glyph. (This applies to feature pages
only — the shell draws SVG through `pb-icon`, where a wrong name cannot compile.)

**A global `:focus-visible` rule must live in `@layer base`, not unlayered.** Unlayered
rules outrank every layer regardless of specificity, so the app's focus ring beat both
Tailwind's `outline-none` and the `pb-input` utility — every control that drew its own
focus treatment got a second, square ring inside the first. The topbar search showed the
design system's pink ring around its 40px pill *and* an outline hugging the bare `<input>`
inside it, with mismatched corners; the command palette did the same. Both had asked for
`outline-none` and both were overruled. In `base` the cascade says what it should: this is
what focus looks like unless a control has something better.

**`MatSidenavContainer` does not react to a drawer's CSS width change.** It sets the
content's `margin-left` from the drawer's measured width, but recalculates only on
open/close. Collapsing to the rail via a class therefore left the content with a
256px margin against a 72px rail — 184px of dead space. Fixed by calling
`updateContentMargins()` from an `afterRenderEffect` that tracks `railMode`
(`afterRenderEffect`, not `effect`, so the new width is already in the DOM).

---

## 4. Dark mode

`ThemeService` holds a `light | dark | system` preference, persists it, and derives the
applied theme with `computed`. An `effect` keeps the DOM in sync: it toggles `.dark`
on `<html>` and sets `style.colorScheme`, which is what makes Material's
`light-dark()` tokens and native form controls resolve correctly.

`system` follows the OS live via a `matchMedia` listener, so switching appearance at
the OS level updates the app without a reload.

The effect also points the `theme-color` meta at the resolved `--mat-sys-surface`, which is what a
mobile browser tints its own chrome with and what an installed PWA uses for the status bar. `index.html`
had always described that tag as "set by ThemeService" and no version of the service had ever set it,
so an installed app in dark mode carried a white status bar above a near-black page.

**Two controls, for two different jobs.** The topbar keeps a one-press toggle, because dark mode is
used often enough that burying it two clicks deep is the wrong trade. The account menu holds the
actual choice — Light, Dark and **System** as three `menuitemradio` items.

That third option is the point. `ThemeService` has always held `light | dark | system`, but every
control that existed called `toggle()`, which flips between light and dark and *leaves* `system`
permanently. So the mode that every new user starts in, that is persisted, and that follows the OS
live, became unreachable the moment anyone touched a theme control — with no way back short of
clearing storage.

They are three menu items rather than the segmented control this would ideally be, because `MatMenu`
runs its arrow-key navigation over `MatMenuItem` instances and closes on Tab: a row of plain buttons
inside the panel can be clicked and never focused. Three real menu items keyboard-navigate and
announce their own state.

---

## 5. Breadcrumbs

Routes declare their own label, so the trail is a consequence of the route config
rather than something each page must remember to set:

```ts
{
  path: 'products',
  data: withBreadcrumb('Products'),
  loadChildren: () => import('./products.routes').then((m) => m.productRoutes),
}

// Or derived from resolved data, for a detail page:
{
  path: ':id',
  data: withBreadcrumb((data) => (data['product'] as Product).name),
  loadComponent: () => import('./product-detail.page').then((m) => m.ProductDetailPage),
}
```

`BreadcrumbService` walks the active route snapshot tree accumulating URL segments
across *every* route — including layout routes with an empty path and no label — so a
child's link stays correct even when its ancestors contribute no crumb. A page that
declares nothing simply adds no crumb, which degrades gracefully rather than showing a
wrong path.

---

## 6. Building a list page

The dashboard is the reference. A real feature page is the same with the sample data
replaced by a service:

```html
<pb-page-header title="Products" subtitle="…">
  <button slot="actions" matButton="filled" (click)="create()">New product</button>
</pb-page-header>

<pb-card padding="none" title="All products">
  <div class="p-4">
    <pb-search-box (searchChange)="onSearch($event)" />
  </div>

  <div class="px-4 pb-4">
    <pb-data-table
      [columns]="columns"
      [rows]="products()"
      [pagination]="pagination()"
      [loading]="loading()"
      [trackBy]="trackById"
      (sortChange)="onSort($event)"
      (pageChange)="onPageChange($event)"
    />
  </div>
</pb-card>
```

Always pass `trackBy` when rows have a stable id: without it Angular falls back to
index and re-creates every row on each refresh, losing focus and scroll position.

---

## 7. The list-page pattern

### The CRUD pass — status is a pill, and the shared layer carried it

Six pages were redesigned by changing five shared components, which is the whole argument for having
had them: `pb-data-table` (8 call sites), `pb-list-toolbar` (6), `pb-stat-card` (9),
`pb-page-header` (14), `pb-empty-state` (14).

**`TableColumn.tone` is the one contract change.** Status was the single thing every list rendered as
a bare word — "Out of stock", "In transit", "Voided" — in the same ink and weight as the product name
beside it. A state is not a fact about the row the way a quantity is; it is what someone scans the
column *for*, and a pill is what makes it findable without reading.

```ts
{ key: 'status', header: 'Stock',
  value: (row) => STOCK_STATUS_LABELS[row.stockStatus],
  tone:  (row) => STOCK_STATUS_TONES[row.stockStatus] }
```

Three decisions inside that:

- **`tone` takes the row, not the string.** The same word means different things in different tables,
  and no text→severity map would be right in all of them. Tone maps live beside the label maps they
  belong to (`STOCK_STATUS_TONES`, `TRANSFER_STATUS_TONES`), because both answer "how is this drawn"
  and splitting them is how a fourth status ends up with a label and no tone.
- **Returning `null` renders plain text.** Consumption is `Recorded` on almost every row, and a column
  of identical grey pills is louder than plain type while carrying less — the two rows that are
  `Voided` or `Edited` stop standing out. A pill earns its ink by being uncommon.
- **`APPROVED` is info, not success**, because its label is "In transit": the goods have left and have
  not arrived. Getting that pair the wrong way round tells a manager the stock is on the shelf when it
  is still in a van.

### The rest of the pass

**Rows are 56px comfortable / 44px compact**, up from 52/40. Fifty-two was Material's figure and reads
tight against 14px text with a badge in it; 56 gives a line of body text its leading plus 16px of air.

**The header is a label strip, not a banded row** — uppercase 11px in secondary ink on the sunken
surface, so it names the columns and gets out of the way.

**The page header lost its bottom rule.** On a screen whose content is a bordered card, an underlined
masthead drew two horizontal lines 24px apart. Space separates a title from what follows it perfectly
well.

**The paginator is the table's footer**, sharing its border and surface with the bottom corners
rounded, rather than a control floating beneath it.

**Filter fields are 48px and the toolbar row is `items-center`.** Material's outlined field is 56px —
right for a form, wrong above a table, where it made the filters the heaviest thing on screen before
any data was read. Forty-eight is the floor rather than forty: an outlined field's label sits *in* its
border, and below ~48 the floating label collides with the outline it notches. The row was
`items-start`, so a 40px search box and a 48px select started level and ended eight pixels apart.

**Filter chips tint toward danger on hover**, whole-chip rather than just the ×. A chip whose only
hover signal is a 16px glyph changing colour asks the user to notice a detail before understanding
that pressing it removes something.

**`pb-stat-card` pins its figure to the baseline.** Without it a card whose caption is empty is shorter
than its neighbours and the grid leaves the difference as a hole *below* the number — on inventory that
was one card of four with 40px of blank under its figure, which reads as a load failure. Same fix
`pb-metric-tile` carries on the dashboard.

**Mobile cards gained a chevron** when the row opens something. A tappable card that looks identical to
an inert one is the commonest reason a list feels unresponsive on a phone: there is no hover to reveal
the affordance, so it has to be drawn.


Six screens are the same shape — Inventory, Purchases, Transfers, Suppliers, Consumption, Daily sales —
and they had each built that shape themselves. The filter block was a four-column grid on two pages, two
stacked grids on another, a flex row on a fourth; "Clear filters" sat in a different place on all six,
and on two of them it occupied a grid track, so the *other* controls changed width depending on whether
a filter was active. The error banner was copy-pasted six times, with `bg-error-container` — pink, on
this palette — and three different inner markups.

```html
<pb-card padding="none">
  <div class="flex flex-col gap-pb-3 p-pb-4">
    <pb-list-toolbar
      searchLabel="Search items" [searchValue]="store.searchTerm()"
      [filters]="filterChips()"
      (searchChange)="onSearch($event)" (chipRemove)="removeFilter($event)"
      (clearAll)="store.clearFilters()">
      <mat-form-field slot="filters" class="lg:!w-48" subscriptSizing="dynamic">…</mat-form-field>
    </pb-list-toolbar>

    @if (store.error(); as failure) {
      <pb-inline-alert title="Could not load inventory" [message]="failure.message">
        <button slot="actions" matButton (click)="store.reload()">Try again</button>
      </pb-inline-alert>
    }
  </div>

  <div class="px-pb-4 pb-pb-4">
    <pb-data-table selection="multiple" stickyHeader maxHeight="60vh" exportName="inventory" … />
  </div>
</pb-card>
```

**Applied filters are chips, and that is the real improvement.** The controls always held the state, so
answering "why is this list showing four rows" meant reading five collapsed selects — and on mobile,
scrolling past five stacked fields to do it. Each page builds its own `FilterChip[]` because only the
page can word them: the store holds a category *code*, and "Category: DAIRY" is not what anyone picked.
Labels resolve through the same option list that populates the select, so the chip and the control
cannot disagree.

Search is deliberately **not** a chip: it has a visible input two rows above with its own clear button,
and a chip would be a second place to remove the same thing.

### What `pb-data-table` gained

| Feature | Note |
|---|---|
| Sticky header | Requires `maxHeight` — `position: sticky` needs a scrolling ancestor, and a wrapper with no ceiling never becomes one. Off by default for that reason. |
| Striping | 2.5% wash on the *cell*, so stripe, hover and selected compose instead of fighting. Near-invisible alone; it earns its place by making a wide row traceable. |
| Density | `compact` 40px / `comfortable` 52px, one app-wide preference in `TablePreferencesService`, persisted. Density is a statement about the person, not the screen. |
| Selection | Keyed by `trackBy`, **not** by object reference — the store hands back new objects on every refresh, and reference identity would drop the selection each reload. |
| CSV export | Client-side, from the column definitions. `csv` on a column supplies the raw figure where the cell shows a formatted one; every field is quoted, and the file leads with a BOM so Excel does not read UTF-8 as Latin-1. |
| Skeleton loading | Replaces the spinner on first load, in the table's own shape. One `role="status"` for the region, not one per placeholder. |
| Column resizing | **Not implemented.** Widths are driven from a `<colgroup>` and `TableColumn` carries `resizable`/`minWidth`, so the drag handle is a later change to one component rather than a rewrite of every column definition. |

**Bulk delete is deliberately absent.** There is no batch endpoint, and looping N single-record deletes
gives partial failure with no way to say which half succeeded. Export is the one bulk action that is
honest without one; pages may project their own into `slot=bulk-actions` when they have something
atomic.

**The 48px checkbox floor was quietly setting row height.** `html` raises
`--mat-checkbox-state-layer-size` to 48px as a touch target for the POS. In a selectable table that
plus 12px of cell padding measured **73px**, so "compact" produced 61px and the density control barely
did anything. The selection cell now has zero block padding, and compact drops the target to 32px —
still above the 24px WCAG 2.5.8 pointer minimum, which is the input compact mode is for, while
comfortable keeps the full 48px for touch.

---

## 8. Forms

Twelve forms — two auth pages, nine dialogs and the purchase page — had each assembled their own
chrome, and the drift was the point of this work rather than any one of them being wrong.

### What was actually inconsistent

The action row was `!flex-col-reverse !items-stretch gap-2 sm:!flex-row sm:!justify-end` on the two
dialogs that had thought about mobile and a bare `mat-dialog-actions` on the rest — so on a phone some
dialogs put a full-width Cancel *below* the primary button and others squeezed two side by side. Two
dialogs had a subtitle and eight did not. The form-level error banner was copy-pasted eight times as
`bg-error-container` with `text-on-error-container`, which on this **rose** palette is a pink panel:
"could not save" and "the from date is after the to date" looked like decoration.

Field gaps were 12px, which is too tight for Material's outline appearance — the floating label sits
*above* its own box, so at 12px a label sits 4px from the border of the field above it and reads as
belonging to the wrong input. `pb-form-section` sets 16px.

### The pieces

```html
<pb-dialog-shell title="Add supplier" subtitle="…" icon="local_shipping">
  @if (formError(); as message) { <pb-inline-alert slot="error" [message]="message" /> }

  <form [formGroup]="form" class="pb-form flex flex-col gap-pb-5" novalidate>
    <pb-form-section title="Identity" icon="badge">…</pb-form-section>
  </form>

  <button slot="actions" matButton (click)="dialogRef.close()">Cancel</button>
  <pb-submit-button slot="actions" label="Add supplier" [busy]="saving()" (pressed)="save()" />
</pb-dialog-shell>
```

`pb-form` on the `<form>` is what opts a subtree into the form styles in `styles.scss` — tighter
subscript, semantic error colour, themed native date indicators. It is per-form rather than global
because the list toolbars use the same `mat-form-field` component as a *filter* control, where those
sizings would fight the layout they already have.

### Validation presentation only

`firstErrorMessage` gained a `hints` override and branches for `pattern` and `matDatepickerParse`. **No
validator changed.** A `pattern` failure used to fall through every branch to "GSTIN is invalid" —
true, and useless — so a call site can now supply the real sentence:

```ts
protected readonly gstinHints = {
  pattern: 'A GSTIN is 15 characters: 2 digits, 5 letters, 4 digits, 1 letter, then 3 more.',
} as const;
```

Errors also now wear `--color-pb-danger-fg` rather than Material's `error` role, which on a rose
palette is a red close enough to the brand that a validation message read as emphasis.

### Stepper: where it is right, and where it is not

`pb-form-steps` is on the purchase form and is a **progress indicator, not a `MatStepper`**. A gated
stepper hides the steps you are not on, and recording a purchase means entering the invoice, then the
lines, and *watching the totals change as you type* — the GST split derives from the supplier and the
line rates, and the whole reason anyone checks it is to compare it against the paper invoice in their
hand. Putting totals behind "next" would hide the number the task is about.

So it borrows the stepper's language — numbered stages, ticks, a connector — without the gating, and
pressing a stage scrolls to it. **Nothing else in the app is a wizard either**: the POS order screen
and the consumption sheet both need their lines and their totals visible at once, for the same reason.
A wizard is right when steps are independent and sequential, and none of these are.

Completion is claimed by the page rather than inferred from `FormGroup.valid`, because only the page
knows what "done" means — an invoice section with a supplier, a number and a date is complete even
though `notes` is empty and always will be.

### Sticky footers, where scrolling is real

Only the purchase page. It is the one form long enough to scroll past its own submit button: on a
ten-line invoice "Record purchase" sat roughly two screens below the fold, and the totals you were
checking scrolled away with it. The footer carries the line count and the running total, so what you
are committing to is legible at the moment you commit.

Change password deliberately does **not** get one — the whole form is about 520px and never scrolls,
so pinning the buttons would reserve height against a scroll that cannot happen. Dialogs get Material's
own out-of-scroll actions row, plus the divider and surface that make it *look* pinned; without those
the buttons appear to float in the same plane as the last field.

---

## 9. The experience layer

### The accessibility pass — three defects, not three features

An audit of the experience layer found most of it already built: skeletons, the ⌘K palette, `/` and
`?`, `withUndo`, `pb-tick` and `pb-success-pop`, `pb-error-state`, `pb-fade-in` / `pb-slide-in-x` /
`pb-line-in`, the HTTP-driven `pb-loading-bar`, and hover lifts on the POS cards and dashboard tiles.
What it also found were three things that were broken or missing, and those are worth recording
because two of them were invisible in review.

**Table rows were mouse-only.** A clickable row carried a `(click)` and nothing else — no `tabindex`,
no key handler. Clicking one opens the detail dialog, so across eight tables *the primary action of
the screen was reachable with a mouse and by no other means*. That is a WCAG 2.1.1 failure: a
keyboard or switch user could reach the page, read it, and open nothing on it. The mobile card layout
beside it had been correct all along, because it happens to wrap its body in a real `<button>`.

Rows are now focusable when the table is selectable, activate on Enter and Space, and carry an
`aria-label` naming the row's primary value. `tabindex` is bound rather than fixed so a read-only
table adds no tab stops. **This is deliberately not the ARIA grid pattern** — `role="grid"`, roving
tabindex, arrow-key navigation — which is a larger change to Material's own table roles and a
different interaction model for the whole app. This fixes operability without claiming to be it.

The focus ring is an inset shadow on the *cells*, not an outline on the row: a `<tr>` cannot be
outlined reliably — the border-collapse model clips it and browsers disagree about where it lands —
while inset shadows compose into one continuous band across the row's width.

**`pb-card`'s `interactive` input had never done anything.** It was
`[class.hover:shadow-md]="interactive()"`, and a Tailwind variant cannot be a binding key: Angular
writes the literal token onto the element and Tailwind never generates the rule. Every card that
asked to look pressable rendered identically to one that did not. The same trap is documented in
`pb-data-table`, which builds its row class as a string for exactly this reason. It is now a computed
string with the 2px lift the POS cards and dashboard tiles already use.

**There was no skip link and no route announcement.** The shell puts a sidebar of fifteen links, a
search box and five topbar controls ahead of the page content, so reaching the first thing on the
page from the keyboard cost roughly twenty-five presses *on every navigation*. And a single-page app
changes the whole screen without telling anyone: the browser's own navigation announcement does not
fire, and focus stays on the link that was pressed — which no longer exists.

Both are fixed in `MainLayoutComponent`: a skip link that is `sr-only` until focused, and an effect
that announces the new page through `LiveAnnouncer` and moves focus to `<main>`. The two halves fix
different things — the announcement says *where you are*, the focus move decides *where Tab goes
next*. It is skipped on first load, where the browser has already announced the document. The title
comes from `BreadcrumbService`, the same source the topbar heading uses, so the spoken name and the
visible one cannot disagree.

`afterNextRender` rather than an immediate `focus()`: the outgoing page is still mounted when the
route signal fires, so focusing then lands on an element about to be destroyed and the browser moves
focus back to `<body>` a frame later.



Cross-cutting polish, added last. Two of these are the kind of change that looks free and is not, so both
are recorded with what they broke.

### Command palette — ⌘K

`AppCommandPaletteComponent`, mounted once at the layout root. It searches **the application**, not the
data.

⌘K previously focused the topbar's product search, which was the wrong target: that searches data, and
⌘K in every tool that popularised it searches the app. The two being conflated meant there was no
keyboard route to Reports, while the shortcut users arrive with did something unexpected. Now `/` focuses
the data search and ⌘K opens the palette — both available, neither overloaded, and the hint printed in the
search box says `/` because that is what opens it.

**The command list is derived, not registered.** Destinations come from the exported `NAV_SECTIONS` — the
same array the sidebar renders — through the same `auth.can()` checks. A registry would be a second list
to keep in step, and the failure mode is silent: a route added to the sidebar and forgotten in the palette
is a feature users cannot find by the means they were taught. Permission filtering also stops the palette
offering a Store Manager a route to the access-denied page.

Matching is substring with a scoring pass (prefix > word-start > anywhere > keyword). Deliberately not a
fuzzy library: twenty short labels do not justify a dependency plus a class of surprising result.

The keyboard contract is the ARIA combobox pattern — focus stays on the input, `aria-activedescendant`
names the active row, arrows wrap at both ends. That is why the option rows carry no `tabindex` and no key
handler, and why the a11y lint rule is suppressed there with a stated reason rather than satisfied by
adding twenty tab stops that would break the pattern.

### Keyboard shortcuts, and one binding that never fired

`?` opens `AppShortcutsHelpComponent`. It is matched on the produced **character**, because the obvious
binding was wrong: `keydown.shift./` never fired once. Angular's key plugin compares `event.key`, and
Shift plus `/` produces `'?'` — so the binding asked for a `/` the browser never reports. Reading the
character also makes it work on layouts where `?` is a different chord.

Every global handler ignores the key while the user is typing, or `?` would be swallowed out of every note
and discount reason in the app — the same bug the topbar's `/` handler had to fix.

### Page transitions — opacity only, and that is not a style choice

`pb-page-in` fades the routed content, keyed on the URL path so it replays per navigation and **not** on
every keystroke of a debounced `?search=`.

The first version also rose 8px. It looked better and it broke **every `position: fixed` element inside a
routed page**: the inventory FAB measured 7818px down the document and the POS floating cart pill sat at
`bottom: 2378` on an 844px viewport. A transform on an ancestor makes that ancestor the containing block
for fixed descendants — and with `animation-fill-mode: both`, `transform: none` in a keyframe computes to
the *identity matrix* rather than to `none`, so the wrapper kept a transform permanently rather than for
the 200ms it animated.

Opacity creates no containing block. `filter`, `perspective`, `will-change: transform`, `contain: paint`
and `backdrop-filter` would all have the same fault, so this animation is restricted to the one property
that cannot cause it.

### Undo, where it is honest

`NotificationService.withUndo` existed and was called nowhere. It is now wired to **one** action: clearing
the POS cart.

That is the only place in the app where undo is truthful. Everything the button discards is local signal
state, so restoring it is exact and cannot fail — and it restores a *snapshot*, so the discount, its
reason, the notes and the customer come back with the lines. An undo that returns most of what it took is
worse than none, because the user stops checking.

**Not applied to record deletion.** The pattern there is to defer the request and fire it when the toast
expires, which means the delete happens after the user has navigated away, or not at all if the tab
closes. An undo that sometimes silently declines to do the thing is worse than a confirm dialog.

The restore is also guarded on the cart still being empty: between clearing and the tap on Undo the
cashier may have started the next order, and overwriting that would be the undo causing the problem it
exists to prevent.

### Error illustration, FAB, success tick

`pb-error-state` draws an inline SVG rather than showing a 40px glyph, which on an empty page reads as a
broken layout. Inline because **this is the error path**: an illustration fetched over the network is
exactly the request that also fails. It is geometric rather than a mascot — a cartoon apologising for a
500 is charming once and irritating on the fourth attempt.

Inventory now picks between the two by whether there is anything to keep: an inline alert over stale rows
(still usable), the full error state when the list is empty (needs to explain itself).

`pb-fab` puts the page's primary action within thumb reach once the header has scrolled away, and the
header button becomes `sm:`-only — one action, in whichever place is reachable, never both at once. It is
deliberately absent from the POS order screen, which already has a floating cart pill in that corner.

`pb-tick` draws the success stroke rather than fading it in, because a mark that *draws* reads as something
that just happened. Applied only to the success tone of `pb-inline-alert`: that tone marks a moment, while
the others describe a state, and animating those would be decoration on a message someone is reading.

### Verified — 29 checks, plus a full regression sweep

**Palette (18):** Ctrl-K opens it and takes focus · input is a `combobox` with a live
`aria-activedescendant` · 18 commands in 3 groups · typing filters · Enter runs the command, navigates and
closes · arrow-up from the top wraps to the last item · Escape closes · Ctrl-K toggles closed · `/` still
focuses search and does *not* open help · `?` is ignored while typing and opens the sheet otherwise · the
sheet lists 7 shortcuts with 9 `kbd` keys and documents the palette · the search hint reads `/` · the
palette fits and works at 390px.

**FAB, undo, utilities (11):** FAB present at 390px, 56px tall, labelled, 24px clear of the edge, with the
header action hidden · both reversed on desktop · clearing a 2-line cart empties it, offers Undo, and Undo
restores **2** lines · `pb-tick` and `pb-page-in` both generated.

**Fixed-positioning regression:** after the transform fix, the inventory FAB and the POS cart pill both
measure `bottom === innerHeight`, with zero containing-block culprits found by walking their ancestors.

**Regression:** POS 32/32 · list pages 84/84 · dashboard 20/20 · Analytics/Reports/design-system 12/12 ·
forms 63/64 (the one failure is a bad login the harness performs on purpose) · shell 63/65 (the two are the
long-standing boot `/auth/refresh` 401, which appears only on a cold profile). Three shell assertions were
rewritten rather than "fixed": they encoded the old ⌘K contract, which is now wrong by design.

### Not verified in this pass

- **Skeletons beyond tables.** `pb-data-table` draws them; the dashboard now has
  `pb-dashboard-skeleton` too (§11). Seven dialogs and secondary pages still spin.
- **The palette on a non-US keyboard layout.** ⌘K is a chord and safe; `?` is matched by character, which
  should be layout-independent, but only a US layout was exercised.
- **Screen-reader output for the palette.** The combobox pattern, roles and `aria-activedescendant` are in
  place and asserted structurally; no assistive technology was run.
- **A WCAG sweep after these changes.** The POS routes reported zero AA violations before the card
  restructure and this layer; that sweep has not been re-run.

## 10. Verified behaviour

55 checks in headless Chrome against the live API, at 1440×900, 834×1112 and 390×844.

**Shell:** persistent sidebar at 256px collapsing to a 72px rail and back, with
labels hidden and icons retained · breadcrumbs, inline search, theme toggle and
account menu present · over-drawer on mobile starting closed, opening from the
hamburger with a backdrop, and closing after navigation · topbar search collapsing to
an icon and revealing a full-width row · **no horizontal page scroll at any of the
three sizes**.

### Shell redesign — 64 further checks

A second pass, same method, covering only what the redesign changed. 62 of 64 passed; the two
failures are a `POST /auth/refresh` 401 that fires on the **login page** before any shell renders, so
it is unrelated (confirmed by loading `/auth/login` alone and seeing both errors with no
`pb-app-sidebar` in the document).

**Sidebar:** brand mark measured at 32×32 with the wordmark beside it and `/dashboard` as its href ·
nav rows at exactly 40px with a 12px active pill · active icon measured `"FILL" 1, "wght" 500` while an
inactive one measured `normal`, so the fill genuinely distinguishes rather than being applied to all ·
active indicator at full opacity and 20px tall · rail at 72px with `margin-left` following to 72px and
back to 256px · rail keeps all 13 icons, the avatar, sign out and an expand control · no separator rule
above the first rail section, which previously doubled the brand block's border.

**Topbar:** 64px tall with the title block measured at **43px inside it** — 75px before the `<ol>`
margin fix · no shadow at rest, `--shadow-pb-sm` after scrolling the content · trail present on
`/account/password` ("Account › Change password") and absent on the Dashboard.

**Search:** `/` focuses the field; `/` dispatched from inside another input is correctly ignored;
Ctrl-K focuses it from the page *and* from inside an input; the hint reads `⌘K` on this machine and
fades to `opacity: 0` on focus.

**Notifications:** panel carries both `pb-shell-menu` and `pb-notification-menu`, resolving to a 12px
radius, a 1px border and a fixed 384px column · scrolls internally at `max-height: 512px` with header
and footer both computing `position: sticky` · footer label centred to 0.0px, measured with a `Range`
over the text node rather than Material's full-width wrapper, which had made an off-centre label
measure as centred.

**Severity colours:** the three tones resolve to three distinct foregrounds. The previous mapping was
measured on the same palette for comparison and gave **two distinct colours for three severities** —
`text-primary` and `text-tertiary` were both exactly `rgb(186, 0, 92)`.

**Appearance:** three `menuitemradio` items in a `role="group"` labelled "Appearance", exactly one
`aria-checked="true"` · selecting System persists `"system"` to `pb.ui.theme` · toggling dark flips
`.dark`, `colorScheme`, the body background and the `theme-color` meta, and the brand mark keeps its
gradient in both themes.

**Responsive:** tablet drops the trail and keeps title + inline search · mobile drops inline search,
quick actions and the group separator while keeping the bell, starts the drawer closed, opens it at
256px with a backdrop and no collapse control, and reveals a 300px search field · no horizontal scroll
at 1440, 834 or 390.

**Responsive:** KPI grid measured at 4 / 2 / 1 columns · table confirmed to swap to
the card layout below 600px, rendering the same 5 rows as cards.

**Dark mode:** toggle flips `.dark`, body background actually changes
(`rgb(23,18,19)` ↔ `rgb(255,248,248)`), `colorScheme` stays in sync, choice persisted.

**Breadcrumbs:** nested trail "Account › Change password", last crumb marked
`aria-current="page"` and rendered as text with only the ancestor as a link.

**Components:** debounced search filtering to 1 row · empty state with its custom
message · clear button restoring all rows · sortable header reporting
`aria-sort="descending"` · paginator advancing and showing the remaining 2 rows ·
spinner appearing and clearing · success toast · confirm dialog with `role="dialog"`,
the detail line, focus on **Cancel** for the destructive variant, and Escape and
backdrop clicks both resolving to declined while explicit confirm acts.

**Icons:** all 35 names in use measured as single 24px glyphs (a control with a
deliberately invalid name measured 432px, confirming the check detects failures).

**Rail offset:** content `margin-left` measured at 256px expanded and 72px in rail
mode, so no dead space remains.

Screenshots were reviewed at 1440×900 (light, dark, rail), 834×1112 and 390×844
(cards, drawer open), plus the profile page and the confirm dialog.

### List-page redesign — 84 further checks

Six pages, twelve structural checks each, plus behaviour. All 84 passed, in headless Chrome against the
live API.

**Per page** (Inventory, Purchases, Transfers, Suppliers, Consumption): header computing
`position: sticky` with its own background · scroller at `overflow-y: auto` with a 600px ceiling ·
`pb-table-striped` applied *and* odd/even cell backgrounds measured as different values · selection
column present · density toggle present · toolbar present · **zero** remaining `.bg-error-container`
banners · paginator carrying `pb-paginator` · `<colgroup>` emitting one `<col>` per column · no
horizontal page scroll.

**Daily sales** has no rows in this dataset, so it renders the empty state instead — asserted as a real
empty state with the tiled icon rather than skipped over.

**Density:** toggle measured 52px → 40px, persisted as `"compact"`, still 40px after a reload.

**Selection:** select-all reported "25 selected", 25 rows carried `pb-row-selected`, and the bulk bar
offered CSV export.

**Chips:** applying the low-stock filter added a chip reading "Needs restocking only"; pressing its ×
removed that filter and the chip with it.

**Skeleton:** with the route chunk warmed and only the API delayed, first load rendered **54 skeleton
placeholders, 0 rows, 0 spinners, exactly one `role="status"`** and 6 header bars — which is how the
first version was caught drawing only 3 bars for an 8-column table, having filtered by `hideOnMobile`
inside a desktop-only branch.

**Mobile (390px):** cards rather than a table, density toggle hidden, no horizontal scroll.

**Regression:** the 64-check shell suite and the 12-check Analytics/Reports/design-system suite both
still pass, so the shared `pb-card`, `pb-empty-state` and `pb-chart` changes did not disturb the screens
outside this work.

### Form redesign — 63 further checks

Twelve forms, in headless Chrome against the live API. 63 of 64 passed; the one failure is a
`POST /auth/login` 401 that the harness **causes on purpose** by submitting bad credentials to exercise
the sign-in error path.

**Every dialog** (supplier, item, transfer, consumption, daily sales): shell renders with a title,
subtitle and tinted icon tile · close button present · 16px radius and a 1px border · body computing
`overflow-y: auto` with a 1px-divided footer · submit measured as a genuinely filled button
(`rgb(186, 0, 92)`) · form carrying `pb-form` · **zero** remaining `.bg-error-container` or
`.bg-tertiary-container` markup.

**Validation:** submitting the supplier dialog empty produced "Name is required." and "State is
required." in `--color-pb-danger-fg`, not Material's error red.

**Purchase page:** three steps rendered as a `nav` labelled "Purchase progress", each announcing
"step N of 3, complete / not complete" to a screen reader · footer computing `position: sticky` and
carrying both the running total and the submit.

**Login:** uses `pb-form`, heading on the `pb` scale, and a real sign-in failure renders
`pb-inline-alert` with `role="alert"`.

**Change password:** the strength checklist is boxed inline help, the footer is divided, and the
hardcoded `text-green-600` — the last Tailwind colour left in these forms, which does not follow the
theme — is gone.

**Dropdowns:** select panels measured at a 12px radius with a hairline border and 40px options at an
8px radius, matching the shell menus.

**Mobile (390px):** dialog actions compute `flex-direction: column-reverse`, so the primary action is
the lowest thing on screen; no horizontal scroll.

**Regression:** the 84-check list-page suite, the 20-check dashboard suite and the 64-check shell suite
all still pass.

### Not verified in the form redesign

- **A successful submit end to end** for every form. The busy state, the disabled-but-full-contrast
  button and the toast are exercised on the supplier dialog; the other eight were verified structurally.
- **The POS payment sheet and order screen.** Both are forms and both were deliberately left alone —
  they sit on the brand-fixed `pos-light-surface`, where `pb-form`'s themed error colour and date
  indicator would need checking against cream rather than against the app surface.
- **Screen-reader output.** `role="group"`, `aria-labelledby`, `aria-busy` and the step announcements
  are in place and asserted structurally; no assistive technology was run.

### Not verified in the list redesign

- **Column resizing**, which is not implemented — only the plumbing for it.
- **CSV export end to end.** The button is asserted and the generator runs, but no downloaded file has
  been opened in a spreadsheet; the BOM and the quoting are reasoned, not proven.
- **Selection across pages.** Keys for rows on other pages are retained but deliberately not counted or
  exported, and that has not been exercised beyond a single page.
- **A tenant with twenty categories.** The chip wording and the ranked bar scale to it; this dataset has
  five.

### Not verified

- Real touch input, and iOS/Safari specifically — Chrome device emulation is not the
  same thing. Check the drawer and the mobile search row on a physical device.
- Screen-reader output. ARIA roles, labels and `aria-current` are in place and were
  asserted structurally, but no assistive technology was actually run.
- Print styles and RTL, neither of which has been considered.

## 11. The consistency audit

A pass over all 13 routes as a reviewer rather than an author: measure what renders, not what the class
lists claim. Three findings were worth the sweep; the rest of the audit is recorded here so the next
person does not re-derive it.

### Finding 1 — the typography was two systems (fixed)

The largest single defect in the app, and invisible in code review because the class names looked
right. Written up in §4 above with the mapping and the measurements. 238 occurrences across 32 files;
329 rendered elements; every page's `h1` was the browser's 32px/700.

### Finding 2 — the rose palette made theme roles useless as status (fixed)

`mat.theme()` is configured with `mat.$rose-palette`, so `primary`, `secondary`, `tertiary` and
`error` are all pink or near-pink. Any code that reached for a *theme role* to mean a *state* was
therefore drawing the same colour for opposite meanings. Measured collisions:

| Where | Before | Problem |
| --- | --- | --- |
| POS order status | `PAID` → `tertiary-container`, `CANCELLED` → `error-container` | Paid and cancelled were the same pink; only the icon differed |
| Dashboard tasks panel | critical → `error-container`, warning → `tertiary-container` | Two pinks, in the one panel whose job is ranking what to do first |
| Activity feed | rise → `secondary-container`, fall → `tertiary-container` | Two pinks — *and* the number beside them was already green/red, so one row made two contradictory claims about direction |
| Transfer detail | approved / rejected / completed → `secondary` / `error` / `bg-primary` | Three shades of pink; `bg-primary` made a finished transfer the loudest thing in the dialog |
| Analytics food-cost warning | `border-error bg-error-container` | A warning wearing the error colour, and a pink rule that read as an accent |
| Dashboard error state | `text-on-error-container` **with no container** | A foreground token used alone: low-contrast pink text on a plain card |

All of these now use the design system's semantic tones (`pb-tone-neutral|info|success|warning|danger|
accent`), which are fixed hues chosen deliberately *outside* the brand. Verified at runtime: all six
resolve in both light and dark, no two collide, and all twelve foreground/background pairs clear
4.5:1 (tightest is light-mode `accent` at 4.55:1).

Three hardcoded `text-green-600 dark:text-green-400` survivals became `text-pb-success-fg`, and their
`text-error` counterparts became `text-pb-danger-fg` — the down-case was pink before.

**The rule:** a theme role describes brand, a tone describes state. On a palette whose brand hue is
near red, only tones can carry status. Reach for `pb-tone-*` or `pb-status-badge`, never
`*-container`, when the colour means something.

### Finding 3 — components existed but were not adopted (fixed)

Several shared components had been built and then used once, while call sites kept their hand-rolled
copies. Six metadata chips each had their own padding — `px-2.5 py-0.5`, `px-2 py-0.5`, `px-3 py-1`,
`px-2.5 py-1` — which is where "inconsistent spacing" actually comes from: not from carelessness, but
from four people solving the same problem four times. Adopted in this pass:

- `pb-status-badge` — the POS status map now supplies a *tone* instead of a class string, and both
  consumers dropped their hand-built pills. The component's own docstring had already named this map
  as one of the five copies it was written to replace.
- `pb-inline-alert` — the two failure panels whose message is a single string.
- `pb-error-state` — the dashboard's error branch, its second adopter.
- `pb-submit-button` — the change-password form, which was the tenth form and the only hand-rolled
  one. That hand-rolled version carried a real defect the compiler had been reporting all along:
  with two root nodes per `@if` branch, Angular cannot project a `mat-icon` into `MatButton`'s icon
  slot, so the icon rendered without the slot's spacing.
- `pb-badge pb-badge-pill` — all six metadata chips, one geometry.

### Loading — the dashboard no longer spins

`pb-dashboard-skeleton` mirrors the real band geometry: hero beside a 2×2 tile grid, then per band a
heading, a three-cell metric strip and two chart cards. The point is not the shimmer, it is the
height. A centred spinner occupies one line, so when data landed the page grew from ~80px to ~2000px
in a single frame and everything the eye had settled on jumped. 50 bars, 1376px tall, one `sr-only`
`role="status"` message with the bars `aria-hidden` — a screen reader wants "loading your dashboard",
not sixty empty boxes.

Only two bands are drawn; below ~1400px the third is off-screen at first paint.

### What the audit checked and found clean

- **No horizontal overflow** on any of the 13 routes at 1440×1000.
- **Heading order** — no skipped levels; `pb-empty-state`'s title is a `<p>`, so a placeholder never
  claims to outrank the card containing it.
- **`pb-tone-*` are real utilities**, unlike the `mat-*` classes they replaced — probed in both modes
  rather than assumed.

### Not done, and why

- **Spacing.** 401 raw Tailwind steps against 293 `pb-` steps in features. Most raw steps are inside
  one component and internally consistent, so a blanket rewrite would churn every file to fix
  something nobody can see. The chips above were the case where it *was* visible.
- **Skeletons for the remaining seven spinners** — analytics, reports, notifications, profile,
  pos-home and three dialogs.
- **`pb-stat-card`** still applies `tabular-nums` to a display figure, which the dataviz guidance
  calls out: tabular figures are for columns that must align, and they make a headline number look
  mechanical. It is used on 8 pages and worth a pass of its own.
- **A fresh WCAG sweep.** Contrast was computed for the tones introduced here; a full axe run over
  the app after this and the experience layer has not happened.
- **The bundle is 14.67 kB over its 640 kB raw warning budget** (it was already 7.75 kB over before
  this pass). Recorded rather than silenced — raising the budget to make the warning go away would be
  the wrong fix.

  All of this pass's growth is in the stylesheet: **84.79 → 91.71 kB raw, 12.45 → 13.04 kB
  transferred**, for +1.0 kB on the initial transfer (156.9 kB total). That is the direct cost of the
  typography working. Tailwind only emits utilities that are used, and the `mat-*` classes it replaced
  emitted *nothing* — being inert was exactly why they were free. Roughly half a kilobyte over the
  wire to stop every heading in the app rendering at a size nobody chose.
