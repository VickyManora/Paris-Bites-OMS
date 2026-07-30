# Authentication & Authorization

How sign-in, sessions and access control work, and why each choice was made.

---

## 1. Roles and permissions

Two roles, defined in `backend/src/core/domain/enums/role.enum.ts`:

| Role | Intent |
|---|---|
| `ADMIN` | Full access to everything |
| `STORE_MANAGER` | Day-to-day store operations |

**Authorization is expressed in permissions, not roles.** Routes declare the
capability they need; `backend/src/core/domain/enums/permission.enum.ts` decides
who holds it. The reason is concrete: the day a third role appears, every
`if (role === ADMIN)` scattered through the codebase becomes a bug, while a
permission check keeps expressing the actual intent.

`ADMIN` is granted `ALL_PERMISSIONS` **by construction**, not by an enumerated
list. So a newly added permission is automatically available to admins and must
be *explicitly* granted to anyone else — forgetting to list a permission
restricts rather than escalates, which is the safe direction to fail in.

### What Store Manager can and cannot do

Granted (11): read/create/update products · read and adjust stock · read and
manage suppliers · read and create purchase orders · view reports · read settings.

Withheld (11): all user administration and role management · audit log · update
settings · delete products · **write off stock** · **approve purchase orders** ·
**financial reporting**.

The four emphasised ones are the boundary that matters. They are the places where
an unchecked mistake or a bad actor does real damage: approving a purchase order
commits money to a supplier, and writing off stock can make physical and recorded
inventory agree without an explanation. Separating them from the person doing
daily operations is ordinary segregation of duties.

`backend/tests/unit/permission.enum.spec.ts` asserts this model, so a future
permission cannot be granted to Store Manager by accident.

---

## 2. Token design

Two token types, chosen for opposite reasons.

| | Access token | Refresh token |
|---|---|---|
| Format | Signed JWT (HS256) | Opaque random string (512 bits) |
| Lifetime | 15 minutes | 7 days |
| Stored where | Client memory only | httpOnly cookie |
| Server state | None | Row in `refresh_tokens`, **hashed** |
| Revocable | No | Yes |
| Sent as | `Authorization: Bearer …` | Cookie, scoped to `/api/v1/auth` |

**Why the access token is stateless.** Authorising a request costs one signature
check and no database round trip. The trade-off is real and accepted: a role
change or suspension only takes effect when the token expires. That is precisely
why its lifetime is minutes, and why every refresh re-reads the user from the
database.

**Why the refresh token is not a JWT.** It has to be revocable, and revoking a
stateless token is a contradiction. Only its SHA-256 digest is persisted, so
someone who reads the database cannot replay the token against the API.

**Why the access token lives in memory.** A token in `localStorage` is readable
by any script on the origin, so one XSS bug becomes full account takeover. The
token in `TokenStorageService` dies with the JS context. The cost — a page reload
starts with no access token — is paid by the silent refresh below.

**Why the refresh token is an httpOnly cookie.** JavaScript cannot read it, so
the same XSS payload cannot steal the long-lived credential either. This
asymmetry is the entire point of the split.

---

## 3. Rotation and reuse detection

Every refresh issues a new refresh token and revokes the presented one, recording
`replacedById` to link the chain. Each token is therefore single-use: a stolen one
is only useful until the legitimate client next refreshes.

That turns theft into something detectable. If an already-revoked token is
presented, one of two things happened — an attacker is replaying a stolen token,
or a buggy client is replaying its own. **Neither is distinguishable from the
server, and the safe reading is theft**, so every live token for that user is
revoked and the event is written to the audit log.

This is deliberately heavy-handed. It ends the attacker's access immediately; the
cost to a legitimate user is one extra sign-in.

The client side matters just as much. `AuthService.refreshAccessToken` collapses
concurrent callers onto a single request via a `refreshInFlight` latch plus
`shareReplay`. Without it, five requests failing with 401 at once would each
trigger a rotation, and every rotation after the first would look like reuse — so
the app would log itself out under normal load.

---

