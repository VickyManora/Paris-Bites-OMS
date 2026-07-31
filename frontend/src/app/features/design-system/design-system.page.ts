import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ChartCardComponent } from '../../shared/components/chart-card/chart-card.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { MetricBadgeComponent } from '../../shared/components/metric-badge/metric-badge.component';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { SpinnerComponent } from '../../shared/components/spinner/spinner.component';
import { StatCardComponent } from '../../shared/components/stat-card/stat-card.component';
import { StatusBadgeComponent } from '../../shared/components/status-badge/status-badge.component';
import type { ChartSpec } from '../../shared/components/chart/chart.component';
import {
  MATERIAL_CORE_IMPORTS,
  MATERIAL_FORM_IMPORTS,
} from '../../shared/material/material-imports';

/**
 * Living reference for the design system.
 *
 * Every token and component on one page, rendered by the real code rather than pictured. That
 * matters for two reasons: a reference built from screenshots is out of date the first time a
 * token changes, and this page is where a wrong value becomes obvious — a shadow that is too heavy
 * or two radii that should differ and do not are visible here and invisible spread across twenty
 * screens.
 *
 * It also earns its keep mechanically. Tailwind only emits utilities it can see used, so a token
 * nothing references yet would silently produce no CSS; using each one here means the whole system
 * is compiled and inspectable from the day it lands, before any page adopts it.
 *
 * Not linked from the sidebar — this is for whoever is building the UI, reachable at
 * `/design-system`.
 */
