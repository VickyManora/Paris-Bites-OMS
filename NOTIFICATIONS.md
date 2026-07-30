# Notifications

An in-app inbox: a topbar bell with an unread badge, and a notification centre holding the
full history. Seven event types, from three different kinds of source.

---

## The seven types

| Type | Raised when | Goes to | Severity |
|---|---|---|---|
| `TRANSFER_REQUESTED` | a Store Manager raises a stock request | every admin | info |
| `TRANSFER_APPROVED` | an admin approves and dispatches | the requester | success |
| `TRANSFER_REJECTED` | an admin refuses, with a reason | the requester | warning |
| `TRANSFER_COMPLETED` | arrival is confirmed | the requester | success |
| `PURCHASE_COMPLETED` | a supplier invoice is recorded | every admin | success |
| `LOW_STOCK` | an item is at or below its reorder level | see routing below | warning |
| `EXPIRY_ALERT` | held stock expires within 7 days, or already has | every admin | warning |

Types are named after the **event, not the audience**. One event fans out to several
people — a transfer request notifies every admin — and naming by audience would force a
second type for the same thing.

Severity and icon are **derived from the type on the server** and sent with each row, so
the bell, the centre and any future surface cannot drift apart or disagree about a type
one of them has not heard of.

---

## Three sources, three shapes

**Workflow events** (transfers, purchases) are emitted by somebody doing something, so
there is an obvious moment to send them. `TransferNotifier` and `PurchaseNotifier` are
called from the use case after the work has committed.

**Conditions** (low stock, expiry) are not. Nothing *happens* when a consumption entry
takes an item below its reorder level, and nothing at all happens when an expiry date
arrives — the date simply passes. `StockAlertScanner` sweeps for both on a timer.

### Why a sweep rather than a hook on every stock change

Stock moves in four places — purchases, transfers, consumption, manual adjustment — and
each would need the same before/after comparison bolted on, with the fifth caller added
later being the one that forgets. Expiry would still need a timer regardless. One sweep
covers both conditions and every writer, including ones that do not exist yet.

The cost is latency: an item that goes low is alerted within one sweep interval rather
than instantly. For restocking decisions measured in days, that is not a real cost.

### Routing: whoever can take the first action

| Condition | Goes to | Because |
|---|---|---|
| Low at Home Warehouse | admins | restocking means buying, and purchases are theirs |
| Low at Cart | store managers | they raise the transfer request that refills it |
| Expiring | admins | writing stock off is admin-only |

Broadcasting all three to everyone would be less code and worse. An alert that its reader
cannot act on is noise, and noise is what stops the actionable ones landing.

### Repetition, and why the cooldown exists

A low item is still low on the next sweep. The naive version therefore re-sends the same
alert every fifteen minutes, forever, until somebody restocks — roughly ninety-six copies
a day per item, which trains people to ignore the bell entirely.

`findAlertedEntityIds(type, since)` is the memory: an item alerted within
`ALERT_COOLDOWN_HOURS` (default 24) is skipped. The window is deliberately **per item, not
per recipient** — the question is "has this alert gone out", not "has this person seen it",
and per-recipient state would re-send the whole backlog to whoever joined most recently.

### The per-sweep cap

At most ten alerts of each kind per sweep. Not a limit on what gets alerted — anything
held back is picked up by the next sweep, because nothing was written for it and the
de-duplication query will not find it. It exists so that switching this on against an
inventory with thirty items already below their reorder level does not put thirty rows in
the bell at once. Deferred alerts are **logged**, never dropped silently.

Within a sweep, the worst go first: out of stock outranks merely low, then by shortfall;
expiring stock is ordered by how soon.

### Configuration

```
ALERT_SCAN_INTERVAL_MINUTES=15   # 0 disables the sweep
EXPIRY_ALERT_DAYS=7
ALERT_COOLDOWN_HOURS=24
```

**Exactly one process should have a non-zero interval.** The sweep is a singleton by
assumption: two instances running it together can both see an item as un-alerted and both
send, and `AlertScheduler` cannot see across processes. Set the interval to 0 on every
replica but one.

---

## Nothing may throw

Every notifier swallows its own failures and logs them, and so does the repository's
`createMany`. This is the same rule the audit log follows, for a sharper reason: by the
time a notifier runs, a stock movement has already committed. Throwing then would report a
failure for work that succeeded — and after a purchase, the obvious next action is to
record the invoice again, which is the one mistake in that module that double-counts stock.

The sweep additionally has no request to fail. An exception escaping it would either be
swallowed by the runtime or take the process down through the unhandled-rejection handler
in `main.ts`, so it is caught, logged, and retried on the next tick.

