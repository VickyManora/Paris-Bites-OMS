import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  effect,
  inject,
  input,
  isDevMode,
  viewChild,
} from '@angular/core';
import ApexCharts from 'apexcharts';
import { ThemeService } from '../../../core/services/theme.service';

/** What a caller declares. Everything visual is decided here, not per chart. */
export interface ChartSpec {
  readonly type: 'area' | 'bar' | 'donut' | 'line';
  readonly series: readonly { name: string; data: readonly number[] }[] | readonly number[];
  /** X-axis categories, or slice labels for a donut. */
  readonly labels?: readonly string[];
  /** Overrides the palette when a series has a fixed meaning, e.g. red for write-downs. */
  readonly colors?: readonly string[];
  readonly horizontal?: boolean;
  readonly stacked?: boolean;
  /** Prefixed to every value in tooltips and axis labels — `₹` for money. */
  readonly valuePrefix?: string;
  readonly valueSuffix?: string;
  readonly height?: number;
  /**
   * Which palette the marks draw from.
   *
   * Left unset it is inferred, which is right almost always: one series gets the brand colour,
   * several get the categorical slots. Set it explicitly only to overrule that — a single-series
   * chart sitting beside a multi-series one that must agree with slot 1, for instance.
   */
  readonly palette?: 'brand' | 'categorical';
  /**
   * Strips the chart to the line alone — no axes, grid, legend, padding or tooltip.
   *
   * For a sparkline inside a KPI tile, where the shape is the whole message and any chrome would
   * be larger than the data. The value it belongs to is stated beside it, so nothing is gated on
   * reading the plot.
   */
  readonly sparkline?: boolean;
  /**
   * Forces the legend on or off. Unset means "on for two or more series".
   *
   * A single series needs no legend: there is one colour, and the card's own title already says
   * what is plotted, so a box with one swatch restates the title and costs a row of the card.
   */
  readonly showLegend?: boolean;
}

/**
 * Most x-axis labels drawn before Apex starts skipping them.
 *
 * Twelve fits comfortably in the narrowest card this component is used in; beyond that
 * the axis becomes a smear of overlapping dates.
 */
const MAX_AXIS_TICKS = 12;

/** How many categorical slots the design system defines. See the CHART COLOURS note there. */
const CATEGORICAL_SLOTS = 5;

/**
 * Resolves a CSS custom property to a **concrete** colour.
 *
 * The probe element is the point. Reading a custom property off `documentElement` returns its
 * declared text, and the Material tokens are declared as `light-dark(#a, #b)` — a function, not a
 * colour. Browsers resolve that when it lands in a paint property, so charts still *drew* correctly,
 * but any code that tried to inspect or adjust the value silently failed. That is precisely how the
 * previous palette helper became a no-op and let three donut slices render in one colour.
 *
 * Assigning it to a real element and reading it back through `getComputedStyle` forces the
 * resolution, so what comes out here is always an `rgb(...)` this module can compare and mix.
 */
function resolveColour(name: string, fallback: string): string {
  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${name},${fallback})`;
  document.body.appendChild(probe);

  const resolved = getComputedStyle(probe).color;
  probe.remove();

  return resolved.length > 0 ? resolved : fallback;
}

/** Mixes an `rgb()` or hex colour toward white (positive) or black (negative). */
function shade(colour: string, amount: number): string {
  const channels = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(colour);
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim())?.[1];

  const parts =
    channels !== null
      ? [channels[1], channels[2], channels[3]].map((part) => Number(part))
      : hex !== undefined
        ? [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
        : null;

  if (parts === null) {
    return colour;
  }

  const target = amount > 0 ? 255 : 0;
  const mixed = parts.map((channel) => Math.round(channel + (target - channel) * Math.abs(amount)));

  return `rgb(${mixed.join(', ')})`;
}

/**
 * A themed ApexCharts wrapper.
 *
 * ApexCharts renders into a plain DOM node and manages its own lifecycle, so it is wrapped
 * once here rather than reached for in every page. Two things this buys:
 *
 * **The palette comes from the app's design tokens, not from Apex's defaults.** Charts that
 * ship their own colours are the fastest way to make a product look like two products, and
 * the app already defines primary, tertiary and error for exactly this purpose.
 *
 * **Theme changes redraw it.** Apex bakes label and grid colours into the chart at
 * construction, so a chart built in light mode keeps near-black text after the user
 * switches to dark and becomes unreadable. The effect below tears down and rebuilds on
 * `isDark()` rather than trying to patch the options in place.
 */
@Component({
  selector: 'pb-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="w-full"></div>`,
})
export class ChartComponent {
  readonly spec = input.required<ChartSpec>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly theme = inject(ThemeService);

