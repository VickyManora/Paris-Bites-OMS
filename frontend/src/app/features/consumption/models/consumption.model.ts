import type { InventoryLocation, InventoryUnit } from '../../inventory/models/inventory.model';

/** Mirrors the consumption DTOs from the API. */

export const ConsumptionRevisionAction = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  VOIDED: 'VOIDED',
} as const;

export type ConsumptionRevisionAction =
  (typeof ConsumptionRevisionAction)[keyof typeof ConsumptionRevisionAction];

export interface ConsumptionLine {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: InventoryUnit;
  readonly unitAbbreviation: string;
  readonly quantity: number;
  readonly displayQuantity: string;
  readonly notes: string | null;
}

export interface ConsumptionRevision {
  readonly id: string;
  readonly revision: number;
  readonly action: ConsumptionRevisionAction;
  readonly actionLabel: string;
  readonly snapshot: ConsumptionSnapshot;
  readonly note: string | null;
  readonly actorName: string | null;
  readonly createdAt: string;
}

/**
 * The frozen JSON a revision carries.
 *
 * Every field is optional because the shape differs by action — a void records what was
 * returned, an edit records what changed — and this is stored data that older rows may
 * predate a change to.
 */
export interface ConsumptionSnapshot {
  readonly lines?: readonly {
    readonly itemId: string;
    readonly itemName: string;
    readonly quantity: number;
    readonly unit: string;
  }[];
  readonly changedItems?: readonly {
    readonly itemId: string;
    readonly itemName: string;
    readonly consumedBefore: number;
    readonly consumedAfter: number;
  }[];
  readonly returnedItems?: readonly {
    readonly itemId: string;
    readonly itemName: string;
    readonly quantity: number;
    readonly unit: string;
  }[];
}

export interface ConsumptionEntry {
  readonly id: string;
  /** `YYYY-MM-DD`. A calendar day — never parse it as local time. */
  readonly entryDate: string;
  readonly location: InventoryLocation;
  readonly locationLabel: string;
  readonly notes: string | null;

  readonly revision: number;
  readonly isEdited: boolean;
  readonly isVoided: boolean;
  readonly voidedByName: string | null;
  readonly voidReason: string | null;

  readonly lineCount: number;
  readonly lines: readonly ConsumptionLine[];
  readonly summary: string;

  /** Newest first. Populated on a single-entry read; empty in a list. */
  readonly revisions: readonly ConsumptionRevision[];

  readonly recordedByName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConsumptionSummary {
  readonly entryCount: number;
  readonly lineCount: number;
  readonly itemCount: number;
  readonly voidedCount: number;
}

export interface ConsumptionStockEffect {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: InventoryUnit;
  readonly quantityBefore: number;
  readonly quantityAfter: number;
}

export interface ConsumptionResult {
  readonly entry: ConsumptionEntry;
  readonly effects: readonly ConsumptionStockEffect[];
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface ConsumptionLineRequest {
  readonly itemId: string;
  /** In the item's own unit — converted from the entry unit before sending. */
  readonly quantity: number;
  readonly notes?: string;
}

export interface RecordConsumptionRequest {
  readonly entryDate: string;
  readonly location: InventoryLocation;
  readonly notes?: string;
  readonly lines: readonly ConsumptionLineRequest[];
}

/** The complete sheet, not a patch — the server diffs it against what is stored. */
export interface UpdateConsumptionRequest extends RecordConsumptionRequest {
  /** Why the correction was made. Recorded on the revision. */
  readonly note?: string;
}

export interface VoidConsumptionRequest {
  readonly reason: string;
}

export const CONSUMPTION_SORT_FIELDS = ['entryDate', 'createdAt'] as const;

export type ConsumptionSortField = (typeof CONSUMPTION_SORT_FIELDS)[number];

export interface ConsumptionQuery {
  readonly search?: string;
  readonly location?: InventoryLocation;
  readonly itemId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly includeVoided?: boolean;
  readonly page: number;
  readonly pageSize: number;
  readonly sortField: ConsumptionSortField;
  readonly sortDirection: 'asc' | 'desc';
}

// ---------------------------------------------------------------------------
// Entry units
// ---------------------------------------------------------------------------

/**
 * A unit the user may type a consumption in, and what it is worth in the item's own unit.
 *
 * Kitchens consume in grams and millilitres what the store room stocks in kilograms and
 * litres — "Nutella, 500 g" is how the sheet is actually written, and making someone
 * convert that to 0.5 kg in their head is where a decimal point goes missing.
 *
 * These are **exact scalar conversions within one dimension**. The inventory model
 * deliberately does not convert between mass and volume, because that needs a density per
 * item; g→kg needs nothing but arithmetic, so it is safe in a way kg→L would not be.
 *
 * The conversion happens on the way out. What is stored and displayed afterwards is always
 * the item's own unit, so the record has one canonical figure rather than two.
 */
export interface EntryUnitOption {
  readonly value: string;
  readonly label: string;
  /** Multiply the typed number by this to get the item's unit. */
  readonly factor: number;
  /** Whole numbers only — matches the discrete-unit rule on the item. */
  readonly wholeOnly: boolean;
}

const SUB_UNITS: Readonly<Record<string, EntryUnitOption>> = {
  KG: { value: 'g', label: 'g', factor: 0.001, wholeOnly: false },
  LITERS: { value: 'ml', label: 'ml', factor: 0.001, wholeOnly: false },
};

/**
 * The units this item may be entered in: its own, plus a finer sibling where one exists.
 *
 * Discrete units (packets, pieces) have no sibling — half a packet is not a measurement —
 * so they get a single option and the input steps by 1.
 */
export function entryUnitsFor(
  unit: InventoryUnit,
  unitAbbreviation: string,
  isDiscrete: boolean,
): readonly EntryUnitOption[] {
  const base: EntryUnitOption = {
    value: unit,
    label: unitAbbreviation,
    factor: 1,
    wholeOnly: isDiscrete,
  };

  const sub = SUB_UNITS[unit];

  return sub === undefined ? [base] : [base, sub];
}

/**
 * Converts a typed amount into the item's own unit.
 *
 * Rounded to three places, matching `Decimal(12,3)` on the column — so 1 g of a
 * kilogram-tracked item lands on 0.001 rather than on a float that the server would round
 * differently.
 */
export function toItemUnit(quantity: number, option: EntryUnitOption): number {
  if (!Number.isFinite(quantity)) {
    return 0;
  }

  return Math.round(quantity * option.factor * 1000) / 1000;
}
