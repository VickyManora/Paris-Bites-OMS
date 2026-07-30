import type { IAuditLogRepository } from '../../../domain/repositories/audit-log.repository.js';
import type { IStockTransferRepository } from '../../../domain/repositories/stock-transfer.repository.js';
import type { CompleteTransferInput, TransferResultDto } from '../../dtos/stock-transfer.dto.js';
import { StockTransferMapper } from '../../mappers/stock-transfer.mapper.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';
import { TransferAuditAction } from './transfer-audit.js';
import type { TransferNotifier } from './transfer-notifier.js';

/**
 * Marks a dispatched transfer as received: the **destination location is credited** and the
 * transfer becomes `COMPLETED`.
 *
 * Only reachable from `APPROVED`, so the goods have already left the source — this leg puts
 * them back on the books at the destination. There is deliberately no availability check
 * and no way to refuse: the stock physically exists, and declining to record it would make
 * it disappear from the system entirely.
 *
 * The credit, the status change and the per-item history are one database transaction in the
 * repository, which also creates the destination item when the cart has never stocked it.
 */
export class CompleteStockTransferUseCase implements IUseCase<
  CompleteTransferInput,
  TransferResultDto
> {
  constructor(
    private readonly transfers: IStockTransferRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly notifier: TransferNotifier,
    private readonly logger: ILogger,
  ) {}

  async execute(input: CompleteTransferInput): Promise<TransferResultDto> {
    /*
     * No pre-read: the repository loads the transfer with its row locked and applies the
     * guard inside the transaction, which is what actually prevents a double completion
     * crediting the cart twice. A pre-read would be stale and would hold a second
     * connection for the duration.
     */
    const { transfer, effects } = await this.transfers.complete(input.id, input.actorId);

    await this.auditLog.record({
      actorId: input.actorId,
      action: TransferAuditAction.COMPLETED,
      entityType: 'StockTransfer',
      entityId: transfer.id,
      ip: input.ipAddress,
      metadata: {
        reference: transfer.reference,
        effects: effects.map((effect) => ({
          item: effect.itemName,
          from: effect.quantityBefore,
          to: effect.quantityAfter,
        })),
      },
    });

    // Skipped when the requester received the stock themselves — see `fanOut`.
    await this.notifier.transferCompleted(transfer, input.actorId);

    this.logger.info('Stock transfer completed', {
      transferId: transfer.id,
      reference: transfer.reference,
      itemsAffected: effects.length,
      actorId: input.actorId,
    });

    return { transfer: StockTransferMapper.toDto(transfer), effects };
  }
}