@Component({
  selector: 'pb-design-system-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ChartCardComponent,
    EmptyStateComponent,
    MetricBadgeComponent,
    SkeletonComponent,
    SpinnerComponent,
    StatCardComponent,
    StatusBadgeComponent,
    ...MATERIAL_CORE_IMPORTS,
    ...MATERIAL_FORM_IMPORTS,
  ],
  host: { class: 'block' },
  template: `
    <div class="flex flex-col gap-pb-6 pb-pb-8">
      <header>
        <p class="m-0 text-pb-overline uppercase text-on-surface-variant">Foundation</p>
        <h1 class="m-0 mt-pb-1 text-pb-heading text-on-surface">Design system</h1>
        <p class="m-0 mt-pb-2 max-w-prose text-pb-body text-on-surface-variant">
          Tokens and components, rendered by the real code. Every name is prefixed
          <code class="rounded-pb-sm bg-surface-container px-1">pb-</code>, and Material's own
          colour roles are aliased onto these — so a screen written against
          <code class="rounded-pb-sm bg-surface-container px-1">bg-surface</code> is already using
          this system without knowing it.
        </p>
      </header>

      <!-- ================= TYPOGRAPHY ================= -->
      <section class="pb-surface p-pb-4">
        <h2 class="m-0 text-pb-title text-on-surface">Typography</h2>
        <p class="m-0 mt-pb-1 text-pb-caption text-on-surface-variant">
          Seven roles. Each carries size, line height, weight and tracking as one decision.
        </p>

        <div class="mt-pb-4 flex flex-col divide-y divide-outline-variant">
          @for (role of typography; track role.token) {
            <div class="flex flex-wrap items-baseline gap-pb-3 py-pb-3">
              <code class="w-44 shrink-0 text-pb-caption text-on-surface-variant">
                {{ role.token }}
              </code>
              <span [class]="role.cls">{{ role.sample }}</span>
              <span class="ml-auto text-pb-caption text-on-surface-variant">{{ role.meta }}</span>
            </div>
          }
        </div>
      </section>

      <!-- ================= SPACING ================= -->
      <section class="pb-surface p-pb-4">
        <h2 class="m-0 text-pb-title text-on-surface">Spacing</h2>
        <p class="m-0 mt-pb-1 text-pb-caption text-on-surface-variant">
          An 8px system with one 4px sub-step. Nothing smaller exists on purpose.
        </p>

        <div class="mt-pb-4 flex flex-col gap-pb-2">
          @for (step of spacing; track step.token) {
            <div class="flex items-center gap-pb-3">
              <code class="w-32 shrink-0 text-pb-caption text-on-surface-variant">
                {{ step.token }}
              </code>
              <span class="w-14 shrink-0 text-pb-caption tabular-nums">{{ step.px }}</span>
              <span
                class="h-4 rounded-pb-sm bg-pb-primary"
                [style.width]="step.px"
                aria-hidden="true"
              ></span>
              <span class="text-pb-caption text-on-surface-variant">{{ step.use }}</span>
            </div>
          }
        </div>
      </section>

      <!-- ================= RADIUS + ELEVATION ================= -->
      <div class="grid gap-pb-4 lg:grid-cols-2">
        <section class="pb-surface p-pb-4">
          <h2 class="m-0 text-pb-title text-on-surface">Border radius</h2>
          <p class="m-0 mt-pb-1 text-pb-caption text-on-surface-variant">
            Never nest a radius larger than its parent's.
          </p>
          <div class="mt-pb-4 grid grid-cols-2 gap-pb-3 sm:grid-cols-4">
            @for (r of radii; track r.token) {
              <div class="flex flex-col items-center gap-pb-2">
                <span
                  class="flex h-16 w-full items-center justify-center border border-outline-variant bg-surface-container"
                  [class]="r.cls"
                  aria-hidden="true"
                ></span>
                <code class="text-pb-caption text-on-surface-variant">{{ r.token }}</code>
                <span class="text-pb-caption tabular-nums">{{ r.px }}</span>
              </div>
            }
          </div>
        </section>

        <section class="pb-surface p-pb-4">
          <h2 class="m-0 text-pb-title text-on-surface">Elevation</h2>
          <p class="m-0 mt-pb-1 text-pb-caption text-on-surface-variant">
            Hairline shadows in the Linear and Stripe idiom — the border does most of the work.
          </p>
          <div class="mt-pb-4 grid grid-cols-2 gap-pb-4 sm:grid-cols-3">
            @for (e of elevation; track e.token) {
              <div class="flex flex-col items-center gap-pb-2">
                <span
                  class="flex h-16 w-full items-center justify-center rounded-pb-lg border border-outline-variant bg-surface-container-low"
                  [class]="e.cls"
                  aria-hidden="true"
                ></span>
                <code class="text-pb-caption text-on-surface-variant">{{ e.token }}</code>
                <span class="text-center text-pb-caption text-on-surface-variant">{{ e.use }}</span>
              </div>
            }
          </div>
        </section>
      </div>

      <!-- ================= FOUNDATION COLOUR ================= -->
      <section class="pb-surface p-pb-4">
        <h2 class="m-0 text-pb-title text-on-surface">Surfaces, text and borders</h2>
        <p class="m-0 mt-pb-1 max-w-prose text-pb-caption text-on-surface-variant">
          The page is <code>#fafafb</code> and every card on it is pure white. What separates them
          is the 1px border, not the shadow — that is the whole difference between this and a
          Material look, where surfaces are tinted with the brand and floated on elevation.
        </p>

        <div class="mt-pb-4 grid gap-pb-4 lg:grid-cols-3">
          @for (group of foundation; track group.title) {
            <div>
              <h3 class="m-0 text-pb-overline uppercase text-on-surface-variant">
                {{ group.title }}
              </h3>
              <div class="mt-pb-2 flex flex-col divide-y divide-outline-variant">
                @for (swatch of group.swatches; track swatch.token) {
                  <div class="flex items-center gap-pb-3 py-pb-2">
                    <span
                      class="h-8 w-8 shrink-0 rounded-pb-sm border border-outline-variant"
                      [class]="swatch.cls"
                      aria-hidden="true"
                    ></span>
                    <div class="min-w-0">
                      <code class="block truncate text-pb-caption">{{ swatch.token }}</code>
                      <span class="text-pb-caption text-on-surface-variant">{{ swatch.use }}</span>
                    </div>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      </section>

      <!-- ================= BRAND ================= -->
      <section class="pb-surface p-pb-4">
        <h2 class="m-0 text-pb-title text-on-surface">Brand</h2>
        <p class="m-0 mt-pb-1 max-w-prose text-pb-caption text-on-surface-variant">
          Three colours with three jobs. The discipline is the point: brown is the loudest thing the
          system can put on a page, so it is spent only on actions and committed state; pink marks
          what responds to you; gold marks what is worth money.
        </p>

        <div class="mt-pb-4 grid gap-pb-4 md:grid-cols-3">
          @for (role of brandRoles; track role.name) {
            <div class="flex flex-col gap-pb-3 rounded-pb-md border border-outline-variant p-pb-3">
              <div class="flex items-center gap-pb-3">
                <span
                  class="h-12 w-12 shrink-0 rounded-pb-md border border-outline-variant"
                  [class]="role.cls"
                  aria-hidden="true"
                ></span>
                <div>
                  <p class="m-0 text-pb-subtitle text-on-surface">{{ role.name }}</p>
                  <code class="text-pb-caption text-on-surface-variant">{{ role.hex }}</code>
                </div>
              </div>

              <div>
                <p class="m-0 text-pb-overline uppercase text-on-surface-variant">Use for</p>
                <p class="m-0 mt-pb-1 text-pb-caption">{{ role.useFor }}</p>
              </div>

              <div>
                <p class="m-0 text-pb-overline uppercase text-on-surface-variant">Never</p>
                <p class="m-0 mt-pb-1 text-pb-caption">{{ role.never }}</p>
              </div>

              <p class="m-0 mt-auto text-pb-caption text-on-surface-variant">{{ role.contrast }}</p>
            </div>
          }
        </div>

        <h3 class="m-0 mt-pb-5 text-pb-subtitle text-on-surface">
          The two contrast lives of a brand colour
        </h3>
        <p class="m-0 mt-pb-1 max-w-prose text-pb-caption text-on-surface-variant">
          A brand colour is chosen for how it looks as a fill, and a fill has no contrast
          requirement. Text has 4.5:1. Every brand and status colour therefore ships a darker
          text-safe step, and the pair below is the single most useful thing on this page. The
          ratios are measured <strong>against white</strong> — in dark mode each token flips to its
          own light step, so the figures below describe the light theme only.
        </p>
        <div class="mt-pb-3 grid gap-pb-3 sm:grid-cols-2 lg:grid-cols-4">
          @for (pair of textSafe; track pair.token) {
            <div class="rounded-pb-md border border-outline-variant p-pb-3">
              <p class="m-0 text-pb-body" [class]="pair.badCls">{{ pair.label }}</p>
              <p class="m-0 text-pb-caption text-on-surface-variant">
                {{ pair.badToken }} · {{ pair.badRatio }} ✗
              </p>
              <p class="m-0 mt-pb-2 text-pb-body" [class]="pair.goodCls">{{ pair.label }}</p>
              <p class="m-0 text-pb-caption text-on-surface-variant">
                {{ pair.goodToken }} · {{ pair.goodRatio }} ✓
              </p>
            </div>
          }
        </div>
      </section>

      <!-- ================= STATUS ================= -->
      <section class="pb-surface p-pb-4">
        <h2 class="m-0 text-pb-title text-on-surface">Status colours</h2>
        <p class="m-0 mt-pb-1 max-w-prose text-pb-caption text-on-surface-variant">
          Six tones, each a set of surface, border and foreground applied together. The hues sit
          deliberately outside the brand — green must mean safe and red must mean stop even on a
          page whose brand is pink. Colour is never the only signal: every tone ships with an icon.
        </p>

        <div class="mt-pb-4 grid gap-pb-3 sm:grid-cols-2 lg:grid-cols-3">
          @for (tone of tones; track tone.name) {
            <div class="flex flex-col gap-pb-2 rounded-pb-md border border-outline-variant p-pb-3">
              <div class="flex items-center justify-between">
                <code class="text-pb-caption text-on-surface-variant">{{ tone.name }}</code>
                <pb-status-badge [tone]="tone.name" [label]="tone.label" />
              </div>
              <span [class]="'h-8 rounded-pb-sm border pb-tone-' + tone.name" aria-hidden="true">
              </span>
            </div>
          }
        </div>

        <h3 class="m-0 mt-pb-5 text-pb-subtitle text-on-surface">Hover versus selected</h3>
        <p class="m-0 mt-pb-1 max-w-prose text-pb-caption text-on-surface-variant">
          The brief puts "selected items" under brown and "selection" under pink. Both are right,
          about different things: pink is transient — the pointer is here — and disappears when you
          look away; brown is committed, and survives. Hover the rows to see it.
        </p>
        <div class="mt-pb-3 overflow-hidden rounded-pb-md border border-outline-variant">
          @for (row of selectionDemo; track row.label) {
            <div
              class="flex items-center justify-between px-pb-3 py-pb-2 text-pb-body transition-colors duration-pb-instant"
              [class]="row.cls"
            >
              <span>{{ row.label }}</span>
              <span class="text-pb-caption text-on-surface-variant">{{ row.note }}</span>
            </div>
          }
        </div>
      </section>

      <!-- ================= ICONS + MOTION ================= -->
      <div class="grid gap-pb-4 lg:grid-cols-2">
        <section class="pb-surface p-pb-4">
          <h2 class="m-0 text-pb-title text-on-surface">Icon sizes</h2>
          <div class="mt-pb-4 flex flex-wrap items-end gap-pb-4">
            @for (i of iconSizes; track i.label) {
              <div class="flex flex-col items-center gap-pb-2">
                <mat-icon [class]="i.cls" aria-hidden="true">inventory_2</mat-icon>
                <code class="text-pb-caption text-on-surface-variant">{{ i.label }}</code>
              </div>
            }
          </div>
        </section>

        <section class="pb-surface p-pb-4">
          <h2 class="m-0 text-pb-title text-on-surface">Motion</h2>
          <p class="m-0 mt-pb-1 text-pb-caption text-on-surface-variant">
            Nothing above 240ms. Hover a swatch to see its curve.
          </p>
          <div class="mt-pb-4 flex flex-col gap-pb-2">
            @for (m of motion; track m.token) {
              <div class="flex items-center gap-pb-3">
                <code class="w-40 shrink-0 text-pb-caption text-on-surface-variant">
                  {{ m.token }}
                </code>
                <span
                  class="h-8 flex-1 rounded-pb-sm bg-surface-container transition-colors hover:bg-pb-selected-surface"
                  [style.transition-duration]="m.ms"
                  aria-hidden="true"
                ></span>
                <span class="w-14 text-right text-pb-caption tabular-nums">{{ m.ms }}</span>
              </div>
            }
          </div>
        </section>
      </div>

      <!-- ================= CONTROLS ================= -->
      <section class="pb-surface p-pb-4">
        <h2 class="m-0 text-pb-title text-on-surface">Controls</h2>
        <p class="m-0 mt-pb-1 max-w-prose text-pb-caption text-on-surface-variant">
          Buttons and fields keep Material's behaviour — ripple, focus, disabled semantics, ARIA —
          and take the system's geometry through <code>pb-btn</code>. Re-implementing a button to
          change its radius would be a downgrade dressed as a design system.
        </p>

        <div class="mt-pb-4 flex flex-wrap items-center gap-pb-3">
          <button matButton="filled" type="button" class="pb-btn">Primary</button>
          <button matButton="tonal" type="button" class="pb-btn">Tonal</button>
          <button matButton="outlined" type="button" class="pb-btn">Outlined</button>
          <button matButton type="button" class="pb-btn">Text</button>
          <button matButton="filled" type="button" class="pb-btn" disabled>Disabled</button>
          <button matButton="filled" type="button" class="pb-btn-lg">Large (touch)</button>
        </div>

        <div class="mt-pb-5 grid gap-pb-4 sm:grid-cols-2">
          <div>
            <h3 class="m-0 text-pb-subtitle text-on-surface">Material field</h3>
            <mat-form-field class="mt-pb-2 w-full" subscriptSizing="dynamic">
              <mat-label>Supplier</mat-label>
              <input matInput placeholder="Search suppliers" />
            </mat-form-field>
          </div>

          <div>
            <h3 class="m-0 text-pb-subtitle text-on-surface">Plain input</h3>
            <p class="m-0 mt-pb-1 text-pb-caption text-on-surface-variant">
              <code>pb-input</code>, for controls outside a Material field.
            </p>
            <input class="pb-input mt-pb-2" placeholder="Search suppliers" />
            <input class="pb-input pb-input-invalid mt-pb-2" value="Not a valid GSTIN" />
          </div>
        </div>
      </section>

      <!-- ================= TABLE ================= -->
      <section class="pb-surface overflow-hidden">
        <div class="p-pb-4 pb-0">
          <h2 class="m-0 text-pb-title text-on-surface">Table</h2>
          <p class="m-0 mt-pb-1 text-pb-caption text-on-surface-variant">
            Horizontal rules only — vertical ones turn a table into a grid and make scanning a row
            harder, which is the one thing a table is for.
          </p>
        </div>
        <div class="mt-pb-3 overflow-x-auto">
          <table class="pb-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Status</th>
                <th class="pb-num">Quantity</th>
                <th class="pb-num">Value</th>
              </tr>
            </thead>
            <tbody>
              @for (row of tableRows; track row.item) {
                <tr>
                  <td>{{ row.item }}</td>
                  <td><pb-status-badge [tone]="row.tone" [label]="row.status" /></td>
                  <td class="pb-num">{{ row.qty }}</td>
                  <td class="pb-num">{{ row.value }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <!-- ================= BADGES ================= -->
      <section class="pb-surface p-pb-4">
        <h2 class="m-0 text-pb-title text-on-surface">Badges</h2>

        <h3 class="m-0 mt-pb-3 text-pb-subtitle text-on-surface">Status</h3>
        <div class="mt-pb-2 flex flex-wrap gap-pb-2">
          <pb-status-badge tone="success" label="Paid" />
          <pb-status-badge tone="warning" label="Awaiting payment" icon="clock" />
          <pb-status-badge tone="danger" label="Cancelled" icon="transferRejected" />
          <pb-status-badge tone="info" label="In transit" icon="suppliers" />
          <pb-status-badge tone="neutral" label="Draft" icon="edit" />
          <pb-status-badge tone="accent" label="Signature" />
          <pb-status-badge tone="neutral" label="No icon" [showIcon]="false" />
          <pb-status-badge tone="info" label="Square" [pill]="false" />
        </div>

        <h3 class="m-0 mt-pb-5 text-pb-subtitle text-on-surface">Metric</h3>
        <p class="m-0 mt-pb-1 max-w-prose text-pb-caption text-on-surface-variant">
          The same direction can be good or bad, so the caller says which. Note the two "up" badges
          below are coloured oppositely — rising revenue is good, rising wastage is not.
        </p>
        <div class="mt-pb-2 flex flex-wrap gap-pb-2">
          <pb-metric-badge value="+12.4%" direction="up" positiveWhen="up" caption="revenue" />
          <pb-metric-badge value="+8.2%" direction="up" positiveWhen="down" caption="wastage" />
          <pb-metric-badge value="−3.1%" direction="down" positiveWhen="up" caption="orders" />
          <pb-metric-badge value="−₹1,240" direction="down" positiveWhen="down" caption="cost" />
          <pb-metric-badge value="0.0%" direction="flat" positiveWhen="up" />
        </div>
      </section>

      <!-- ================= CARDS ================= -->
      <section>
        <h2 class="m-0 text-pb-title text-on-surface">Cards</h2>
        <p class="m-0 mt-pb-1 max-w-prose text-pb-caption text-on-surface-variant">
          <code>pb-card</code> is the section card and <code>pb-stat-card</code> the metric tile;
          both already existed and are reused rather than duplicated. New here is
          <code>pb-chart-card</code>, which reserves the chart's height while loading so a dashboard
          settles once instead of once per tile.
        </p>

        <div class="mt-pb-4 grid gap-pb-4 sm:grid-cols-2 xl:grid-cols-4">
          <pb-stat-card label="Revenue today" value="₹12,450" icon="payments" />
          <pb-stat-card
            label="Orders"
            value="38"
            icon="receipt_long"
            trend="up"
            delta="+6 vs yesterday"
            positiveWhen="up"
          />
          <pb-stat-card
            label="Wastage"
            value="1.8 kg"
            icon="delete_outline"
            trend="up"
            delta="+0.4 kg"
            positiveWhen="down"
          />
          <pb-stat-card label="Low stock items" value="7" icon="warning" [loading]="true" />
        </div>

        <div class="mt-pb-4 grid gap-pb-4 lg:grid-cols-2">
          <pb-chart-card
            title="Revenue"
            subtitle="Last 7 days"
            headline="₹1,24,500"
            delta="+12.4%"
            direction="up"
            positiveWhen="up"
            deltaCaption="vs previous week"
            [spec]="demoChart"
          />
          <pb-chart-card
            title="Revenue"
            subtitle="Loading state — height is reserved"
            [spec]="demoChart"
            [loading]="true"
          />
        </div>
      </section>

      <!-- ================= LOADING & EMPTY ================= -->
      <div class="grid gap-pb-4 lg:grid-cols-2">
        <section class="pb-surface p-pb-4">
          <h2 class="m-0 text-pb-title text-on-surface">Loading states</h2>
          <p class="m-0 mt-pb-1 max-w-prose text-pb-caption text-on-surface-variant">
            Skeletons for content whose shape is known; a spinner for an action whose result is not.
          </p>

          <div class="mt-pb-4 flex flex-col gap-pb-4">
            <div role="status" aria-live="polite" aria-busy="true">
              <span class="sr-only">Loading example content</span>
              <div class="flex items-start gap-pb-3">
                <pb-skeleton variant="circle" />
                <div class="flex-1">
                  <pb-skeleton variant="heading" />
                  <div class="mt-pb-2">
                    <pb-skeleton [lines]="3" />
                  </div>
                </div>
              </div>
              <div class="mt-pb-3 flex gap-pb-2">
                <pb-skeleton variant="button" />
                <pb-skeleton variant="button" width="4rem" />
              </div>
            </div>

            <div class="border-t border-outline-variant pt-pb-3">
              <pb-spinner size="md" label="Exporting report…" />
            </div>
          </div>
        </section>

        <section class="pb-surface p-pb-4">
          <h2 class="m-0 text-pb-title text-on-surface">Empty state</h2>
          <p class="m-0 mt-pb-1 text-pb-caption text-on-surface-variant">
            Wording differs between "nothing yet" and "nothing matches" — the first invites
            creating, the second invites clearing a filter.
          </p>
          <div class="mt-pb-3 rounded-pb-md border border-dashed border-outline-variant">
            <pb-empty-state
              icon="inventory_2"
              title="No stock recorded yet"
              message="Record a purchase and the items will appear here."
              actionLabel="Record purchase"
            />
          </div>
        </section>
      </div>

      <!-- ================= INTERACTIVE SURFACE ================= -->
      <section>
        <h2 class="m-0 text-pb-title text-on-surface">Interactive surface</h2>
        <p class="m-0 mt-pb-1 max-w-prose text-pb-caption text-on-surface-variant">
          Hover these. The lift is 1px — a card that leaps reads as cheap.
        </p>
        <div class="mt-pb-3 grid gap-pb-3 sm:grid-cols-3">
          @for (n of [1, 2, 3]; track n) {
            <button type="button" class="pb-surface pb-surface-interactive p-pb-4 text-left">
              <p class="m-0 text-pb-subtitle text-on-surface">Clickable card {{ n }}</p>
              <p class="m-0 mt-pb-1 text-pb-caption text-on-surface-variant">
                Border, shadow and position all move together.
              </p>
            </button>
          }
        </div>
      </section>
    </div>
  `,
})
export class DesignSystemPage {
  protected readonly typography = [
    {
      token: 'text-pb-display',
      cls: 'text-pb-display',
      sample: '₹1,24,500',
      meta: '44 / 1.1 / 640',
    },
    {
      token: 'text-pb-heading',
      cls: 'text-pb-heading',
      sample: 'Inventory',
      meta: '28 / 1.2 / 620',
    },
    {
      token: 'text-pb-title',
      cls: 'text-pb-title',
      sample: 'Low stock items',
      meta: '18 / 1.35 / 600',
    },
    {
      token: 'text-pb-subtitle',
      cls: 'text-pb-subtitle',
      sample: 'Needs reordering',
      meta: '15 / 1.45 / 500',
    },
    {
      token: 'text-pb-body',
      cls: 'text-pb-body',
      sample: 'Belgian chocolate, 2.4 kg remaining.',
      meta: '14 / 1.55 / 400',
    },
    {
      token: 'text-pb-caption',
      cls: 'text-pb-caption text-on-surface-variant',
      sample: 'Updated 5 minutes ago',
      meta: '13 / 1.45 / 400',
    },
    {
      token: 'text-pb-overline',
      cls: 'text-pb-overline uppercase text-on-surface-variant',
      sample: 'This week',
      meta: '11 / 1.3 / 600',
    },
  ] as const;

