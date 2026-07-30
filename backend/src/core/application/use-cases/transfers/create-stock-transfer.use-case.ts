import { InventoryLocation } from '../../../domain/enums/inventory.enum.js';
import { BusinessRuleError, NotFoundError } from '../../../domain/errors/domain-error.js';
import type { IAuditLogRepository } from '../../../domain/repositories/audit-log.repository.js';
import type { IInventoryItemRepository } from '../../../domain/repositories/inventory-item.repository.js';
import type { IStockTransferRepository } from '../../../domain/repositories/stock-transfer.repository.js';
import { InventoryQuantity } from '../../../domain/value-objects/inventory-quantity.js';
import type { CreateStockTransferInput, StockTransferDto } from '../../dtos/stock-transfer.dto.js';
import { StockTransferMapper } from '../../mappers/stock-transfer.mapper.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';
import { TransferAuditAction } from './transfer-audit.js';
import type { TransferNotifier } from './transfer-notifier.js';

/**
 * Raises a transfer request. Status `PENDING`; **no stock moves**.
 *
 * Direction is fixed at Home Warehouse → Cart. It is not a request parameter because only
 * that direction is supported, and accepting one would imply the reverse works. The schema
 * stores both endpoints, so adding the return leg later needs no migration.
 *
 * Availability is deliberately **not** enforced here. A request for more than is currently
 * on the shelf is legitimate — stock may arrive before approval — and checking now would
 * only give a false guarantee, because the number is stale the moment it is read. Approval
 * checks it against locked rows.
 */
export class CreateStockTransferUseCase implements IUseCase<
  CreateStockTransferInput,
  StockTransferDto
> {
  private static readonly FROM = InventoryLocation.HOME_WAREHOUSE;
  private static readonly TO = InventoryLocation.CART;

  constructor(
    private readonly transfers: IStockTransferRepository,
    private readonly items: IInventoryItemRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly notifier: TransferNotifier,
    private readonly logger: ILogger,
  ) {}

  async execute(input: CreateStockTransferInput): Promise<StockTransferDto> {
    if (input.lines.length === 0) {
      throw new BusinessRuleError('A transfer needs at least one item.', {
        lines: ['Add at least one item.'],
      });
    }

    // The same item twice would be a mistake, not two lines to sum — and the unique
    // constraint would reject it anyway, with a far worse message.
    const ids = input.lines.map((line) => line.itemId);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

    if (duplicates.length > 0) {
      throw new BusinessRuleError('Each item can appear only once in a transfer.', {
        lines: ['An item is listed more than once. Combine the quantities instead.'],
      });
    }

    /*
     * Each quantity is validated against its own item's unit, which is why the items are
     * read here: "2.5 boxes" has to be rejected with the field named, and the validator at
     * the HTTP boundary cannot know the unit.
     */
    const validated = await Promise.all(
      input.lines.map(async (line) => {
        const item = await this.items.findById(line.itemId);

        if (item === null || item.isDeleted) {
          throw new NotFoundError('Inventory item', line.itemId);
        }

        if (item.location !== CreateStockTransferUseCase.FROM) {
          throw new BusinessRuleError(
            `"${item.name}" is not held at ${CreateStockTransferUseCase.FROM === 'HOME_WAREHOUSE' ? 'the Home Warehouse' : 'the source location'}.`,
            { lines: [`${item.name} is not at the source location.`] },
          );
        }

        if (!item.isActive) {
          throw new BusinessRuleError(`"${item.name}" is inactive and cannot be transferred.`, {
            lines: [`${item.name} is inactive.`],
          });
        }

        return {
          itemId: line.itemId,
          quantity: InventoryQuantity.normalise(line.quantity, item.unit, 'quantity'),
        };
      }),
    );

    const transfer = await this.transfers.create({
      fromLocation: CreateStockTransferUseCase.FROM,
      toLocation: CreateStockTransferUseCase.TO,
      requestedById: input.actorId,
      notes: input.notes?.trim(),
      lines: validated,
    });

    await this.auditLog.record({
      actorId: input.actorId,
      action: TransferAuditAction.CREATED,
      entityType: 'StockTransfer',
      entityId: transfer.id,
      ip: input.ipAddress,
      metadata: {
        reference: transfer.reference,
        lineCount: transfer.lineCount,
        lines: transfer.lines.map((line) => ({ item: line.itemName, quantity: line.quantity })),
      },
    });

    // After the audit entry, and never in front of the return: notifying is a courtesy
    // to the approvers, and the request is already durably recorded either way.
    await this.notifier.transferRequested(transfer, input.actorId);

    this.logger.info('Stock transfer requested', {
      transferId: transfer.id,
      reference: transfer.reference,
      lineCount: transfer.lineCount,
      actorId: input.actorId,
    });

    return StockTransferMapper.toDto(transfer);
  }
}