  private chart: ApexCharts | null = null;

  /**
   * Recomputed on every spec or theme change; the effect below reacts to it.
   *
   * Reading `isDark()` inside the computed is what registers the dependency — the value is
   * then used for the label and grid colours, which are the parts Apex cannot restyle
   * after construction.
   */
  private readonly options = computed<Record<string, unknown>>(() => {
    const spec = this.spec();
    const dark = this.theme.isDark();

    const onSurface = resolveColour('--color-pb-text', dark ? '#f2f2f5' : '#1c1c22');
    const muted = resolveColour('--color-pb-text-secondary', dark ? '#a1a1ad' : '#61616e');
    /*
     * The grid is the design system's *chart* grid, not its border colour.
     *
     * Those are two different jobs and the border was doing both: a card's edge has to be visible,
     * while a gridline sits behind the data and should be barely there. Bound to `--color-pb-chart-
     * grid`, a rule can be lightened for charts without thinning every card on the page.
     */
    const grid = resolveColour('--color-pb-chart-grid', dark ? '#22222b' : '#e7e7eb');
    /*
     * The card the chart sits on, used as the gap between touching marks.
     *
     * Separation between neighbouring slices and bars is done with a gap in the *surface* colour,
     * not with a stroke around each mark — a border adds ink that is not data. The previous version
     * hardcoded `#fff` for this, which is right on a light card and draws white seams across a dark
     * one.
     */
    const surface = resolveColour('--color-pb-surface', dark ? '#131318' : '#ffffff');

    const isDonut = spec.type === 'donut';
    const isSparkline = spec.sparkline ?? false;
    const labelCount = spec.labels?.length ?? 0;

    /*
     * How many colours this chart needs.
     *
     * A donut colours by *data point*, so it needs one per slice; everything else colours by series.
     */
    const markCount = isDonut ? labelCount : spec.series.length;
    const usePalette = spec.palette ?? (markCount > 1 ? 'categorical' : 'brand');
    const palette = spec.colors ?? this.paletteFor(usePalette, markCount);

    /* A legend restates the title when there is only one thing plotted. */
    const showLegend = spec.showLegend ?? (!isSparkline && markCount > 1);

    const formatValue = (value: number): string =>
      `${spec.valuePrefix ?? ''}${value.toLocaleString('en-IN', {
        maximumFractionDigits: spec.valuePrefix === '₹' ? 0 : 2,
      })}${spec.valueSuffix ?? ''}`;

    return {
      chart: {
        type: spec.type,
        height: spec.height ?? 280,
        stacked: spec.stacked ?? false,
        // The app has its own export and print paths; Apex's floating menu duplicates
        // neither and covers the top-right of every card.
        toolbar: { show: false },
        zoom: { enabled: false },
        fontFamily: 'inherit',
        background: 'transparent',
        // `parentHeightOffset: 0` removes the stray gap Apex leaves above every chart,
        // which otherwise makes cards of the same height look misaligned.
        parentHeightOffset: 0,
        animations: { enabled: true, speed: 300 },
        ...(isSparkline ? { sparkline: { enabled: true } } : {}),
      },
      theme: { mode: dark ? 'dark' : 'light' },
      colors: palette,
      series: spec.series,
      ...(isDonut ? { labels: [...(spec.labels ?? [])] } : {}),
      dataLabels: { enabled: false },
      stroke: {
        /*
         * `monotoneCubic`, which is smooth **and** cannot overshoot.
         *
         * This was `straight`, for a good reason: Apex's `smooth` fits a Catmull-Rom-style spline
         * through the points, and a spline through sparse data overshoots its own inputs. On the
         * stock-movement chart it drew the count of daily movements dipping visibly below zero
         * between two quiet days — a number that cannot exist. A chart may not invent values between
         * the ones it was given.
         *
         * `monotoneCubic` is the resolution rather than a compromise. A monotone cubic interpolant
         * is constrained to stay within the interval of its neighbouring points, so it is smooth
         * everywhere and provably never introduces a maximum or minimum the data does not contain.
         * The curve reads as premium; the zero floor holds.
         *
         * Sparklines keep it too — the hero's shape is the one place a soft curve most earns its
         * place, and the same guarantee applies.
         */
        curve: 'monotoneCubic',
        /*
         * 2px lines, and a 2px surface gap around donut slices.
         *
         * Bars get no stroke at all: adjacent columns here never touch, so a gap has nothing to
         * separate, and outlining every bar would just add weight.
         */
        width: spec.type === 'area' || spec.type === 'line' ? 2 : isDonut ? 2 : 0,
        ...(isDonut ? { colors: [surface] } : {}),
        lineCap: 'round',
      },
      /*
       * The fill, and why its strength depends on how many series are plotted.
       *
       * A rich gradient under a single area is what makes a trend read as a *volume* rather than as
       * a wire — it is the Stripe/Linear look, and with one series there is nothing for it to
       * obscure. So a lone area gets a real gradient: 45% at the line falling to nothing at the
       * baseline.
       *
       * **Two or more series must not.** Four overlapping fills at 45% is a muddy stack in which no
       * single series can be followed, and the colour where two overlap belongs to neither of them —
       * the reader is asked to decode a hue the legend does not contain. Above one series the fill
       * drops back to a 14% wash whose only job is to say which side of the line is "under".
       *
       * This is why the strength is computed rather than set: the same component draws the hero
       * sparkline and the four-series movement chart, and the right answer is different for each.
       */
      fill:
        spec.type === 'area'
          ? {
              type: 'gradient',
              gradient:
                spec.series.length === 1
                  ? {
                      shadeIntensity: 0,
                      opacityFrom: 0.45,
                      opacityTo: 0,
                      stops: [0, 92],
                      inverseColors: false,
                    }
                  : { shadeIntensity: 0, opacityFrom: 0.14, opacityTo: 0.02, stops: [0, 95] },
            }
          : { opacity: 1 },
      plotOptions: {
        bar: {
          horizontal: spec.horizontal ?? false,
          borderRadius: 4,
          borderRadiusApplication: 'end',
          /*
           * Capped in pixels as well as proportionally.
           *
           * `columnWidth` alone means a chart with four days draws four fat slabs, because 55% of a
           * quarter of the card is enormous. The cap keeps a bar a bar and lets the leftover band
           * be air, which is most of what separates a considered chart from a loud one.
           */
          columnWidth: '55%',
          maxBarHeight: 24,
          ...(spec.horizontal === true ? {} : { maxColumnWidth: 24 }),
        },
        pie: {
          donut: {
            size: '72%',
            labels: {
              show: true,
              // The centre total is the whole point of a donut here: the slices answer
              // "where", the middle answers "how much altogether".
              total: {
                show: true,
                label: 'Total',
                color: muted,
                fontSize: '12px',
                formatter: (w: { globals: { seriesTotals: number[] } }) =>
                  formatValue(w.globals.seriesTotals.reduce((sum, value) => sum + value, 0)),
              },
              value: { color: onSurface, fontSize: '22px', formatter: formatValue },
              name: { color: muted, fontSize: '12px' },
            },
          },
        },
      },
      grid: {
        borderColor: grid,
        /*
         * Solid hairlines, not dashes.
         *
         * A dashed grid reads as "projected" or "threshold" — it is borrowing a meaning it does not
         * have — and at this density it is simply noise behind the data.
         */
        strokeDashArray: 0,
        /*
         * Generous, and the most visible half of "more whitespace".
         *
         * Apex packs the plot to its container's edges, so a chart in a card reads as a picture
         * pressed against a frame. The extra room above lets the topmost gridline breathe under the
         * card's subtitle, and the room on the right stops the last data point colliding with the
         * card's border — which on a 30-day series is where the eye lands first.
         */
        padding: { left: 12, right: 20, top: 16, bottom: 0 },
        xaxis: { lines: { show: false } },
      },
      // Visible only on hover: a dot on every point of a 30-day line is noise, but the point under
      // the cursor should confirm itself. The surface ring keeps it legible over the line it sits on.
      markers: {
        size: 0,
        strokeWidth: 2,
        strokeColors: surface,
        hover: { size: 5 },
      },
      xaxis: isDonut
        ? undefined
        : {
            categories: [...(spec.labels ?? [])],
            labels: {
              style: { colors: muted, fontSize: '11px' },
              rotate: 0,
              hideOverlappingLabels: true,
              // The other half of the horizontal swap above: on a horizontal bar this axis is the
              // value axis, so this is where the ₹ belongs.
              ...(spec.horizontal === true ? { formatter: formatValue } : {}),
              /*
               * Thin the ticks once there are more categories than fit.
               *
               * `hideOverlappingLabels` alone does not save a 30-day axis: Apex measures
               * each label independently, so two that merely touch both survive and the
               * axis reads "1 Jul2 Jul". Capping the tick count makes it drop whole
               * labels instead, which is legible — the bars still carry the detail, and
               * the tooltip names the exact one under the cursor.
               */
              ...(labelCount > MAX_AXIS_TICKS ? { tickAmount: MAX_AXIS_TICKS } : {}),
            },
            ...(labelCount > MAX_AXIS_TICKS ? { tickAmount: MAX_AXIS_TICKS } : {}),
            /*
             * On a horizontal bar this is the *value* axis, and it needs far fewer ticks than a date
             * axis does.
             *
             * Apex's default put six on it, each carrying a `₹` prefix, in a card about 330px wide —
             * so the ranked valuation chart read "₹0 ₹2,000₹4,000₹6,000₹8,000₹10,000" with the labels
             * touching. Four is what fits at that width with the currency symbol attached, and the
             * bars carry the detail anyway.
             */
            ...(spec.horizontal === true ? { tickAmount: 4 } : {}),
            // The gridlines already carry the plot's edges; a second darker rule under them is
            // chrome competing with data.
            axisBorder: { show: false },
            axisTicks: { show: false },
          },
      /*
       * On a horizontal bar the axes swap: the y-axis carries the *categories* and the x-axis carries
       * the values. The value formatter therefore has to swap with them.
       *
       * It did not, which is why the ranked charts read "₹Chocolate", "₹Dairy" and "Dark Chocolate×" —
       * `formatValue` was being applied to category names, prefixing a rupee sign to a word and
       * suffixing a multiplication sign to an ingredient. The top-ingredients chart has been horizontal
       * since it was written, so it has been labelling itself "Wooden Spoon×" all along.
       */
      yaxis: isDonut
        ? undefined
        : {
            labels: {
              style: { colors: muted, fontSize: '11px' },
              ...(spec.horizontal === true ? {} : { formatter: formatValue }),
            },
          },
      legend: {
        show: showLegend,
        position: isDonut ? 'bottom' : 'top',
        horizontalAlign: 'left',
        labels: { colors: muted },
        /*
         * Roomier than Apex's default, because these entries are tappable — clicking one hides
         * its series — and on a phone they sat about 15px tall with 4px between them.
         *
         * The margin separates neighbours; the height that a finger has to hit comes from the
         * min-height on `.apexcharts-legend-series` in styles.scss. Both are needed: spacing
         * alone leaves the target small, and height alone leaves two targets touching.
         */
        fontSize: '12px',
        fontWeight: 500,
        itemMargin: { horizontal: 12, vertical: 6 },
        /*
         * A small circle, not a square.
         *
         * The marks these key are lines and rounded-end bars; a hard-cornered swatch is the one
         * shape on the chart with a corner in it, and at 8px that reads as a different kind of
         * object from the thing it labels. The circle also matches the hover marker on the line
         * itself, so the legend and the plot agree about what a series *looks* like.
         */
        markers: { size: 6, shape: 'circle', strokeWidth: 0, offsetY: -1 },
        // Clear of the plot rather than tucked against it — a legend touching the topmost gridline
        // reads as part of the chart's chrome instead of as its key.
        offsetY: isDonut ? 8 : 0,
      },
      tooltip: {
        enabled: !isSparkline,
        theme: dark ? 'dark' : 'light',
        y: { formatter: formatValue },
      },
      noData: {
        text: 'Nothing to show yet',
        style: { color: muted, fontSize: '13px' },
      },
      // A donut squeezed into a phone column loses its legend; below 480 it gets the full
      // width and the legend moves under it.
      responsive: [
        {
          breakpoint: 480,
          options: { chart: { height: 240 }, legend: { position: 'bottom' } },
        },
      ],
    };
  });