  protected readonly spacing = [
    { token: 'pb-1', px: '4px', use: 'icon to its label' },
    { token: 'pb-2', px: '8px', use: 'inside a control' },
    { token: 'pb-3', px: '16px', use: 'between related items' },
    { token: 'pb-4', px: '24px', use: 'card padding' },
    { token: 'pb-5', px: '32px', use: 'between cards' },
    { token: 'pb-6', px: '40px', use: 'between sections' },
    { token: 'pb-7', px: '48px', use: 'page gutter' },
    { token: 'pb-8', px: '64px', use: 'major divisions' },
  ] as const;

  protected readonly radii = [
    { token: 'pb-sm', px: '6px', cls: 'rounded-pb-sm' },
    { token: 'pb-md', px: '8px', cls: 'rounded-pb-md' },
    { token: 'pb-lg', px: '12px', cls: 'rounded-pb-lg' },
    { token: 'pb-xl', px: '16px', cls: 'rounded-pb-xl' },
  ] as const;

  protected readonly elevation = [
    { token: 'pb-xs', cls: 'shadow-pb-xs', use: 'resting card' },
    { token: 'pb-sm', cls: 'shadow-pb-sm', use: 'hover' },
    { token: 'pb-md', cls: 'shadow-pb-md', use: 'menu, popover' },
    { token: 'pb-lg', cls: 'shadow-pb-lg', use: 'dialog, sheet' },
    { token: 'pb-focus', cls: 'shadow-pb-focus', use: 'focus ring' },
    { token: 'pb-none', cls: 'shadow-pb-none', use: 'flat' },
  ] as const;