## 4. CSRF

In production the app (Vercel) and API (Railway) are on different registrable
domains, so the refresh cookie must be `SameSite=None; Secure` or the browser
will not send it at all. That is exactly the condition CSRF exploits: any page
could `POST /auth/refresh` and the browser would attach the cookie.

The defence is `requireFetchIntent`, which requires an `X-Requested-With:
paris-bites-web` header on the two cookie-authenticated routes. A cross-origin
request carrying a non-safelisted header triggers a **CORS preflight**, and the
browser refuses to send the real request unless the API approves the origin —
which it only does for `CORS_ORIGINS`. A `<form>` or `<img>` on a hostile page
cannot set headers at all, so it never gets that far.

Chosen over a double-submit token because it needs no shared secret, no extra
round trip and no server state: the browser's own preflight does the work. The
Angular client sets the header in `apiUrlInterceptor`.

---

## 5. Login defences

`LoginUseCase` is written against two specific attacks.

**Account enumeration.** Unknown email, wrong password, suspended account and
soft-deleted account all produce the identical `UNAUTHORIZED` code and message.
Any difference — wording, code, or status — would let an attacker confirm which
staff emails exist before guessing a single password.

**Timing analysis.** When no user is found, the use case still runs a bcrypt
comparison against a dummy digest. Returning early would make "unknown email"
roughly 250 ms faster than "wrong password", which is trivially measurable over a
network. The dummy digest is derived at runtime from a random value rather than
hardcoded — a literal that was not well-formed for the configured cost factor
would make `compare` return instantly and silently remove the defence.

Status is checked **after** the password is verified, for the same reason: doing it
first would reveal that an address belongs to a suspended account.

**Rate limiting.** `/auth/login` is limited to 10 attempts per minute per IP, and
counts only failures, so a legitimate user is never locked out by signing in
successfully. Note the limiter is in-memory: it counts per process, so scaling to
more than one Railway instance multiplies the effective limit. Move to a Redis
store before scaling horizontally.

---

## 6. Session persistence

A page reload loses the in-memory access token but keeps the httpOnly cookie.
`provideAppInitializer` in `app.config.ts` calls `AuthService.restoreSession()`,
which exchanges the cookie for a new access token and then loads `/auth/me`,
**before the first route resolves**. Without that ordering, guards would evaluate
against empty state and bounce an authenticated user to the login page on every
refresh.

A failed restore is a normal outcome — an anonymous visitor has no cookie — so the
request opts out of error notification via `skipErrorNotification()`. This was a
real bug caught by testing in a browser: the first version greeted every
first-time visitor with an error snackbar.

---

## 7. Request lifecycle

### Interceptor chain (`frontend/src/app/core/http/interceptors/index.ts`)

```
1. apiUrl    prefix apiBaseUrl, withCredentials, X-Requested-With
2. loading   widest span, so the bar covers retries and refreshes
3. error     ABOVE auth — a 401 that auth recovers from never reaches it
4. auth      attach bearer; on 401 refresh once and replay the request
5. retry     innermost, so a retried request still gets a fresh token
```

Position 3 is the subtle one. Putting `error` below `auth` would fire a spurious
"unauthorized" toast on every routine token expiry, even though the app recovered
transparently.

`authInterceptor` exempts `/auth/login`, `/auth/refresh` and `/auth/logout`, so a
failing refresh cannot trigger another refresh.

### Backend per-route order

```
rate limit → CSRF check → authenticate → authorize → validate → handler
```

Cheap rejections first, so an unauthenticated flood never reaches bcrypt or the
database.

---

## 8. Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/auth/login` | Public | Rate limited (10/min, failures only) |
| `POST` | `/auth/refresh` | Refresh cookie | Rotates the token; requires `X-Requested-With` |
| `POST` | `/auth/logout` | Refresh cookie | No bearer token required — see below |
| `GET` | `/auth/me` | Bearer | Reads the DB, not the JWT claims |
| `POST` | `/auth/change-password` | Bearer | Revokes **all** sessions |

