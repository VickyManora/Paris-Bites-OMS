# Design system

The visual foundation: tokens for every recurring decision, and the components built on them.

Live reference at **`/design-system`** — every token and component rendered by the real code. Read
this file for the rules the gallery cannot show: when to reach for which, and why some obvious
choices were rejected.

---

## What this phase changed

The app was beige. Not by anyone's decision — the Material theme was generated from
`$rose-palette`, and an M3 palette **tints every neutral with the source hue**. The page came out
`#fff8f8`, the hairlines `#f5dade`, and the whole thing read as a themed template rather than as a
product. That is the "generic ERP" complaint, and its cause was a colour algorithm nobody had
looked at.

So the identity is now declared rather than derived:

| | Before | After |
| --- | --- | --- |
| Page | `#fff8f8` rose-tinted | `#fafafb` neutral |
| Cards | `#fff0f0` rose-tinted | `#ffffff` pure white |
| Borders | `#f5dade` pink | `#dfdfe4` neutral |
| Primary | rose `#ba005c` | chocolate `#3b2416` |
| Hover | grey-on-grey `on-surface` at 4% | pink `#fff1f6` |
| Focus ring | rose | pink `#ff4d8d` |
| Error | rose-red, near the brand | semantic red `#ef4444` |

**No page template, component class list, API, query or schema was touched.** Every screen inherits
the new identity through the token layer and the Material bridge. That is the entire argument for
having had a token layer in the first place, and this phase is the first time it paid.

---

## The three layers

```
palette.css        --pb-pink-500: #ff4d8d       what colours exist          a brand fact
design-system.css  --color-pb-link: pink-700    what each colour means      a design fact
styles.scss        --mat-sys-primary: …         what Material renders with  a plumbing fact
```

A token in the middle layer answers *what is this for*, never *what colour is it*. That is what
lets dark mode be one block instead of a second stylesheet — only the middle layer holds opinions.

**`palette.css` is the only file in the app where a hex may be written.** Everything else refers to
a name.

| Path | What |
| --- | --- |
| `frontend/src/styles/palette.css` | Primitive ramps. Hex lives here and nowhere else |
| `frontend/src/styles/design-system.css` | Semantic tokens, dark mode, style utilities |
| `frontend/src/styles/tailwind.css` | Imports both; owns the POS palette and the Tailwind bridge |
| `frontend/src/styles.scss` | Material theme + **the role bridge**; `.pos-light-surface`; base elements |
| `frontend/src/app/shared/components/` | Components, exported from `index.ts` |
| `frontend/src/app/features/design-system/` | The gallery page |

Tokens are declared in `@theme static`. The `static` matters: Tailwind v4 otherwise tree-shakes
theme variables it cannot see referenced, so `var(--text-pb-display)` would resolve to nothing until
some page happened to use the matching utility class.

### The bridge is the load-bearing part

Sixty-one component files paint themselves with `bg-surface`, `text-on-surface-variant` and
`border-outline-variant` — 292 uses of `on-surface` alone. `styles.scss` redefines Material's colour
roles as aliases onto the semantic layer, so all of it re-themed at once and Material's own
components (buttons, fields, menus, snackbars) came with it.

Two mappings are worth knowing because they are not what Material means by them:

- **`surface` is white, not the page.** The app uses `bg-surface` for cards and chrome — topbar,
  sidebar, sign-in card. The page is painted by `body` from `--color-pb-page`. Getting this
  backwards turns every card grey and leaves the page white.
- **`outline-variant` is the ordinary border and `outline` the strong one**, matching how the app
  already used them.

Generating a Material palette from `#3b2416` was tried first and is the wrong tool: it tints the
neutrals brown, so the page comes out beige again — just a different beige.

---

## Colour

### Chocolate `#3b2416` — the primary

14.5:1 on white, which makes it the loudest thing the system can put on a page. Loud is right for a
submit button and wrong for everything else, so the brief's list is treated as **exhaustive**:

✓ primary buttons · navigation · selected items · important actions
✗ headings · card borders · icons · table headers · anything decorative