  protected readonly tones = [
    { name: 'neutral' as const, label: 'Draft' },
    { name: 'info' as const, label: 'In transit' },
    { name: 'success' as const, label: 'Paid' },
    { name: 'warning' as const, label: 'Low stock' },
    { name: 'danger' as const, label: 'Cancelled' },
    { name: 'accent' as const, label: 'Signature' },
  ] as const;

  /**
   * The foundation swatches.
   *
   * Rendered through the utility class rather than an inline hex, so this page shows what the token
   * *currently resolves to* — including in dark mode. A gallery painted with literal hex values is a
   * screenshot that happens to be made of HTML, and it goes stale silently.
   */
  protected readonly foundation = [
    {
      title: 'Surfaces',
      swatches: [
        { token: 'pb-page', cls: 'bg-pb-page', use: 'the app background' },
        { token: 'pb-surface', cls: 'bg-pb-surface', use: 'cards, menus, inputs' },
        { token: 'pb-surface-sunken', cls: 'bg-pb-surface-sunken', use: 'table headers, wells' },
        { token: 'pb-inverse-surface', cls: 'bg-pb-inverse-surface', use: 'snackbar, tooltip' },
      ],
    },
    {
      title: 'Text',
      swatches: [
        { token: 'pb-text', cls: 'bg-pb-text', use: 'body and headings — 16.1:1' },
        { token: 'pb-text-secondary', cls: 'bg-pb-text-secondary', use: 'captions — 6.1:1' },
        { token: 'pb-text-muted', cls: 'bg-pb-text-muted', use: 'placeholders only — 3.8:1' },
        { token: 'pb-text-disabled', cls: 'bg-pb-text-disabled', use: 'unusable control' },
      ],
    },
    {
      title: 'Borders',
      swatches: [
        { token: 'pb-border-subtle', cls: 'bg-pb-border-subtle', use: 'rules inside a surface' },
        { token: 'pb-border', cls: 'bg-pb-border', use: 'the edge of a surface' },
        { token: 'pb-border-strong', cls: 'bg-pb-border-strong', use: 'hovered or focused edge' },
      ],
    },
  ] as const;

