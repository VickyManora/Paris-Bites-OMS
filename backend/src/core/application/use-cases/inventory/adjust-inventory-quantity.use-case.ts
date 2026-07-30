import {
  InventoryHistoryAction,
  type InventoryUnit,
} from '../../../domain/enums/inventory.enum.js';
import { BusinessRuleError } from '../../../domain/errors/domain-error.js';
import type { IInventoryItemRepository } from '../../../domain/repositories/inventory-item.repository.js';
import { InventoryQuantity } from '../../../domain/value-objects/inventory-quantity.js';
import type { AdjustInventoryQuantityInput, InventoryItemDto } from '../../dtos/inventory.dto.js';
import { InventoryMapper } from '../../mappers/inventory.mapper.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';

/**
 * Changes an item's stock level.
 *
 * Two modes, deliberately distinct:
 *
 * - **`delta`** — "10 kg arrived", "2 boxes used". The everyday case. Applied
 *   relative to whatever the current quantity is, so it is safe under concurrency.
 * - **`quantity`** — "the shelf actually holds 8 kg". A stocktake correction, which
 *   is inherently an absolute statement and last-write-wins by nature.
 *
 * Supplying both is rejected rather than resolved by precedence: the caller's intent
 * would be a guess, and guessing wrong silently changes stock.
 */
export class AdjustInventoryQuantityUseCase implements IUseCase<
  AdjustInventoryQuantityInput,
  InventoryItemDto
> {
  /**
   * No history repository dependency: the history entry is written by
   * `items.adjustQuantity` inside the same transaction as the quantity change, which is
   * the only way the two can be guaranteed to commit together.
   */
  constructor(
    private readonly items: IInventoryItemRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: AdjustInventoryQuantityInput): Promise<InventoryItemDto> {
    // Destructured so TypeScript can narrow them; checking `input.delta !== undefined`
    // does not narrow the property on later reads.
    const { delta, quantity } = input;

    if (delta !== undefined && quantity !== undefined) {
      throw new BusinessRuleError(
        'Provide either an adjustment or an absolute quantity, not both.',
        { delta: ['Choose one: adjust by an amount, or set an exact quantity.'] },
      );
    }

    if (delta === undefined && quantity === undefined) {
      throw new BusinessRuleError('Nothing to adjust.', {
        delta: ['Enter an adjustment or an exact quantity.'],
      });
    }

    /*
     * There is deliberately no read before the write.
     *
     * The repository's lock query returns both the quantity and the unit, so the
     * arithmetic runs against the values read under the lock. A pre-read would be stale
     * by definition, cost an extra round trip, and hold a second connection — which is
     * what made this endpoint fail under concurrent load.
     *
     * A delta is relative to the locked quantity; an absolute quantity ignores it, which
     * is exactly what a stocktake means.
     */
    const apply = (current: number, unit: InventoryUnit): number => {
      if (delta !== undefined) {
        return InventoryQuantity.applyDelta(current, delta, unit);
      }
      if (quantity !== undefined) {
        return InventoryQuantity.normalise(quantity, unit, 'quantity');
      }
      // Unreachable — the guards above reject "neither". An explicit branch rather than
      // a non-null assertion, so the compiler proves the function always returns.
      throw new BusinessRuleError('Nothing to adjust.', {
        delta: ['Enter an adjustment or an exact quantity.'],
      });
    };

    const { item, previousQuantity } = await this.items.adjustQuantity(
      input.id,
      apply,
      // Returning null skips the entry: a stocktake confirming the existing figure is
      // not a change worth recording.
      (before, next) =>
        before === next
          ? null
          : {
              action: InventoryHistoryAction.QUANTITY_ADJUSTED,
              note: input.note?.trim() ?? undefined,
              actorId: input.actorId,
            },
    );

    if (item.currentQuantity === previousQuantity) {
      return InventoryMapper.toDto(item);
    }

    // Logged at info because crossing the reorder threshold is operationally
    // interesting, and this is the only place it can be observed as an event.
    this.logger.info('Inventory quantity adjusted', {
      itemId: item.id,
      from: previousQuantity,
      to: item.currentQuantity,
      stockStatus: item.stockStatus,
      actorId: input.actorId,
    });

    return InventoryMapper.toDto(item);
  }
}
