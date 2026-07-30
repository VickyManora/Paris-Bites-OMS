import { BusinessRuleError } from '../../../domain/errors/domain-error.js';
import type { IAuditLogRepository } from '../../../domain/repositories/audit-log.repository.js';
import type { IStockTransferRepository } from '../../../domain/repositories/stock-transfer.repository.js';
import type { RejectTransferInput, StockTransferDto } from '../../dtos/stock-transfer.dto.js';
import { StockTransferMapper } from '../../mappers/stock-transfer.mapper.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';
import { TransferAuditAction } from './transfer-audit.js';
import type { TransferNotifier } from './transfer-notifier.js';

/**
 * Rejects a pending transfer. **No stock moves** — nothing has left the warehouse yet.
 *
 * A reason is mandatory, in the validator, here, and as a database CHECK. A refusal the
 * requester cannot act on just produces a second identical request.
 */
export class RejectStockTransferUseCase implements IUseCase<RejectTransferInput, StockTransferDto> {
  constructor(
    private readonly transfers: IStockTransferRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly notifier: TransferNotifier,
    private readonly logger: ILogger,
  ) {}

  async execute(input: RejectTransferInput): Promise<StockTransferDto> {
    const reason = input.reason.trim();

    if (reason.length === 0) {
      throw new BusinessRuleError('A rejection needs a reason.', {
        reason: ['Explain why this transfer is being rejected.'],
      });
    }

    // No pre-read — the repository applies the state guard against the locked row.
    const transfer = await this.transfers.reject(input.id, input.actorId, reason);

    await this.auditLog.record({
      actorId: input.actorId,
      action: TransferAuditAction.REJECTED,
      entityType: 'StockTransfer',
      entityId: transfer.id,
      ip: input.ipAddress,
      metadata: { reference: transfer.reference, reason },
    });

    // Carries the reason: this is the one notification the recipient must act on.
    await this.notifier.transferRejected(transfer, input.actorId, reason);

    this.logger.info('Stock transfer rejected', {
      transferId: transfer.id,
      reference: transfer.reference,
      actorId: input.actorId,
    });

    return StockTransferMapper.toDto(transfer);
  }
}
