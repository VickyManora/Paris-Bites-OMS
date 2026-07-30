# Naming & folder conventions

Conventions exist so a file's name tells you its layer and role before you open
it. Where a rule can be machine-enforced, it is — see the two `eslint.config.js`
files.

---

## 1. Files and folders (both apps)

| Kind | Convention | Example |
|---|---|---|
| Folders | `kebab-case`, **singular** for a concept, **plural** for a collection | `use-cases/`, `auth/`, `repositories/` |
| Files | `kebab-case` with a **role suffix** | `user.repository.ts` |
| Barrel | `index.ts` per folder, re-exporting the public surface | `core/auth/index.ts` |
| Docs | `SCREAMING-KEBAB.md` at repo root | `ARCHITECTURE.md` |

The role suffix is the load-bearing part. `user.entity.ts`,
`user.repository.ts`, `user.prisma-repository.ts` and `user.mapper.ts` are four
different things about the same noun, and the suffix says which without opening
any of them.

Never use `utils.ts`, `helpers.ts`, `misc.ts` or `common.ts` as a file name. They
attract unrelated code. Name the concern: `form.utils.ts`, `pagination.ts`.

---

## 2. Backend suffixes

| Suffix | Layer | Contains |
|---|---|---|
| `.entity.ts` | domain | Entity class with behaviour |
| `.enum.ts` | domain | `as const` object + derived union type |
| `.repository.ts` | domain | Repository **interface** (a port) |
| `.value-object.ts` | domain | Immutable, self-validating value |
| `.use-case.ts` | application | One business operation, one `execute` |
| `.dto.ts` | application | Outbound shape crossing the boundary |
| `.mapper.ts` | application | Entity → DTO |
| `.port.ts` | application | Service interface |
| `.prisma-repository.ts` | infrastructure | Prisma implementation of a port |
| `.prisma-mapper.ts` | infrastructure | Prisma row → entity |
| `.service.ts` | infrastructure | Adapter (`bcrypt-hash.service.ts`) |
| `.controller.ts` | presentation | HTTP adapter, thin |
| `.routes.ts` | presentation | Router for one feature |
| `.middleware.ts` | presentation | Express middleware factory |
| `.validators.ts` | presentation | zod schemas |
| `.serializer.ts` | presentation | Response envelope construction |

Note `user.repository.ts` (interface, in `domain/`) versus
`user.prisma-repository.ts` (implementation, in `infrastructure/`). The technology
appears in the filename of the adapter and never in the port — which is the naming
expression of the dependency rule.

### Backend identifiers

| Thing | Convention | Example |
|---|---|---|
| Interfaces | `PascalCase` with `I` prefix **for ports only** | `IUserRepository`, `ITokenService` |
| Data shapes | `PascalCase`, no prefix | `UserProps`, `CreateUserData` |
| Classes | `PascalCase`, name states the technology | `UserPrismaRepository` |
| Use cases | `<Verb><Noun>UseCase` | `CreateProductUseCase` |
| Errors | `<Reason>Error`, extending `DomainError` | `InsufficientStockError` |
| Constants | `SCREAMING_SNAKE_CASE` | `API_BASE_PATH` |
| Const-object enums | `PascalCase` object + same-named type | `Role`, `UserStatus` |
| Functions | `camelCase`, verb-first | `toPageRequest`, `createPage` |
| Booleans | `is` / `has` / `can` prefix | `isOperational`, `canSignIn` |

The `I` prefix is reserved for ports deliberately: it marks "this is a seam with
an implementation elsewhere", which is a meaningful signal. Applying it to every
interface would make it noise.

### ESM imports

Native ESM, so **relative imports need explicit `.js` extensions** even though the
source is `.ts`:

```ts
import { User } from '../entities/user.entity.js';   // correct
import { User } from '../entities/user.entity';      // fails at runtime
```

There are no path aliases. `tsc` does not rewrite import specifiers, so an alias
would resolve in dev (tsx) and crash in production (`node dist/main.js`) without a
post-build rewriter. Relative paths resolve identically in both, with no extra
build step to keep in sync.

---

## 3. Frontend suffixes