The rejected list is the load-bearing half. Brown headings on beige cards is exactly what the
redesign is escaping, and it returns the moment brown is available as a general-purpose dark colour.
Headings use `--color-pb-text`, a near-black, which is what lets the brown mean something when it
does appear.

**Hover goes lighter.** `#3b2416` is four points off black; darkening it is a state change nobody
can see.

**Dark mode inverts it.** Chocolate on the dark page measures 1.4:1 — a brown button there is a
button-shaped hole. The high-emphasis button becomes light-on-dark in the brand's own cream, which
is what Linear, Vercel and Stripe all do.

### Pink `#ff4d8d` — the interaction colour

Hover, focus ring, links, text selection, the unread dot. This is the brightest colour in the system
and it does most of the work against "dull": brown at 14.5:1 is far too heavy to mark something as
merely hoverable, and grey-on-grey hover is what dull means.

**Hover versus selected — the one place the brief contradicts itself.** It puts "Selected Items"
under brown and "Selection" under pink. Both are right, about different things:

- **Pink is transient** — the pointer is here, the keyboard is here. It disappears when you look
  away.
- **Brown is committed** — this is the row you ticked, the page you are on. It survives.

So a table row washes pink under the cursor and turns brown-tinted once selected. Getting this
backwards makes the app feel heavy, because the loudest colour on the page chases the mouse.

### Gold `#c89b5b` — premium, revenue, highlight

Money, featured markers, the brand mark. A fill and a rule.

### The rule that matters most: 500 is a fill, 700 is text

A brand colour is chosen for how it looks as a fill, and **a fill has no contrast requirement while
text has 4.5:1**. Measured against white:

| Token | Ratio | Legal as |
| --- | --- | --- |
| `pb-gold` `#c89b5b` | 2.5:1 | fill, rule, mark — *not even a UI component* |
| `pb-warning-base` `#f59e0b` | 2.1:1 | fill, dot, bar |
| `pb-success-base` `#22c55e` | 2.3:1 | fill, dot, bar |
| `pb-info-base` `#3b82f6` | 3.7:1 | fill, bar |
| `pb-danger-base` `#ef4444` | 3.8:1 | fill, bar |
| `pb-interactive` `#ff4d8d` | 3.1:1 | **focus ring, dot** — passes 3:1 non-text, fails text |
| `pb-link` `#c7175c` | 5.7:1 | text ✓ |
| `pb-gold-fg` `#96692e` | 4.8:1 | text ✓ |
| `pb-success-fg` `#15803d` | 5.0:1 | text ✓ |
| `pb-warning-fg` `#b45309` | 5.0:1 | text ✓ |
| `pb-danger-fg` `#b91c1c` | 6.5:1 | text ✓ |
| `pb-info-fg` `#1d4ed8` | 6.7:1 | text ✓ |

**A pink link at `#ff4d8d` is the accessibility bug this brief would otherwise have shipped** — it
fails for anyone with moderately reduced contrast sensitivity, which is most people over about
fifty. `--color-pb-link` is two steps deeper and visibly the same pink. The gallery renders both
side by side, which is the fastest way to see why.

Text emphases, also measured: `pb-text` 16.1:1 · `pb-text-secondary` 6.1:1 · `pb-text-muted` 3.8:1
(**placeholders only, never prose**) · `pb-text-disabled` 1.9:1.

### Status tones

Six tones — neutral, info, success, warning, danger, accent — each a **set** of surface, border,
foreground and base, applied through one class (`pb-tone-success`). Applying them separately is how
a badge ends up with a success background and a danger border.

The hues sit deliberately outside the brand. The previous system derived success from Material's
`tertiary` and danger from its `error`, which on a rose palette made both pink: "Paid", "Cancelled"
and "Awaiting payment" rendered as three shades of one colour. Green must mean safe and red must
mean stop even on a page whose brand is pink.

**Colour is never the only signal.** Roughly one man in twelve cannot separate the success and
danger hues, so every tone ships with an icon.

---

## Typography

Seven roles, not a font-size scale. A role carries size, line height, weight **and** tracking
together, because those four are one decision — 44px text at body weight and body line height is not
a heading, it is large text.