  /** The three brand colours, each with the job it is allowed to do and the one it is not. */
  protected readonly brandRoles = [
    {
      name: 'Chocolate',
      hex: '#3b2416',
      cls: 'bg-pb-primary',
      useFor: 'Primary buttons, navigation, selected items, important actions.',
      never: 'Headings, card borders, icons, or anything decorative.',
      contrast:
        '14.5:1 on white — the loudest colour in the system. Inverts to a warm cream in dark mode, ' +
        'where the brown itself measures 1.4:1 and would be a button-shaped hole.',
    },
    {
      name: 'Pink',
      hex: '#ff4d8d',
      cls: 'bg-pb-interactive',
      useFor: 'Hover, focus ring, links, text selection, the unread dot.',
      never: 'Text at this exact value — use pb-link, two steps deeper.',
      contrast: '3.1:1 — clears a focus ring, fails body text.',
    },
    {
      name: 'Gold',
      hex: '#c89b5b',
      cls: 'bg-pb-gold',
      useFor: 'Revenue, premium and featured markers, the brand mark.',
      never: 'Text on a light surface — use pb-gold-fg.',
      contrast: '2.5:1 — a fill and a rule, never a letterform.',
    },
  ] as const;

  /**
   * Fill colour beside text colour, for the four cases where using the brand value as text would
   * fail WCAG AA. The ratios are measured against white, not estimated.
   */
  protected readonly textSafe = [
    {
      label: '₹1,24,500',
      badCls: 'text-pb-gold',
      badToken: 'pb-gold',
      badRatio: '2.5:1',
      goodCls: 'text-pb-gold-fg',
      goodToken: 'pb-gold-fg',
      goodRatio: '4.8:1',
      token: 'gold',
    },
    {
      label: 'View invoice',
      badCls: 'text-pb-interactive',
      badToken: 'pb-interactive',
      badRatio: '3.1:1',
      goodCls: 'text-pb-link',
      goodToken: 'pb-link',
      goodRatio: '5.7:1',
      token: 'pink',
    },
    {
      label: 'Payment received',
      badCls: 'text-pb-success-base',
      badToken: 'pb-success-base',
      badRatio: '2.3:1',
      goodCls: 'text-pb-success-fg',
      goodToken: 'pb-success-fg',
      goodRatio: '5.0:1',
      token: 'success',
    },
    {
      label: 'Stock running low',
      badCls: 'text-pb-warning-base',
      badToken: 'pb-warning-base',
      badRatio: '2.1:1',
      goodCls: 'text-pb-warning-fg',
      goodToken: 'pb-warning-fg',
      goodRatio: '5.0:1',
      token: 'warning',
    },
  ] as const;

