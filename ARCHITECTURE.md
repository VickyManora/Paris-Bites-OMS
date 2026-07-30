# Architecture

Paris Bites IMS is two independently deployable applications sharing one repository
and one API contract.

```
paris-bites-OMS/
├── backend/     Express + Prisma API      → Railway    (Postgres on Neon)
├── frontend/    Angular 20 SPA            → Vercel
└── package.json Dev-convenience scripts only (not an npm workspace — see below)
```

**Why not an npm workspace.** Vercel and Railway each install from their own
subdirectory. Workspace hoisting puts dependencies in a root `node_modules` that
neither platform's build uploads, so both deployments break in a way that never
reproduces locally. The root `package.json` therefore only delegates with
`--prefix`, and each app stays independently installable.

---

## 1. Backend — Clean Architecture

### The dependency rule

Everything follows from one constraint: **source-code dependencies point inward
only.**

```
   ┌─────────────────────────────────────────────────────┐
   │  presentation/     Express: routes, controllers,     │
   │                    middleware, validators            │
   │   ┌─────────────────────────────────────────────┐   │
   │   │  infrastructure/   Prisma, bcrypt, JWT,      │   │
   │   │                    pino, DI container        │   │
   │   │   ┌─────────────────────────────────────┐   │   │
   │   │   │  core/application/  use cases,       │   │   │
   │   │   │                     DTOs, ports      │   │   │
   │   │   │   ┌─────────────────────────────┐   │   │   │
   │   │   │   │  core/domain/  entities,     │   │   │   │
   │   │   │   │   enums, errors, repository   │   │   │   │
   │   │   │   │   interfaces                  │   │   │   │
   │   │   │   └─────────────────────────────┘   │   │   │
   │   │   └─────────────────────────────────────┘   │   │
   │   └─────────────────────────────────────────────┘   │
   └─────────────────────────────────────────────────────┘

           dependencies point inward  ───────────►
```

`core/domain` does not know Express, Prisma, or HTTP exist. `core/application`
knows the domain and its own ports, nothing more. Only `infrastructure` and
`presentation` touch libraries.

This is **enforced, not documented**. `backend/eslint.config.js` declares
`no-restricted-imports` for `src/core/**`, so the first `import { prisma }` in a
use case fails the build. Without that rule, Clean Architecture decays into a
folder-naming convention within a few sprints.

### What each layer owns

| Layer | Owns | Must not contain |
|---|---|---|
| `core/domain` | Entities, value objects, enums, error taxonomy, repository **interfaces** | Any import from a library or an outer layer |
| `core/application` | Use cases (one operation each), DTOs, mappers, service **ports** | Express, Prisma, HTTP status logic |
| `infrastructure` | Prisma repositories, bcrypt/JWT adapters, pino logger, DI container | Business rules |
| `presentation` | Routes, controllers, middleware, zod validators, response serializers | Business rules, direct Prisma access |

### Ports and adapters

Each outward dependency is an interface owned by an inner layer and implemented
outward:

| Port (inner) | Adapter (outer) |
|---|---|
| `domain/repositories/IUserRepository` | `infrastructure/database/repositories/UserPrismaRepository` |
| `application/ports/IHashService` | `infrastructure/security/BcryptHashService` |
| `application/ports/ITokenService` | `infrastructure/security/JwtTokenService` |
| `application/ports/ILogger` | `infrastructure/logging/PinoLogger` |

The payoff is concrete: a use case is testable with an in-memory fake and no
database, and bcrypt could be replaced with argon2 by writing one class.

### Composition root

`infrastructure/container/container.ts` is the only place that calls `new` on a
concrete class. `createContainer()` accepts overrides, which is how integration
tests substitute fakes. Manual construction is deliberate — the graph is small and
explicit, and a decorator/reflection DI framework fights strict ESM for no gain
at this size.

`main.ts` owns the process (socket, signals, shutdown). `app.ts` builds the
Express app without listening, so tests can drive it in-process.

### Request lifecycle