| Token | Size / line-height / weight | Use |
| --- | --- | --- |
| `text-pb-display` | 44 / 1.1 / 640 | One number on a page and nothing else |
| `text-pb-heading` | 28 / 1.2 / 620 | Page title |
| `text-pb-title` | 18 / 1.35 / 600 | Card and section title |
| `text-pb-subtitle` | 15 / 1.45 / 500 | Supporting line under a title |
| `text-pb-body` | 14 / 1.55 / 400 | The workhorse |
| `text-pb-caption` | 13 / 1.45 / 400 | Metadata, helper text, timestamps |
| `text-pb-overline` | 11 / 1.3 / 600 | Uppercase micro-label above a group |

Body is 14px, not 16px. Dense operational UI reads better at 14, and this app is almost entirely
tables, forms and dashboards.

Tracking **tightens** as size grows (−0.02em at display) and **widens** for overline (+0.08em).
Default letter-spacing at 44px reads loose and amateurish; uppercase at 11px set tight is unreadable.
That divergence is most of what separates a premium interface from a default one.

## Spacing — 8px

`pb-1` 4px · `pb-2` 8 · `pb-3` 16 · `pb-4` 24 · `pb-5` 32 · `pb-6` 40 · `pb-7` 48 · `pb-8` 64

Tailwind's 4px scale already contains every one of these. The aliases exist so intent survives
review: `gap-pb-4` says "one step of the system", `gap-6` says "24px, chosen by someone, for some
reason". 4px is the only sub-step, for icon-to-label gaps where 8px visibly detaches the two.

## Border radius

`pb-sm` 6px (badge, chip) · `pb-md` 8px (button, input) · `pb-lg` 12px (card, dialog) ·
`pb-xl` 16px (page surface, sheet) · `pb-full` (pill, avatar)

**Never nest a radius larger than its parent's** — that is what makes a corner look dented.

## Borders

`pb-border-subtle` (rules *inside* a surface) · `pb-border` (the edge *of* a surface) ·
`pb-border-strong` (hovered, focused, emphasised)

**Three weights, one width — everything is 1px.** A system that offers 2px borders gets 2px borders,
and a page of 2px boxes reads as a form from 2009. Emphasis comes from colour, never thickness.

Using `subtle` and `default` interchangeably is what makes a card look like a table and a table look
like a grid.

## Elevation

Deliberately **not** Material's. Material's shadows read as physical height; on a dense dashboard
they turn every card into a floating slab. These are built the way Linear and Stripe build them: a
hairline that reads as a *border* doing the work, plus a wider, very low-opacity layer for depth.

`shadow-pb-xs` resting card · `pb-sm` hover · `pb-md` menu/popover · `pb-lg` dialog/sheet ·
`pb-focus` focus ring · `pb-none` flat

The opacities are lower than the previous set because the surfaces beneath them changed: a shadow
tuned against a beige card reads as dirt against a pure white one.

**Depth is carried by the border, not the shadow.** The page and the cards on it are only 2% apart
in lightness, and that is enough — the eye reads the border first and the tone second.

The focus ring is a **two-layer shadow**: a white gap, then the pink. The gap is not decoration — a
ring drawn directly against a coloured button has almost no contrast with what it is ringing.

## Motion

`duration-pb-instant` 80ms · `pb-fast` 140 · `pb-base` 200 · `pb-slow` 240
`ease-pb-out` (entering) · `ease-pb-in-out` (between states) · `ease-pb-spring` (a committed action)

Nothing above 240ms — anything slower reads as the app thinking. Mostly easing *out*: an interface
feels quick when a change starts immediately and settles gently, not when it moves for less time.

Animations: `pb-fade-in` · `pb-page-in` · `pb-pop` · `pb-line-in` · `pb-slide-in-x` · `pb-tick` ·
`pb-skeleton`. Every one has a `prefers-reduced-motion` branch.

`pb-page-in` is **opacity-only, and that is not stylistic** — a transform on a routed page's wrapper
makes it the containing block for every `position: fixed` descendant, which put the inventory FAB
7818px down the document. The note in the CSS explains the mechanism; do not add a transform to it.

---

## Components