---

## Delivery model

Rows are **fanned out at write time** — one per recipient, rather than one row plus a
per-user read table. Read state is what gets queried on every page load ("how many
unread?"), and a fan-out row makes that a single indexed count instead of an anti-join.

`title` and `body` are **stored**, not rendered from the type at read time. A notification
is a record of what someone was told; regenerating the text later would silently rewrite
history when the wording or the underlying data changed.

Self-notification is filtered out everywhere. An admin who records their own invoice, or
requests their own transfer, already knows — and a bell that lights up for your own click
teaches people to ignore the bell.

---

## Ownership, not permission

The notification routes are the **only** ones in the API with no `requirePermission`, and
that is deliberate.

Every other resource is shared, so "may this role do this?" is the right question. An inbox
is not shared: the right question is "is this yours?", and no permission can express it. An
admin holds every permission by construction, so gating on one would grant admins access to
a Store Manager's mail — the opposite of what a capability check is for.

Ownership is enforced in the layer that cannot be bypassed. The recipient comes from the
verified token in the controller, and **every repository method takes it as part of its
`where` clause** — including the writes. There is deliberately no `findById(id)` that can
return any user's row. A forgotten check therefore returns nothing rather than someone
else's mail.

`markRead` returning false for "does not exist" and "not yours" alike is the same idea:
probing for another user's notification ids reveals nothing.

---

## Read state

`readAt` is a nullable timestamp, not a boolean — "when did they see this" is answerable
for free, and a boolean can never be widened to it.

Marking read is **idempotent**: the update is scoped to `readAt: null`, so a double-click
or a second tab matches nothing and leaves the original timestamp intact.

Every mutation endpoint **returns the fresh unread count**, and no client ever computes it.
A badge that drifts below zero, or sticks at one forever, is the classic bug in this
feature; taking the server's number after every change is what prevents it.

---

## The two surfaces

**The bell** holds the newest ten and a polled count. It lives in the shell and outlives
every route, so its store is root-provided and owns its own polling lifecycle — started on
sign-in and stopped on sign-out, which is what keeps one user's count from surviving into
the next user's session on a shared terminal. The badge polls once a minute; the panel
refetches on open, which is the moment somebody is actually looking.

**The notification centre** (`/notifications`) holds everything, paginated, with an
all/unread filter. The bell structurally cannot show history — fixed ten, no paging — so
without this page anything older is reachable only by API.

They share the unread count. The centre pushes the server's fresh count into the bell's
store after every mutation, because a badge insisting there are unread items the user just
cleared, for up to a minute, is the obvious bug in a two-surface inbox.

Clicking an entry marks it read **and then** navigates to what it is about — marking first
and unconditionally, so a notification whose target has since been deleted is still
dismissible rather than pinning the badge forever. The `entityType` → route map is shared
by both surfaces; an unknown type stays readable and simply does not navigate.

Opening the bell deliberately does **not** mark everything read: bulk-clearing on open
makes the badge useless, since a glance at a busy inbox would silently discard everything
the user had not got to.

---

## REST API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/notifications` | The inbox, paginated. `unreadOnly=true` to filter |
| `GET` | `/api/v1/notifications/feed?limit=` | Newest few plus the count, in one request |
| `GET` | `/api/v1/notifications/unread-count` | Just the badge — the cheapest call in the app |
| `POST` | `/api/v1/notifications/:id/read` | Idempotent. Returns the fresh count |
| `POST` | `/api/v1/notifications/read-all` | Returns the fresh count |

No route accepts a `recipientId`. Accepting one would be an inbox-wide read for any
signed-in user.

---

## Verified

Unit tests (26 across the three notifiers) plus an end-to-end run against the real database
and a real browser (17 checks, admin and Store Manager):

- routing per condition and per location, and that alerts carry no actor;
- de-duplication — a controlled crossing raised exactly one alert, and an immediate repeat
  sweep raised none;
- the two alert kinds de-duplicate independently;
- the per-sweep cap defers rather than drops, worst first;
- expiry wording distinguishes "expires soon" from "has expired", and the window is
  inclusive of the last day;
- a recorded invoice notifies the admins and not the recorder;
- every notifier returns normally when the database is unavailable;
- the centre pages past the bell's ten, filters unread, marks one read (count drops by
  exactly one), marks all read (badge hidden, unread filter empty, history intact);
- clicking a low-stock alert deep-links to the item;
- a Store Manager reaches their own inbox with no permission and sees none of the admin's
  alerts;
- no horizontal scroll at 390 px.