| Suffix | Contains |
|---|---|
| `.component.ts` | Reusable component in `shared/` or `layouts/` |
| `.page.ts` | Routed, feature-owned component |
| `.service.ts` | Injectable service |
| `.guard.ts` | Functional route guard |
| `.interceptor.ts` | Functional HTTP interceptor |
| `.directive.ts` | Directive |
| `.pipe.ts` | Pipe |
| `.model.ts` | Interfaces and types |
| `.routes.ts` | Feature route table |
| `.spec.ts` | Test, beside its subject |

`.page.ts` versus `.component.ts` is worth keeping: a page is routed, owns data
fetching, and is never imported by another component. A component is imported and
takes its data via inputs.

### Frontend identifiers

| Thing | Convention | Example |
|---|---|---|
| Component class | `PascalCase` + `Component` | `DataTableComponent` |
| Page class | `PascalCase` + `Page` | `DashboardPlaceholderPage` |
| Component selector | `pb-` + `kebab-case` | `pb-data-table` |
| Directive selector | `pb` + `camelCase`, in brackets | `[pbHasRole]` |
| Pipe name | `pb` + `camelCase` | `pbInitials` |
| Guards / interceptors | `camelCase` function | `authGuard`, `errorInterceptor` |
| Signals | noun, no `$` suffix | `user`, `isLoading` |
| Observables | `$` suffix | `products$` |
| Injection tokens | `SCREAMING_SNAKE_CASE` | `SKIP_LOADING` |

The `pb-` prefix on every selector is enforced by
`@angular-eslint/component-selector`. It guarantees our elements are never
confused with a third-party library's, and it is why the root component is
`pb-root` rather than the CLI's default `app-root`.

Signals get no `$`: they are values, read by calling them. Reserving `$` for
observables keeps the distinction visible at the call site — `user()` versus
`user$.subscribe()`.

### Member ordering and visibility

Within a component, in this order: injected dependencies, inputs, outputs, state
signals, computed signals, lifecycle hooks, public methods, private methods.

Use `protected` for members only the template reads, `private` for internals, and
`public` (implicit) only for a genuine external API. `protected` is what keeps
`strictTemplates` checking while signalling that nothing outside should touch it.

---

## 4. Feature folder shape

Every frontend feature looks the same, so navigating an unfamiliar one is free:

```
features/products/
├── pages/                    routed components
│   ├── product-list/
│   │   ├── product-list.page.ts
│   │   └── product-list.page.spec.ts
│   └── product-detail/
├── components/               used only within this feature
│   └── product-form/
├── services/
│   └── product.service.ts    typed API access via ApiService
├── models/
│   └── product.model.ts
├── products.routes.ts        lazy-loaded route table
└── index.ts
```

Backend features mirror it across layers rather than in one folder — a product
touches `domain/entities/`, `application/use-cases/products/`,
`infrastructure/database/repositories/`, and `presentation/http/routes/`.

A component under `features/x/components/` that a second feature needs is the
signal to move it to `shared/components/` — not to import across features, which
lint forbids.

---

## 5. Database naming

| Thing | Convention | Example |
|---|---|---|
| Model | `PascalCase` singular | `model StockMovement` |
| Table | `snake_case` plural, via `@@map` | `@@map("stock_movements")` |
| Field | `camelCase` | `reorderThreshold` |
| Column | `snake_case`, via `@map` | `@map("reorder_threshold")` |
| Enum | `SCREAMING_SNAKE_CASE` values | `ADMIN`, `IN_PROGRESS` |
| Foreign key | `<model>Id` | `supplierId` |
| Timestamps | `createdAt`, `updatedAt`, `deletedAt` | — |
| Booleans | `is` / `has` prefix | `isActive` |

Every model carries `createdAt` and `updatedAt`. Anything a user can remove but
history refers to gets `deletedAt` and is soft-deleted.

---

## 6. Git

Conventional Commits, scoped by app or feature:

```
feat(products): add low-stock threshold to product form
fix(auth): collapse concurrent refresh calls into one request
refactor(core): extract pagination helpers from user repository
chore(deps): upgrade Prisma to 7.9
docs(architecture): explain interceptor ordering
```

Branches: `feat/`, `fix/`, `chore/`, `docs/` + kebab-case description.

Commit messages should say **why** when it is not obvious from the diff. The diff
already shows what changed.