| Component | What |
| --- | --- |
| `pb-card` | Section card — title, subtitle, actions, footer slots |
| `pb-stat-card` | KPI tile with `positiveWhen` |
| `pb-empty-state` | |
| `pb-skeleton` | `text` (with `lines`), `heading`, `block`, `circle`, `button` |
| `pb-status-badge` | Takes a **tone**, never a colour |
| `pb-metric-badge` | `positiveWhen` is required and has no default |
| `pb-chart-card` | Reserves the chart's real height so the tile does not resize on load |

`pb-status-badge` callers pass what the state *means*. A call site passing `'green'` is making a
design decision, which is how five screens ended up with five different greens.

`pb-metric-badge`'s `positiveWhen` has no default because rising revenue is good and rising wastage
is not — a badge that always painted "up" green would be confidently wrong half the time, and the
half it was wrong about is the half someone needed to notice.

## Style utilities

`pb-surface` · `pb-surface-interactive` · `pb-divide` · `pb-btn` · `pb-btn-lg` · `pb-input` ·
`pb-input-invalid` · `pb-table` (+ `pb-num`) · `pb-badge` · `pb-badge-pill` · `pb-tone-*` ·
`pb-skeleton` · `pb-brand-mark` · `pb-avatar` · `pb-kbd` · `pb-icon-tile` · `pb-scroll-thin`

Utilities rather than components because that is the honest shape for a *style*. Material already
owns the behaviour of buttons and inputs — focus, ripple, ARIA, disabled semantics — and
re-implementing that to change a border radius would be a downgrade dressed as a design system. So
`pb-btn` goes **alongside** `matButton`, and `pb-input` is for plain controls outside a Material
field.

`pb-table` uses horizontal rules only: vertical ones turn a table into a grid and make scanning a row
harder, which is the one thing a table exists to do.

---

## Two things that will bite

**`.pos-light-surface` now has to re-declare its tokens by hand.** It used to be one line —
`color-scheme: light` — which worked because every token was a `light-dark()` pair. This phase
declares plain per-mode values instead, because a `light-dark()` custom property read back through
`getComputedStyle` returns the literal string `light-dark(#a, #b)` rather than a colour. That
already bit this codebase once: `chart.component.ts` carries a probe element specifically to work
around it, after a palette helper silently became a no-op and drew three donut slices in one colour.

The cost is a duplicated light block in `styles.scss`. **Adding a semantic colour token means adding
it there too** if it can appear inside a POS surface — the failure is quiet (light text on a white
card) and will not show up in a build.

**The POS surface is white now**, not cream (`--color-pos-vanilla`). It was the single largest area
of beige in the app, rendered full-screen on the till. The brown and gold are unchanged.

## Adopting it

The identity is live everywhere; what has *not* happened is any page being redesigned. A sensible
order when that starts:

1. **`pb-status-badge` first.** Five call sites already duplicate it, so this deletes code rather
   than adding it.
2. **Skeletons on the dashboard and list pages**, replacing full-page spinners.
3. **`pb-chart-card`** on the dashboard and analytics.
4. **Typography and spacing**, one page at a time.

One known weak spot: **`pb-stat-card`'s "bad" colour**. Its trend logic is correct, but the
unfavourable branch uses `text-error`, and pointing it at the danger tone is a one-line change and a
visible improvement.

## Verification

Built and driven in a real browser (Chromium, 1440×900), signed in against the live API:

| Checked | Result |
| --- | --- |
| Dashboard, inventory, POS, gallery — light | Neutral page, white cards, hairline borders, no beige |
| Same, dark | Page `rgb(12,12,15)`, cards `rgb(19,19,24)`, primary inverted to `rgb(234,217,203)` |
| Table row hover | Pink wash; brown tint for selected — visibly different states |
| POS in dark mode | Cards stay white, text stays dark — `.pos-light-surface` survives the rewrite |
| Console | No errors beyond an expected 401 on the pre-login refresh probe |

Also passing: `lint`, `typecheck`, **51 frontend tests**, production build.

**Bundle:** the colour token layer costs **8.26 kB raw / 1.19 kB transferred**, measured by building
with it stripped (644.83 kB) and intact (653.09 kB). Note that the first of those figures is already
over the old 640 kB warning budget — the app had grown past it before this work — so the budget was
raised to 680 kB rather than tuned to hide the difference.