  /**
   * The mark colours for this chart, in slot order.
   *
   * Slots are assigned by position and never cycled: two marks the reader cannot tell apart is a
   * chart that cannot be read, and a generated sixth hue is indistinguishable from an existing slot
   * under colour-vision deficiency. Past the defined slots this warns and steps lightness so nothing
   * renders invisible, but that is a symptom to fix at the call site — by folding the tail of the
   * data together, or by picking a form that does not need six colours — not a supported mode.
   */
  private paletteFor(kind: 'brand' | 'categorical', count: number): string[] {
    if (kind === 'brand') {
      return [resolveColour('--color-pb-chart-brand', '#ba005c')];
    }

    const slots = Array.from({ length: CATEGORICAL_SLOTS }, (_, index) =>
      resolveColour(`--color-pb-chart-${String(index + 1)}`, '#2a78d6'),
    );

    if (count <= CATEGORICAL_SLOTS) {
      return slots.slice(0, Math.max(count, 1));
    }

    // `console.error` because the lint rule allows no other level, which is the right call here
    // anyway: this is a chart the reader cannot fully decode, not a style preference.
    if (isDevMode()) {
      console.error(
        `pb-chart: ${String(count)} marks need colours but only ${String(CATEGORICAL_SLOTS)} ` +
          `categorical slots are defined. Fold the tail of this data together or change the ` +
          `chart's form — beyond the defined slots, colours are no longer guaranteed to be ` +
          `distinguishable.`,
      );
    }

    return Array.from({ length: count }, (_, index) => {
      const base = slots[index % CATEGORICAL_SLOTS] ?? '#2a78d6';
      const cycle = Math.floor(index / CATEGORICAL_SLOTS);
      return cycle === 0 ? base : shade(base, cycle % 2 === 1 ? 0.34 * cycle : -0.28 * cycle);
    });
  }

  constructor() {
    effect((onCleanup) => {
      const options = this.options();
      const element = this.host().nativeElement;

      /*
       * Rebuilt rather than updated.
       *
       * `updateOptions` leaves the label and grid colours Apex resolved at construction, so
       * switching to dark mode would keep near-black axis text on a dark card. Destroying
       * and recreating is the only reliable way to re-theme, and these charts are small
       * enough that the redraw is imperceptible.
       */
      this.chart?.destroy();

      const chart = new ApexCharts(element, options);
      this.chart = chart;
      void chart.render();

      onCleanup(() => {
        chart.destroy();

        if (this.chart === chart) {
          this.chart = null;
        }
      });
    });
  }
}