`/auth/logout` deliberately does not require a valid access token. A user whose
token already expired must still be able to sign out and have their refresh token
revoked; demanding a live token would make that impossible. It is also idempotent
and never fails — someone who clicked "sign out" must end up signed out, and
telling them it failed would leave them believing otherwise.

`/auth/me` reads from the database rather than trusting the JWT. The token proves
*who* the caller is; it is a snapshot up to 15 minutes old, so it must not be the
source of truth for what they may currently do.

`change-password` requires the current password even though the caller is
authenticated — otherwise a stolen access token or an unattended browser is enough
to lock the real owner out permanently. On success every session is revoked,
because a password change is the standard response to "I think someone has access
to my account".

---

## 9. Frontend guards and directives

| | Purpose |
|---|---|
| `authGuard` | Requires a session; preserves the attempted URL as `returnUrl` |
| `guestGuard` | Keeps a signed-in user off the login page |
| `permissionGuard` + `withAccess({...})` | Capability check from route `data` — **prefer this** |
| `roleGuard` + `withRoles({...})` | Role check, for pages that are about *who* rather than *what* |
| `*pbHasPermission` | Show/hide UI by capability |
| `*pbHasRole` | Show/hide UI by role |

```ts
{
  path: 'users',
  canActivate: [authGuard, permissionGuard],
  data: withAccess({ permissions: [Permission.USER_READ] }),
  loadComponent: () => import('./user-list.page').then((m) => m.UserListPage),
}
```

**None of this is security.** The bundle ships to the browser, so guards and
directives only decide what the UI offers. Every protected operation is authorised
again server-side with `requirePermission(...)`. The client also does not derive
permissions from the role — it uses the list the server sent, so there is exactly
one definition of the access model.

`returnUrl` is validated as a same-origin relative path before navigation.
Accepting it blindly would make the login page an open redirect:
`?returnUrl=https://evil.example` would send a freshly-authenticated user off site.

---

## 10. Audit trail

`audit_logs` is append-only — the repository exposes only `record`, because a trail
that can be rewritten is not evidence of anything. Auth events written:
`login.succeeded`, `login.failed`, `logout`, `token.refreshed`,
`token.reuse-detected`, `password.changed`.

Failed logins record the attempted email, because that is what an investigation
starts from. **No password, token or digest is ever recorded** — and `pino` is
separately configured to redact those paths, so a careless
`logger.info('login', req.body)` cannot leak one either.

Audit writes never break the operation they describe: `AuditLogPrismaRepository`
catches and logs its own failures, so a failed insert cannot turn a successful
login into a 500.

---

## 11. Verified behaviour

Exercised against a real PostgreSQL database and a real browser, not mocks.

**API (`curl`, real bcrypt + Postgres):** identical responses for unknown email
and wrong password · validation errors with field paths · successful login for
both roles with correct permission sets (22 vs 11) · refresh rejected without the
CSRF header (403) · rotation produces a different token · reused token rejected
**and the successor killed too** · `/auth/me` with and without a bearer token ·
all four change-password failure modes plus success · old password stops working
and sessions are revoked · logout idempotent and cookie cleared · rate limiter
engaging on the 11th attempt · audit rows written with no secrets.

**Browser (headless Chrome against the live stack):** anonymous visitor redirected
with `returnUrl` preserved · client-side validation · inline credential error
without a redirect · login as each role showing the correct permissions ·
**session surviving a full page reload** · no token in `localStorage` or
`sessionStorage` and `document.cookie` empty (httpOnly confirmed) · `guestGuard`
redirect · forbidden and not-found pages · live password-policy checklist ·
mismatch validator showing and clearing · sign-out followed by a reload not
restoring the session.

**Unit tests:** 39 passing with no database, using fakes for every port.

### Not verified

- Production cookie behaviour (`SameSite=None; Secure`) — needs two real HTTPS
  origins; only the local same-site path has been exercised.
- Password reset by email — not implemented, needs transactional email.
- Behaviour under more than one API instance, where the in-memory rate limiter
  counts per process.
