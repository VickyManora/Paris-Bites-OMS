import type { ConsumptionRevisionAction } from '../../domain/enums/consumption.enum.js';
import type { InventoryLocation, InventoryUnit } from '../../domain/enums/inventory.enum.js';
import type {
  ConsumptionFilter,
  ConsumptionSort,
  ConsumptionStockEffect,
} from '../../domain/repositories/consumption.repository.js';
import type { RequestContext } from './auth.dto.js';

export interface ConsumptionLineDto {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: InventoryUnit;
  readonly unitAbbreviation: string;
  readonly quantity: number;
  /** `1.2 kg` — a bare number invites reading kilograms as litres. */
  readonly displayQuantity: string;
  readonly notes: string | null;
}

export interface ConsumptionRevisionDto {
  readonly id: string;
  readonly revision: number;
  readonly action: ConsumptionRevisionAction;
  readonly actionLabel: string;
  /** Frozen JSON: the lines as of this revision, plus a per-item diff for an edit. */
  readonly snapshot: unknown;
  readonly note: string | null;
  readonly actorName: string | null;
  readonly createdAt: string;
}

export interface ConsumptionEntryDto {
  readonly id: string;
  /** `YYYY-MM-DD`. A calendar day, not an instant. */
  readonly entryDate: string;
  readonly location: InventoryLocation;
  readonly locationLabel: string;
  readonly notes: string | null;

  readonly revision: number;
  /** True once corrected at least once — worth flagging in a list. */
  readonly isEdited: boolean;
  readonly isVoided: boolean;
  readonly voidedByName: string | null;
  readonly voidReason: string | null;

  readonly lineCount: number;
  readonly lines: readonly ConsumptionLineDto[];
  /** Names of the first few items, for a list row. */
  readonly summary: string;

  /** Newest first. Present on a single-entry read; empty in a list. */
  readonly revisions: readonly ConsumptionRevisionDto[];

  readonly recordedByName: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConsumptionSummaryDto {
  readonly entryCount: number;
  readonly lineCount: number;
  readonly itemCount: number;
  readonly voidedCount: number;
}

/**
 * The entry plus what it did to stock.
 *
 * Returned from every mutation so the client can report "Dark Chocolate 5 → 3.8 kg"
 * without a request per line — the same shape purchases and transfers return.
 */
export interface ConsumptionResultDto {
  readonly entry: ConsumptionEntryDto;
  readonly effects: readonly ConsumptionStockEffect[];
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ConsumptionLineInput {
  readonly itemId: string;
  /** In the item's own unit. The UI converts grams to kilograms before sending. */
  readonly quantity: number;
  readonly notes?: string | undefined;
}

export interface RecordConsumptionInput extends RequestContext {
  readonly actorId: string;
  readonly entryDate: Date;
  readonly location: InventoryLocation;
  readonly notes?: string | undefined;
  readonly lines: readonly ConsumptionLineInput[];
}

/**
 * The complete desired state, not a patch — see `UpdateConsumptionData` for why.
 */
export interface UpdateConsumptionInput extends RequestContext {
  readonly actorId: string;
  readonly id: string;
  readonly entryDate: Date;
  readonly location: InventoryLocation;
  readonly notes?: string | undefined;
  readonly lines: readonly ConsumptionLineInput[];
  /** Why the correction was made, recorded on the revision. */
  readonly note?: string | undefined;
}

export interface VoidConsumptionInput extends RequestContext {
  readonly actorId: string;
  readonly id: string;
  /** Required: a reversal without a reason is not auditable. */
  readonly reason: string;
}

export interface GetConsumptionInput {
  readonly id: string;
}

export interface ListConsumptionInput {
  readonly filter: ConsumptionFilter;
  readonly page: number;
  readonly pageSize: number;
  readonly sort: ConsumptionSort;
}
