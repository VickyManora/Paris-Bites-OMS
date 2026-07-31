# Paris Bites — Inventory Management System

Inventory management for a dessert business. Angular 20 SPA + Express/Prisma API.

> **Status: working stock, buying and reporting system.** Authentication, the responsive
> application shell, the **inventory module** — items across two locations with search,
> filters, sorting, pagination, stock adjustment, low-stock warnings and change history —
> **stock transfers** from the Home Warehouse to the Cart with a two-phase approval
> workflow, **supplier management**, **purchase invoices** with GST and automatic stock
> increase, **daily consumption** with automatic stock decrease and an edit audit trail,
> **role-split dashboards**, **seven exportable reports**, an **in-app notification inbox**
> with low-stock and expiry alerts, **daily sales** entry per channel, an **analytics** page
> covering revenue, food cost and trends, and a **walk-in point of sale** with a seeded product
> catalogue are implemented and verified end to end against a real PostgreSQL database and a
> real browser.
>
> **Not built yet:** purchase orders, recipes, and user management. See *Known gaps* below.

- **[INVENTORY.md](./INVENTORY.md)** — inventory model, stock rules, concurrency, REST API
- **[TRANSFERS.md](./TRANSFERS.md)** — two-phase transfer design, transactional guarantees, audit trail
- **[PURCHASES.md](./PURCHASES.md)** — supplier invoices, GST treatments, automatic stock increase
- **[CONSUMPTION.md](./CONSUMPTION.md)** — daily usage entry, automatic stock decrease, edit audit trail
- **[POS.md](./POS.md)** — walk-in point of sale, server-side pricing, order numbering, role split
- **[SALES.md](./SALES.md)** — daily takings per channel, one entry per day, corrections on the record
- **[DASHBOARD.md](./DASHBOARD.md)** — role-split dashboards, derived tasks, what the charts do and don't sum
- **[REPORTS.md](./REPORTS.md)** — seven reports, one definition per report, Excel/PDF export, financial projection
- **[ANALYTICS.md](./ANALYTICS.md)** — revenue, food cost, top sellers and trends on one shared axis
- **[NOTIFICATIONS.md](./NOTIFICATIONS.md)** — seven event types, the alert sweep, ownership instead of permission
- **[UI.md](./UI.md)** — shell, component library, responsive strategy, dark mode
- **[DESIGN-SYSTEM.md](./DESIGN-SYSTEM.md)** — tokens, components and style utilities; live reference at `/design-system`
- **[AUTHENTICATION.md](./AUTHENTICATION.md)** — token design, roles/permissions, CSRF, login defences
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — layers, dependency rule, decisions and why
- **[CONVENTIONS.md](./CONVENTIONS.md)** — naming and folder conventions
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** — deploying to Vercel, Render and Neon on free tiers, and what free costs you
- **[TESTING.md](./TESTING.md)** — hand-testing walkthrough in dependency order, plus how to break the network paths
- **[REVIEW.md](./REVIEW.md)** — production-readiness review: what was audited, fixed, and left alone

## Roles

| Role | Access |
|---|---|
| `ADMIN` | Everything (granted all permissions by construction) |
| `STORE_MANAGER` | Products, stock adjustments, suppliers, purchase orders, reports |