```
Request
  → requestContext       assign correlation id (x-request-id)
  → helmet               security headers
  → cors                 origin allowlist, credentials enabled
  → compression
  → express.json         bounded body (100kb)
  → pino-http            access log, reusing the correlation id
  → globalRateLimiter
  → route
      → authenticate     verify JWT     → req.user
      → authorize        check role
      → validate         zod: body/query/params, replaced with parsed output
      → controller       calls ONE use case
          → use case     business rules, via ports
              → repository → Prisma → Postgres
      → serializer       wraps in the response envelope
  → notFoundHandler      unmatched routes
  → errorHandler         the single exit point for every failure
```

Middleware order is load-bearing and commented at each step in `app.ts`.

### Error handling

Every deliberate failure is a `DomainError` subclass carrying a stable `code`, an
HTTP `status`, and an `isOperational` flag. `errorHandler` is the one place that
turns a failure into a response: it classifies (domain error → zod → Prisma code →
unknown), logs at a severity matching the kind, and emits the envelope.

Two rules matter for security:

- Unrecognised errors become a generic 500 in production. Stack traces and driver
  messages are exactly what an attacker wants and never useful to a client.
- Authentication failures never say *why*. `JwtTokenService` returns the same
  message for expired, malformed and wrongly-signed tokens.

### API response contract

Every response is one of two shapes, defined in
`backend/src/shared/types/api-response.ts` and mirrored in
`frontend/src/app/core/models/api-response.model.ts`:

```jsonc
// success
{ "success": true, "data": { }, "meta": { "requestId": "…", "timestamp": "…" } }

// failure
{ "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "…",
             "details": { "body.email": ["Already in use."] } },
  "meta": { "requestId": "…", "timestamp": "…" } }
```

Clients branch on `code`, never on `message`. `details` is keyed by dotted field
path so the frontend can project server validation onto the offending form
control — see `applyServerErrors`.

These two type definitions are the wire contract and must change together. Once
the API grows, generate them from an OpenAPI document rather than hand-syncing.

### Authentication

Summarised here; the full design, threat reasoning and verification record live in
**[AUTHENTICATION.md](./AUTHENTICATION.md)**.

Two token types, chosen for opposite reasons:

- **Access token** — short-lived (15m) signed JWT. Stateless, so authorising a
  request costs one signature check and no database round trip. The cost is that
  a role change or suspension only takes effect at expiry, which is why the
  lifetime is minutes.
- **Refresh token** — long-lived (7d) opaque random string, **not** a JWT,
  because it must be revocable and revoking a stateless token is a
  contradiction. Only its SHA-256 digest is stored, so a database leak cannot be
  replayed. Rotation records a successor (`replacedById`), which makes token
  reuse detectable.

On the client the access token lives **in memory only** (`TokenStorageService`).
A token in `localStorage` is readable by any script on the origin, so one XSS bug
becomes account takeover. The refresh token travels as an httpOnly cookie, which
JavaScript cannot read — the asymmetry is the whole point. A page reload therefore
starts with no access token, and `provideAppInitializer` silently exchanges the
cookie for a new one before the first route resolves.

### Authorization

Two roles — `ADMIN` and `STORE_MANAGER` — but **authorization is expressed in
permissions, not roles**. Routes declare a capability with
`requirePermission(Permission.STOCK_ADJUST)`; `permission.enum.ts` decides who
holds it. A role comparison scattered through the codebase becomes a bug the day a
third role appears, whereas a permission check keeps expressing the intent.

`ADMIN` receives `ALL_PERMISSIONS` by construction, so a newly added permission is
automatically available to admins and must be explicitly granted to anyone else —
failing closed rather than open.

The domain defines its own `Role` union rather than re-exporting Prisma's generated
enum, so persistence and domain stay decoupled; `UserPrismaMapper` bridges them
with an exhaustive `switch` that stops compiling if the two drift.

**Frontend checks are UX, not security.** The bundle ships to the browser, so
`permissionGuard`, `roleGuard`, `*pbHasPermission` and `*pbHasRole` only hide UI.
Every protected operation is authorised again server-side. The client does not even
derive permissions from the role — it uses the list the server sent, so the access
model has exactly one definition.

---

## 2. Frontend — feature-based, signal-first