  /** Three rows showing the hover/selected split. The middle one carries the hover class always. */
  protected readonly selectionDemo = [
    {
      label: 'Belgian chocolate',
      note: 'at rest',
      cls: 'bg-pb-surface hover:bg-pb-hover-surface',
    },
    {
      label: 'Nutella (1 kg)',
      note: 'hovered — pink, transient',
      cls: 'bg-pb-hover-surface',
    },
    {
      label: 'Waffle cones',
      note: 'selected — brown, committed',
      cls: 'bg-pb-primary-tint-strong',
    },
  ] as const;

  protected readonly iconSizes = [
    { label: 'xs · 14', cls: '!h-3.5 !w-3.5 !text-[14px]' },
    { label: 'sm · 16', cls: '!h-4 !w-4 !text-[16px]' },
    { label: 'md · 20', cls: '!h-5 !w-5 !text-[20px]' },
    { label: 'lg · 24', cls: '!h-6 !w-6 !text-[24px]' },
    { label: 'xl · 32', cls: '!h-8 !w-8 !text-[32px]' },
    { label: '2xl · 48', cls: '!h-12 !w-12 !text-[48px]' },
  ] as const;

  protected readonly motion = [
    { token: 'duration-pb-instant', ms: '80ms' },
    { token: 'duration-pb-fast', ms: '140ms' },
    { token: 'duration-pb-base', ms: '200ms' },
    { token: 'duration-pb-slow', ms: '240ms' },
  ] as const;

  protected readonly tableRows = [
    {
      item: 'Belgian chocolate',
      status: 'In stock',
      tone: 'success' as const,
      qty: '12.400',
      value: '₹8,240',
    },
    {
      item: 'Nutella (1 kg)',
      status: 'Low stock',
      tone: 'warning' as const,
      qty: '1.200',
      value: '₹1,180',
    },
    {
      item: 'Waffle cones',
      status: 'Out of stock',
      tone: 'danger' as const,
      qty: '0.000',
      value: '₹0',
    },
    {
      item: 'Strawberries',
      status: 'In transit',
      tone: 'info' as const,
      qty: '4.000',
      value: '₹960',
    },
  ] as const;

  /** Static series — this page must render identically every time, so nothing is randomised. */
  protected readonly demoChart: ChartSpec = {
    type: 'area',
    height: 256,
    series: [{ name: 'Revenue', data: [12400, 14800, 13200, 17600, 19200, 16400, 21800] }],
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    valuePrefix: '₹',
  };

  /** Only here so the loading demos have something to toggle if this page grows controls. */
  protected readonly loading = signal(false);
}