Store Manager is withheld user administration, the audit log, product deletion,
stock write-offs, purchase-order approval and financial reporting. See
[AUTHENTICATION.md](./AUTHENTICATION.md#1-roles-and-permissions) for the reasoning.

---

## Stack

| | |
|---|---|
| **Frontend** | Angular 20 (standalone, zoneless, signals), Angular Material 20, Tailwind CSS 4, TypeScript 5.9 strict |
| **Backend** | Node 22, Express 5, Prisma 7, PostgreSQL, JWT, zod, pino |
| **Deploy** | Angular → Vercel · API → Railway · Postgres → Neon |

---

## Quick start

Requires **Node 22+** and a PostgreSQL database (local, or a free Neon branch).

```bash
# 1. Install both apps (this repo is not an npm workspace — see ARCHITECTURE.md)
npm install
npm run install:all

# 2. Configure the backend
cd backend
cp .env.example .env

# Generate two different secrets and paste them into .env:
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET

# Set DATABASE_URL to your Postgres instance, then:
npm run prisma:migrate     # apply the schema
```

> **On the local database and `DATABASE_POOL_MAX`.** `prisma dev` runs PGlite — Postgres
> compiled to WebAssembly — and funnels every connection into a single backend session, so
> a transaction on one connection and a query on another interleave there and corrupt it.
> The pool therefore defaults to **1 connection in development**, which serialises queries
> and makes the overlap impossible. It costs nothing locally (~17 ms a request) but it does
> mean local load cannot exercise the row-locking that stock adjustments rely on. Point
> `DATABASE_URL` at a real Postgres and set `DATABASE_POOL_MAX=10` to get real concurrency:
>
> ```bash
> docker run --name paris-bites-db -e POSTGRES_PASSWORD=postgres \
>   -e POSTGRES_DB=paris_bites -p 5432:5432 -d postgres:17
> ```

```bash

# Seed one account per role. Passwords are never defaulted — an account is
# skipped unless its password is set (min 10 chars). Re-running is safe and
# never overwrites an existing account.
SEED_ADMIN_PASSWORD='AdminPass123' \
SEED_MANAGER_PASSWORD='ManagerPass123' \
  npm run prisma:seed
cd ..

# 3. Run both apps
npm run dev
```

- API → http://localhost:4000/api/v1
- App → http://localhost:4200

Sign in at http://localhost:4200 with `admin@parisbites.local` or
`manager@parisbites.local` and the passwords you seeded. The dashboard lists the
permissions the API granted, so the difference between the two roles is visible
immediately.

**No local Postgres?** `cd backend && npx prisma dev -d` starts one, then point
`DATABASE_URL` at the `postgres://…` TCP URL it prints. Note it is a proxy that
does not support shadow databases, so use `prisma migrate deploy` rather than
`migrate dev` against it.

Verify the API independently:

```bash
curl http://localhost:4000/api/v1/health/live    # 200 — process is up
curl http://localhost:4000/api/v1/health/ready   # 200 — database reachable
```

---

## Scripts

Run from the repo root:

| Script | Does |
|---|---|
| `npm run dev` | Both apps concurrently, with reload |
| `npm run dev:api` / `dev:web` | One app only |
| `npm run build` | Production build of both |
| `npm run typecheck` | `tsc --noEmit` across both |
| `npm test` | Test suites for both |
| `npm run db:migrate` | Create and apply a migration |
| `npm run db:seed` | Seed the first admin (idempotent) |
| `npm run db:studio` | Prisma Studio |

Each app also has `lint`, `lint:fix` and `format`.

---

## Layout

```
paris-bites-OMS/
├── backend/
│   ├── prisma/                    schema, migrations, seed
│   └── src/
│       ├── config/                zod-validated environment
│       ├── core/
│       │   ├── domain/            entities, enums, errors, repository interfaces
│       │   └── application/       use cases, DTOs, mappers, ports
│       ├── infrastructure/        Prisma, bcrypt, JWT, pino, DI container
│       ├── presentation/http/     routes, controllers, middleware, validators
│       ├── shared/                Result, pagination, HTTP status, API types
│       ├── app.ts                 Express app factory (no listen)
│       └── main.ts                entrypoint: socket + graceful shutdown
│
└── frontend/src/
    ├── app/
    │   ├── core/                  auth, http + interceptors, errors, config
    │   ├── shared/                components, directives, pipes, validators
    │   ├── layouts/               main + auth shells
    │   └── features/              one lazy-loaded folder per capability
    ├── environments/              per-build configuration
    └── styles/tailwind.css        Tailwind entry (see ARCHITECTURE.md)
```

---

## What is already wired up

**Authentication** — login/logout; 15-minute JWT access tokens; 7-day opaque
refresh tokens stored only as SHA-256 digests, rotated on every use with reuse
detection that revokes the whole session; bcrypt (cost 12); permission-based
authorization; session persistence across reloads; CSRF protection on the
cookie-authenticated routes; audit trail for every auth event. Full rationale in
[AUTHENTICATION.md](./AUTHENTICATION.md).

**Backend** — layered architecture with the dependency rule enforced by lint;
zod-validated environment that fails fast at boot; one error exit point mapping
domain, zod and Prisma failures onto a stable envelope; correlation IDs on every
request and log line; helmet, CORS allowlist, rate limiting (tighter on auth
routes, counting failures only); liveness and readiness probes; graceful shutdown
on `SIGTERM`; 152 unit tests that need no database.

**Frontend** — zoneless change detection with signal-based state; lazy-loaded
features and layouts; five ordered interceptors (URL, loading, error, auth
refresh-and-replay, retry with jittered backoff); `authGuard` / `guestGuard` /
`permissionGuard` / `roleGuard` plus `*pbHasPermission` and `*pbHasRole`
directives; access token held in memory only (never `localStorage`), with silent
session restore from an httpOnly cookie; login and change-password forms with live
policy feedback and server-error projection onto the right field.

**Layout** — responsive shell with a collapsible sidebar (256px ↔ 72px rail ↔ mobile
drawer), topbar with breadcrumbs / search / theme toggle / account menu, and a
component library: card, server-paginated table that becomes a card list on mobile,
paginator, debounced search box, breadcrumbs, spinner, stat card, empty state, page
header, confirmation dialog and toasts. Material 3 + Tailwind share one token palette,
so dark mode themes the whole page. Details in [UI.md](./UI.md).

**Inventory** — items at Home Warehouse and Cart, in kg / grams / liters / pieces /
boxes across 13 categories. Add, edit, delete (soft), search over name and notes, filter
by category / location / unit / status / needs-restocking, sort on 8 columns, paginate —
all server-side. Stock adjustment is a separate operation from editing details, is
row-locked so concurrent changes cannot lose updates, and writes its history entry in the
same transaction. Low-stock status is derived from current versus minimum quantity, never
stored. Full change history per item. Details in [INVENTORY.md](./INVENTORY.md).

**Notifications** — a topbar bell with an unread badge and a notification centre holding
the full paginated history, fed by seven event types from three kinds of source. The
transfer workflow (a request notifies every active admin; approve / reject / complete
notify the requester, with the rejection reason carried in the message), recorded purchase
invoices, and a timed sweep that raises low-stock and expiry alerts — the two conditions
that become true on their own, with nothing to hook. Alerts route to whoever can take the
first action (a warehouse shortage to the admins who buy, a cart shortage to the manager
who raises the transfer) and are de-duplicated per item for a day, because a low item is
still low fifteen minutes later and ninety-six copies of the same row is how a bell gets
ignored. Details in [NOTIFICATIONS.md](./NOTIFICATIONS.md). Rows are fanned out at
write time, one per recipient, so the badge is a single indexed count rather than an
anti-join. Delivery can never break the operation that caused it — the notifier and its
repository both swallow and log their failures, because by then a stock movement has
already committed. Inboxes are protected by **ownership, not permission**: the recipient
comes from the verified token and is part of every `where` clause, so an admin — who holds
every permission by construction — still cannot read or clear a Store Manager's bell.
Marking read is idempotent, and every mutation returns the fresh unread count so the badge
is never computed client-side. The badge polls once a minute; the panel refetches on open.

**Stock transfers** — Home Warehouse → Cart in two phases, because goods physically leave
before they arrive: approval deducts the source (`In transit`), completion credits the
destination. Both legs are interactive transactions that lock the affected rows in a
deterministic order and write their history in the same transaction, so a rollback cannot
leave stock and history disagreeing. The state machine is a table, not scattered `if`
statements, and the same table drives both the server's guards and the buttons the UI offers.
Approval is admin-only — whoever raises a request cannot authorise it — while completion is
not, so arriving stock is never stranded. Every transition is audited, including refused
approval attempts and why they were refused. Details in [TRANSFERS.md](./TRANSFERS.md).

**Point of sale** — walk-in orders at the counter, built for a ten-to-fifteen second order:
tap product cards, adjust quantity on the cart line, one tap to the payment sheet, and the
cart resets itself for the next customer. The whole cart is local signal arithmetic and the
payment rides on the create call, so an order is **one** network round trip. Prices are never
taken from the request — every line is priced from the product row and snapshotted, so
repricing the menu cannot rewrite past orders. Discounts need a reason, and the Store Manager
20% ceiling is checked against the *effective* percentage so a flat amount cannot bypass it.
Order numbers (`PB-20260728-0001`) come from a per-day counter incremented inside the order
transaction, not a `count(*) + 1` that would hand two tills the same number. Orders feed the
dashboard, reports and analytics as the **counter's** record shown beside the declared daily
total and never added to it — the dashboard reconciles the two and names the variance. Reading is scoped
in the use case — an admin sees every order, a Store Manager sees their own from today — and
only cancellation is gated higher. Details in [POS.md](./POS.md).

**Daily sales** — one entry per trading day, split into walk-in cash, walk-in online,
Zomato and Swiggy. Deliberately a daily figure rather than a record of each sale: there is
no till that itemises, and a total that actually gets entered every evening is worth more
than a line-item model that does not. One entry per day is enforced by a partial unique
index, and the form uses the same fact to switch into *correcting* a day already recorded
rather than rejecting four figures on submit. Corrections require a reason and keep the
previous total on the record. Admin-only, both reading and writing, because revenue is
financial data and the day is reconciled against a bank statement and two aggregator
dashboards. Today's takings, month to date and a per-channel breakdown appear on the admin
dashboard — with an unrecorded day shown as `—` rather than ₹0.00, because "not entered
yet" and "took nothing" are different facts. Details in [SALES.md](./SALES.md).

**Analytics** — revenue, food cost, inventory value, most-used ingredients and the
purchase/transfer/revenue trends over a period you pick, at day, week or month grain. All
four trends are bucketed by one `generate_series` in one statement, so every chart shares an
identical x-axis and a purchase spike can be read against the revenue dip beside it. The
page's real work is refusing to overstate: revenue says how many days of the range were
actually entered, a partially-entered month is marked on its own bar, food cost is flagged
as *understated* whenever a consumed ingredient has no price, and inventory value is
labelled "today" everywhere because there is no stock ledger to value a past date from.
Excel (one sheet per dataset) and PDF export. Admin-only. Details in
[ANALYTICS.md](./ANALYTICS.md).

**Reports** — nine reports (inventory, purchases, transfers, consumption, suppliers, low
stock, sales, POS orders, product sales) with date-range, location, supplier and search filters, server-side sorting and
paging, a chart each, and Excel/PDF download. Each report declares its columns **once**;
the table, the spreadsheet and the PDF all render from that definition, so they cannot
drift. Totals are SQL aggregates over the whole filtered set rather than sums of the page,
and an export contains every matching row, not the 25 on screen. The filters in force are
worded server-side and printed onto the file, so an exported sheet always says which period
it covers. Columns marked `financial` are *projected out* for callers without
`REPORT_VIEW_FINANCIAL` — removed from the columns, the rows, the totals and the charts,
in the export as well as on screen. Details in [REPORTS.md](./REPORTS.md).

---

## Deployment

Both platforms build from a subdirectory — set the **Root Directory** accordingly.

### Neon

Create the database and take two connection strings:

- **pooled** → `DATABASE_URL` for the running API
- **direct** → for `prisma migrate deploy`, which needs advisory locks the pooler
  does not support

### Railway (API) — Root Directory `backend`

Config is in `backend/railway.json`. Set:

```
NODE_ENV=production
DATABASE_URL=<neon pooled url>
JWT_ACCESS_SECRET=<48+ random bytes>
JWT_REFRESH_SECRET=<different 48+ random bytes>
CORS_ORIGINS=https://<your-app>.vercel.app
LOG_LEVEL=info
```

`PORT` is injected by Railway. Health check is `/api/v1/health/ready`; migrations
run as a pre-deploy step, not during build.

### Vercel (app) — Root Directory `frontend`

Config is in `frontend/vercel.json`: SPA rewrite, security headers, immutable
caching for fingerprinted assets, and no caching for `index.html`.

Angular does not read `.env`. Before the first deploy, set the production API URL
in `frontend/src/environments/environment.ts` and confirm that origin is listed in
the backend's `CORS_ORIGINS`.

---

## Adding a feature

The scaffolding is designed so this is mechanical. To add *Products*:

**Backend**
1. Add the model to `prisma/schema.prisma`; `npm run prisma:migrate`.
2. `core/domain/entities/product.entity.ts` and
   `core/domain/repositories/product.repository.ts` (interface).
3. `core/application/use-cases/products/*.use-case.ts`, plus a DTO and mapper.
4. `infrastructure/database/repositories/product.prisma-repository.ts`.
5. Register both in `infrastructure/container/container.ts`.
6. `presentation/http/routes/product.routes.ts` + controller + zod validators;
   mount it in `presentation/http/routes/index.ts`.

**Frontend**
1. `features/products/` following the shape in [CONVENTIONS.md](./CONVENTIONS.md#4-feature-folder-shape).
2. Build the list page from the existing components — see the worked example in
   [UI.md](./UI.md#6-building-a-list-page). The dashboard is the reference.
3. Register the lazy route in `app.routes.ts` with `permissionGuard` + `withAccess`,
   add `withBreadcrumb`, and uncomment the matching nav entry in
   `layouts/components/app-sidebar/app-sidebar.component.ts`.

Lint enforces the boundaries as you go: the domain cannot import Prisma, and one
feature cannot import another.

---

## Known gaps

- **No purchase orders or recipes.** Suppliers and purchase *invoices* are implemented
  (see [PURCHASES.md](./PURCHASES.md)). A purchase *order* — the requested-and-awaited half
  of buying — is not, and `Recipe`/`RecipeIngredient` exist as tables that no code reads.
- **Sales are a daily total, not a record of each sale.** Deliberate — see
  [SALES.md](./SALES.md) — but it has two consequences: ingredient usage cannot be derived
  from a sale, so recipe-driven stock deduction stays out of reach and stock is drawn down
  by the separate consumption entry; and analytics cannot rank a top-selling product, which
  it says on the page and in its exports rather than omitting silently.
- **Selling a bowl does not draw down stock.** Linking a sold product to the chocolate it
  consumed needs recipes, which are still tables no code reads. Stock is drawn down by the
  separate consumption entry.
- **Food cost is only as good as the purchase prices.** A consumed item with no price counts
  as costing nothing, so the ratio is an understatement until the inventory is priced.
  Analytics flags this rather than printing a flattering percentage.
- **Notifications are polled, not pushed, and the alert sweep is a singleton.** The badge
  refreshes on a 60-second timer.
  Real-time delivery needs SSE or a websocket, which needs sticky sessions or a shared bus
  once the API runs on more than one instance. There is also no email or push — the bell is
  in-app only, and no notification preferences exist.
- **No CI pipeline, and thin frontend test coverage.** Typecheck, lint and both suites are
  run by hand; the browser verifications are not committed. 51 frontend specs cover the
  shared utilities and permission logic — no component or store has one yet. See
  [REVIEW.md](./REVIEW.md).
- **No stock-movement ledger.** Inventory history is an audit trail;
  `currentQuantity` is the source of truth. A `StockMovement` ledger would invert that.
- **Deleted items cannot be restored through the UI.** `restore()` exists on the
  repository and `RESTORED` is in the history enum, but no endpoint or screen exposes it.
- **Categories are a fixed enum.** Staff cannot add their own without a migration.
- **No password reset.** It needs transactional email, which this project has no
  provider for yet. Only an authenticated password *change* is implemented.
- **No user management UI.** New accounts come from the seed script. The
  permissions (`user:create`, `user:manage-roles`) and the repository methods
  exist; the endpoints and screens do not.
- **The development connection pool is capped at 1**, because the default local database
  (`prisma dev` / PGlite) cannot serve concurrent sessions. Correct and fast enough, but it
  means the row-locking in `adjustQuantity` is exercised locally by pool serialisation
  rather than by the database. Verifying the lock itself needs a real Postgres and
  `DATABASE_POOL_MAX` raised.

- **Rate limiting is per-process** (in-memory store). Running more than one
  Railway instance multiplies the effective limit — move to a Redis store before
  scaling horizontally.
- **Production cookie behaviour is unverified.** `SameSite=None; Secure` needs two
  real HTTPS origins; only the local same-site path has been exercised. Confirm
  sign-in works on the first cross-site deploy.
- **`npm audit` reports advisories in dev dependencies only** (the Prisma CLI's
  `@prisma/dev`, and eslint's `minimatch` chain). Nothing in the production
  dependency tree of either app.
- **The API contract is duplicated by hand** in two files. Generate it from
  OpenAPI once the surface grows.

- **Transfers cannot be partially completed or cancelled.** A transfer completes in full or
  not at all, and `APPROVED → REJECTED` is deliberately illegal because the source has
  already been deducted. Short deliveries and dispatch errors must be corrected with a
  separate inventory adjustment.

- **No committed integration or E2E suite.** The 93 transfer / 79 inventory API checks and
  the 63 transfer UI checks were run as scripts during development, not wired into CI. The
  84 committed tests cover the domain layer only.

- **Untested at scale.** The inventory module was exercised with ~12 items and 10
  concurrent writers. Confirm query plans and **size the connection pool deliberately
  before real load** — interactive transactions pin a connection for their whole duration,
  so the pool must stay below Neon's per-branch ceiling for your plan. The local default is
  4 rather than 10 because `prisma dev` is a proxy with its own `connection_limit=10` that
  drops connections when a pool sits at its ceiling.

See [AUTHENTICATION.md](./AUTHENTICATION.md#11-verified-behaviour),
[INVENTORY.md](./INVENTORY.md#7-verified-behaviour) and
[TRANSFERS.md](./TRANSFERS.md#8-what-has-been-verified) for exactly what has and has not
been exercised.
# Paris-Bites-OMS