```
src/app/
├── core/       app-wide singletons: auth, http, interceptors, errors, config
├── shared/     reusable and feature-agnostic: components, directives, pipes, validators
├── layouts/    routed application shells (main, auth)
└── features/   one folder per business capability, lazy loaded
```

The rule that keeps this from collapsing:

- `core/` — instantiated once, injected everywhere. Never imports from `features/`.
- `shared/` — no business knowledge. If it mentions "product", it is not shared.
- `features/` — may import `core/` and `shared/`, **never another feature**. Two
  features needing the same thing means it belongs in `shared/`.

### Signals over RxJS

Signals are the default for **state**; RxJS is kept for **event streams and async
composition**, which is what it is actually good at.

| Concern | Choice | Why |
|---|---|---|
| Auth state, current user, role | `signal` / `computed` | Synchronous reads in guards and templates; no subscription to leak |
| Loading counter | `signal` | `computed` derives `isLoading` for free |
| Theme | `signal` + `effect` | Resolved theme is a pure derivation of preference + OS setting |
| HTTP calls | `Observable` | What `HttpClient` returns; needs `retry`, `switchMap`, cancellation |
| Concurrent refresh collapse | `shareReplay` | An RxJS problem, solved with an RxJS operator |

`toSignal()` bridges the boundary where a library is observable-based (see
`MainLayoutComponent` and the CDK `BreakpointObserver`).

Change detection is **zoneless** (`provideZonelessChangeDetection`). Signals
notify Angular directly, so zone.js's monkey-patching of every async API — and
the over-broad checking that comes with it — is not needed. Every component is
`OnPush`, enforced by lint.

### Interceptor chain

Order is deliberate; a request travels down and the response comes back up.

```
1. apiUrl    prefix apiBaseUrl, enable credentials   (must be first)
2. loading   widest span, so the bar covers retries and refreshes
3. error     ABOVE auth — a 401 that auth recovers from never reaches it
4. auth      attach bearer; on 401 refresh once and replay
5. retry     innermost, so a retried request still gets a fresh token
```

Position 3 is the subtle one: putting `error` *below* `auth` would fire a
spurious "unauthorized" toast on every routine token expiry.

Two `HttpContext` opt-outs exist for the cases where global behaviour is wrong:
`skipLoading()` (typeahead, polling) and `skipErrorNotification()` (a login form
that shows failures inline).

### Material + Tailwind

Both, without conflict, via two decisions:

1. **Tailwind's preflight is not loaded.** Its reset unstyles buttons and inputs
   and rewrites heading margins, which visibly breaks Material form fields.
   `src/styles/tailwind.css` imports only the `theme` and `utilities` layers;
   the handful of resets actually wanted are declared explicitly in `styles.scss`.
2. **One palette, not two.** `mat.theme()` emits Material 3 tokens as CSS custom
   properties, and Tailwind's `@theme inline` block maps them onto its colour
   scale. So `bg-surface` and `text-on-surface-variant` are Material colours, and
   dark mode fixes the whole page rather than half of it.

Tailwind lives in a `.css` file rather than `styles.scss` because Sass cannot
parse `@import ... layer(...)`. Both files are listed in `angular.json`.

There is deliberately **no `MaterialModule`** re-exporting everything — that pulls
the entire library into every lazy chunk and defeats standalone components.
`shared/material/material-imports.ts` exposes curated arrays
(`MATERIAL_FORM_IMPORTS`, `MATERIAL_TABLE_IMPORTS`, …) instead.

### Lazy loading

Every feature is `loadChildren`; layouts are parent routes. A page the user never
visits costs them nothing, and the sidebar stays mounted across navigations. The
production build produces one chunk per feature — verify with `npm run build`.

---

## 3. Data model

Current scope is **identity and auditing only**: `User`, `RefreshToken`,
`AuditLog`, plus `Role` and `UserStatus`. Inventory aggregates are listed as a
commented plan at the end of `schema.prisma`.

Conventions in use:

- **UUID primary keys** (`@db.Uuid`) — safe to expose in URLs, and they do not
  leak row counts or creation order the way sequential integers do.
