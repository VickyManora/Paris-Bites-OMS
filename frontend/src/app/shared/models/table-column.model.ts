import type { BadgeTone } from '../components/status-badge/status-badge.component';

/**
 * Declarative column definition for `pb-data-table`.
 *
 * Describing columns as data rather than markup is what lets one table component
 * serve products, suppliers and stock movements, instead of three near-identical
 * templates that drift apart. It is also what makes the responsive card layout
 * possible: the same definitions are re-rendered as label/value pairs on mobile.
 */
export interface TableColumn<T> {
  /** Matches the `matColumnDef` name; must be unique within the table. */
  readonly key: string;
  readonly header: string;
  /** Extracts the display value. Keeps the table generic over `T`. */
  readonly value: (row: T) => string | number | null | undefined;
  readonly sortable?: boolean;
  readonly align?: 'left' | 'right' | 'center';
  /** Any valid CSS width, e.g. `'120px'` or `'20%'`. */
  readonly width?: string;
  /** Dropped from the table below `sm`; still shown in the mobile card layout. */
  readonly hideOnMobile?: boolean;
  /**
   * Used as the card title in the mobile layout. Exactly one column should set
   * this; the first column is used if none do.
   */
  readonly primary?: boolean;
  /** Renders in a monospace, tabular-figures style — for quantities and money. */
  readonly numeric?: boolean;

  /**
   * Renders the value as a status pill rather than as plain text.
   *
   * Status was the one thing every list in the app rendered as a bare word — "Out of stock",
   * "Awaiting approval", "Paid" — sitting in the same ink and weight as the product name beside it.
   * A state is not a fact about the row in the way a quantity is; it is the thing someone scans the
   * column *for*, and a pill is what makes it findable without reading.
   *
   * `tone` is a function of the row rather than of the string, because the same word means different
   * things in different tables and no mapping from text to severity would be right in all of them.
   * Returning `'neutral'` is always safe.
   *
   * Colour is never the only signal: the pill still carries the word, so it survives being read by
   * someone who cannot separate the hues.
   *
   * **Return `null` to render that row's value as plain text instead of a pill.** This is how a
   * column says "only the exceptions are worth marking": consumption is `Recorded` on almost every
   * row, and a column of identical grey pills is louder than the same column in plain type while
   * carrying less information — the two rows that are `Voided` or `Edited` stop standing out. A pill
   * earns its ink by being uncommon.
   */
  readonly tone?: (row: T) => BadgeTone | null;

  /**
   * Whether this column's width may be dragged. **Not yet implemented** — see below.
   *
   * The table renders a `<colgroup>` and drives every width from it, which is the structural
   * prerequisite for resizing: with widths on individual `<th>` elements there is no single place a
   * drag handle can write to, and Material's own header cells are recreated on sort. Declaring the
   * intent here now means the flag, the minimum and the column-width plumbing all exist before the
   * interaction does, so adding the handle later is one component change rather than a refactor of
   * every column definition in the app.
   *
   * A column with no explicit `width` is sized by content and cannot be resized meaningfully, so
   * this is only honoured alongside one.
   */
  readonly resizable?: boolean;

  /**
   * Floor for a resizable column, any valid CSS length. Prevents a drag collapsing a header to
   * nothing. Ignored until resizing ships.
   */
  readonly minWidth?: string;

  /**
   * Value for CSV export, when the displayed value is not the exportable one.
   *
   * `value` is free to return something formatted for a cell — "12 kg", "₹1,240", an em dash for
   * absent data. A spreadsheet wants the number. Omit this and the export uses `value`, which is
   * right for most columns; supply it where the two genuinely differ.
   */
  readonly csv?: (row: T) => string | number | null | undefined;

  /** Drops the column from CSV export. For an action or icon column that carries no data. */
  readonly noExport?: boolean;
}

export interface TableSort {
  readonly active: string;
  readonly direction: 'asc' | 'desc' | '';
}
