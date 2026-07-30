# Production readiness review

A pass over the twelve areas requested, measured rather than assumed. Findings are listed
with what was changed — and, where nothing was, why.

`372` TypeScript files, `~43,800` lines, `152` backend tests, `51` frontend tests.

---

## Findings and fixes

### 1. Accessibility — one real violation, now fixed

Audited with **axe-core against WCAG 2.1 A + AA** on seven routes, in light and dark, at
desktop and 390 px. Not by grepping for `aria-` attributes, which proves nothing.

Desktop was clean. At mobile width, `pb-data-table` raised a **serious** violation:

> `<ul>` and `<ol>` must only directly contain `<li>`, `<script>` or `<template>` elements

The mobile card layout put `role="button"` on the `<li>` itself. That makes it announce as a
button and therefore stop being a list item, so the `<ul>` had no valid children and the
list announced nothing at all. It also hand-rolled keyboard support with `tabindex` plus
`keydown.enter`, which never handled Space.

Fixed by nesting a real `<button>` inside the `<li>`, sharing one `ng-template` for the card
body so the interactive and static variants cannot drift. Space, Enter and the focus ring
now come from the platform. **Every list screen on mobile was affected**, since they all use
this component.

Re-audited: **zero violations across all seven routes, including minor**, in dark mode at
390 px.

### 2. Error handling — a leak the tests found

`toAppError` returned the raw `message` of any non-HTTP `Error`. A null dereference put
*"Cannot read properties of undefined (reading 'trim')"* straight into a toast: useless to
the user and a description of the code's shape.

Now replaced with the generic message, with the original preserved on `cause` so the logger
and any future error reporter still get it. The two audiences want different sentences.

Everything else here was already sound: five ordered interceptors, one conversion point, a
non-envelope response never rendered verbatim, `x-request-id` carried through for
correlation.

### 3. Security — one subtle regression

Config was solid — helmet, CORS allowlist, credentials, bounded bodies, rate limiting,
`x-powered-by` off, httpOnly rotated refresh tokens, `.env` gitignored with no committed
secrets, zod-validated env that fails fast at boot.

The bug: the two export controllers called
`res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')`, which **replaces**
the value CORS set rather than adding to it. Verified against a live response — on export
endpoints the browser could no longer read `x-request-id`, so precisely the requests most
likely to fail were the ones that could not be traced to a log line.

`Content-Disposition` is now declared once in the CORS `exposedHeaders` allowlist and both
manual calls are gone.

### 4. Misleading numbers — captioned

The inventory list's `Needs restocking`, `Home Warehouse` and `Cart` tiles count the
**loaded page**, while `Items` is the filtered total. `Needs restocking 25` beside
`Items 40` reads as an inventory-wide figure and is not one.

Each now carries `of 25 on this page` — and only when the page actually holds less than the
filter matched, so it is information rather than boilerplate. Fetching a filtered aggregate
instead would mean a second request per keystroke for a number the dashboard already shows
inventory-wide.

### 5. Code duplication — the money formatter

`toLocaleString('en-IN', …)` was copy-pasted into **nine** files, and the copies had already
diverged: some rounded to whole rupees, some to paise, one took a `decimals` parameter.
Formatting looks too trivial to share right up until two screens quote different figures for
the same value.

Consolidated into `shared/utils/format.utils.ts` — `money`, `moneyCompact`, `quantity`,
`count`, `toDateInput`, `calendarDate`, `timestamp`, `percentOf`, `plural` — and every call
site now uses it. The locale is hard-coded so a laptop set to `en-US` cannot silently
reformat the accounts.

### 6. Tests — the largest gap, now started

**Zero frontend specs against 372 files.** That was the single biggest production risk, and
it is what let findings 2 and 5 survive this long.

Added 51 specs over the code everything else depends on:

| Suite | Covers |
|---|---|
| `format.utils.spec.ts` | lakh grouping, em dash for absent values, the `toISOString` day-shift trap |
| `app-error.spec.ts` | envelope unwrapping, network failures, and that no raw body or stack reaches the user |
| `form.utils.spec.ts` | server errors projected onto controls, and unmatched messages returned rather than dropped |
| `auth.service.spec.ts` | permission checks, including that `canAll([])` is vacuously true — which is why the directive also checks authentication |

`app-error.spec.ts` **failed on first run and found finding 2.** That is the argument for the
suite in one line.

### 7. Regression suites — made self-sufficient

The browser suites depended on data left behind by earlier sessions, so they passed or
failed on ambient state. One reported "six reports" after a seventh was added; another
needed sales days that had since been cleaned up; a third silently passed a badge assertion
against `"0"`.

All three now establish their own preconditions — the sales suite seeds its days through the
API and **asks the API which day is free** rather than hard-coding one, because there is
deliberately no delete route for a recorded day. The notification suite prints
`NOTE nothing is unread, so the mark-read checks below cannot be exercised` instead of
passing quietly. A suite that cries wolf gets ignored when it is right.

---

## Areas already in good shape — changed nothing

Reviewed and left alone, because churning them would add risk without adding value.

**Folder structure.** Clean architecture is enforced by lint, not convention:
`core/domain` → `core/application` → `infrastructure` → `presentation`. Every backend
feature is the same seven files; every frontend feature is
`models/ services/ components/ pages/ *.routes.ts`. Consistent across eleven features.

**Lazy loading.** Every route is `loadChildren`/`loadComponent`; every layout is lazy too.
Initial bundle **586 kB raw / 146 kB transfer**, which is healthy for Angular Material.
ApexCharts is the largest dependency at 140 kB transfer and already sits in a lazy chunk
reached only by the three charting routes.

**Performance.** `OnPush` on every component; zoneless change detection; signals throughout;
server-side paging, filtering and sorting with nothing sorted client-side; `trackBy` on the
lists that have stable ids; aggregates computed in SQL rather than by fetching rows to count
them; a request-sequence guard in every store so a slow response cannot overwrite a newer
one; `compression()` on the API.

**Validation.** zod at every HTTP boundary, domain invariants in entities, and the two
enforced independently — the sales module rejects a future date in the validator *and* in
the use case, so no caller can bypass it. Partial unique indexes hand-written where Prisma
cannot express them.

**Reusable components.** Twelve shared components already carry the app: one generic table
serves eight list screens, one chart wrapper serves every chart, one dialog service, one
paginator. The data-table fix above improved all eight at once.

**Responsive design.** Verified at 390 px on every screen: no horizontal page scroll
anywhere, tables become card lists, wide content scrolls inside its own container.

**Loading states.** Every store exposes `loading()`; tables overlay a spinner on refresh
rather than unmounting, so scroll position survives; dialogs disable their submit while
saving.

---

## Remaining gaps

Named rather than quietly left.

- **Frontend test coverage is a foundation, not a suite.** 51 specs cover shared utilities
  and permissions. No component or store has a spec yet; the eleven feature stores are the
  obvious next target, and they are where a regression would hurt most.
- **No end-to-end suite in CI.** The browser verifications live in a scratchpad and are run
  by hand. They should be committed and wired into a pipeline to be worth anything long-term.
- **No CI pipeline at all.** Typecheck, lint and both test suites are run manually.
- **Food cost is unreliable until inventory is priced.** 32 of 40 items have no purchase
  price. Analytics flags this rather than printing a flattering number, but it is a
  data-entry task blocking a real metric.
- **Notifications are polled, and the alert sweep is a singleton.** Documented in
  [NOTIFICATIONS.md](./NOTIFICATIONS.md); needs SSE and a shared lock to scale past one API
  instance.
- **`DATABASE_POOL_MAX` defaults to 1 in development** because PGlite cannot serve
  concurrent sessions, which means local load never exercises the row locking that stock
  adjustments depend on. Point at a real Postgres to test that path.