- **snake_case columns, camelCase fields** (`@map`) — idiomatic on both sides.
- **Soft delete** (`deletedAt`) on `User`; every read path filters
  `deletedAt: null`. Inventory history must survive the deletion of the product
  it refers to.
- **Append-only ledgers.** `AuditLog` is never updated. The planned
  `StockMovement` follows the same shape: quantities are derived by summing
  movements rather than mutating a counter, so history is always
  reconstructable and a bad adjustment is correctable without losing the trail.

Prisma 7 notes that differ from older tutorials:

- The connection URL lives in `prisma.config.ts`, not in `schema.prisma`.
- A **driver adapter is required** — `@prisma/adapter-pg`. `datasourceUrl` no
  longer exists. This is also what lets us set the pool size explicitly, which
  matters on Neon's small connection budget.
- The generator is `prisma-client` (not `prisma-client-js`) with an explicit
  `output`, so generated code is git-ignored and rebuilt on install.

---

## 4. Configuration

| | Backend | Frontend |
|---|---|---|
| Source | `.env`, validated by zod in `src/config/env.ts` | `src/environments/*.ts`, swapped by `fileReplacements` |
| Validated | Yes — process exits at boot on a bad value | Typed by `AppEnvironment`; a missing key is a compile error |
| Secrets | Yes | **Never** |

The backend parses its environment once at startup and exits with a readable list
of problems, so a misconfigured deployment fails immediately rather than at the
first request that needs a missing value. Nothing outside `config/env.ts` reads
`process.env`.

The frontend has no secrets by construction: an Angular build is a static bundle
the browser downloads, so anything compiled in is public.

---

## 5. Testing strategy

The architecture exists largely to make this cheap:

- **Domain / use cases** — pure unit tests. Inject fakes for the ports; no
  database, no HTTP. This is where business rules are covered.
- **Repositories** — integration tests against a real Postgres. Mocking Prisma
  here would test the mock.
- **HTTP layer** — drive the app returned by `createApp(container)` in-process
  with fakes in the container.
- **Frontend** — `TestBed` with `provideHttpClientTesting`; signals make
  assertions synchronous.

The auth use cases demonstrate the payoff: `tests/unit/login.use-case.spec.ts` and
`refresh-token.use-case.spec.ts` cover enumeration resistance, the timing-attack
defence, token rotation and reuse detection — 39 tests in ~600 ms with no database,
because the use cases were written against ports the domain owns. Reusable fakes
for every port live in `tests/unit/fakes.ts`.

---

## 6. Verified state

- **Static checks:** both apps `tsc --noEmit` clean and `eslint --max-warnings 0`
  clean; backend builds to `dist/`; frontend production and development builds
  succeed with lazy chunks emitted per feature and environment replacement
  confirmed in the bundle.
- **Database:** migration generated and applied to a real PostgreSQL instance;
  seed script creates one account per role; Prisma repositories exercised through
  the running API.
- **API runtime:** health probes, 404 envelope, malformed-JSON handling, helmet,
  CORS, rate-limit and correlation-id headers; the complete auth surface driven
  with `curl` against real bcrypt and real Postgres.
- **Browser:** headless Chrome against the live stack — bootstrap, guards, session
  restore across reloads, login and change-password forms, sign-out, and
  role-dependent rendering.
- **Feature suites:** 79 inventory and 93 stock-transfer API checks against real
  PostgreSQL, plus 63 transfer UI checks in a real browser — including two
  simultaneous approvals of one transfer, where exactly one succeeds and stock is
  deducted exactly once.
- **Unit tests:** 84 passing, no database required.

Each feature has its own verification record, including what was *not* exercised:
**[AUTHENTICATION.md](./AUTHENTICATION.md#11-verified-behaviour)**,
**[INVENTORY.md](./INVENTORY.md#7-verified-behaviour)**,
**[TRANSFERS.md](./TRANSFERS.md#8-what-has-been-verified)**.

Not yet exercised anywhere: production cross-site cookie behaviour
(`SameSite=None; Secure`), which needs two real HTTPS origins; and sustained
parallel load, which the local `prisma dev` proxy cannot support — see
[TRANSFERS.md](./TRANSFERS.md#9-what-has-not-been-verified).
