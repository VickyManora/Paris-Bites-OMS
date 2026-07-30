import { BusinessRuleError } from '../../../domain/errors/domain-error.js';
import type { IAuditLogRepository } from '../../../domain/repositories/audit-log.repository.js';
import type { IStockTransferRepository } from '../../../domain/repositories/stock-transfer.repository.js';
import type { ApproveTransferInput, TransferResultDto } from '../../dtos/stock-transfer.dto.js';
import { StockTransferMapper } from '../../mappers/stock-transfer.mapper.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';
import { TransferAuditAction } from './transfer-audit.js';
import type { TransferNotifier } from './transfer-notifier.js';

/**
 * Approves and dispatches a transfer: the **source location is deducted** and the transfer
 * becomes `APPROVED` (in transit).
 *
 * The stock movement, the status change and the per-item history all happen in one database
 * transaction inside the repository. This use case owns authorisation of the *decision*:
 * checking the state, recording the audit entry, and reporting the outcome.
 *
 * A failed approval is audited too. "Someone tried to move stock that was not there" is
 * exactly the kind of event an audit trail exists to surface, and it is invisible if only
 * successes are recorded.
 */
export class ApproveStockTransferUseCase implements IUseCase<
  ApproveTransferInput,
  TransferResultDto
> {
  constructor(
    private readonly transfers: IStockTransferRepository,
    private readonly auditLog: IAuditLogRepository,
    private readonly notifier: TransferNotifier,
    private readonly logger: ILogger,
  ) {}

  async execute(input: ApproveTransferInput): Promise<TransferResultDto> {
    /*
     * There is deliberately no read before the write.
     *
     * The repository loads the transfer inside its transaction with the row locked and
     * applies the state-machine guard there, which is the only check that actually holds:
     * a pre-read is stale by definition, so two approvers would both pass it. It also cost
     * a second pooled connection while the first request held one for its transaction —
     * under concurrency that starved the pool and surfaced as a 500 instead of a clean
     * "already approved".
     *
     * A missing transfer and an illegal state both come back as the proper domain error
     * from inside the transaction.
     */
    try {
      const { transfer, effects } = await this.transfers.approve(
        input.id,
        input.actorId,
        input.note?.trim(),
      );

      await this.auditLog.record({
        actorId: input.actorId,
        action: TransferAuditAction.APPROVED,
        entityType: 'StockTransfer',
        entityId: transfer.id,
        ip: input.ipAddress,
        metadata: {
          reference: transfer.reference,
          // The before/after per item, so the audit entry alone explains what moved.
          effects: effects.map((effect) => ({
            item: effect.itemName,
            from: effect.quantityBefore,
            to: effect.quantityAfter,
          })),
          ...(input.note !== undefined && { note: input.note.trim() }),
        },
      });

      // Only on the success path. A refused approval is the approver's own problem to
      // read on screen — the requester has no action to take and does not need telling.
      await this.notifier.transferApproved(transfer, input.actorId);

      this.logger.info('Stock transfer approved and dispatched', {
        transferId: transfer.id,
        reference: transfer.reference,
        itemsAffected: effects.length,
        actorId: input.actorId,
      });

      return { transfer: StockTransferMapper.toDto(transfer), effects };
    } catch (error) {
      // Business refusals are audited — someone tried to move stock they could not. An
      // infrastructure failure is not an attempt worth recording against the actor.
      if (error instanceof BusinessRuleError) {
        // The reference is looked up only on this rare path, so the happy path stays at one
        // round trip. The audit entry is worth the extra read: "someone tried to move stock
        // that was not there" is exactly what an audit trail exists to surface.
        const reference = (await this.transfers.findById(input.id))?.reference ?? null;

        await this.auditLog.record({
          actorId: input.actorId,
          action: TransferAuditAction.APPROVAL_REFUSED,
          entityType: 'StockTransfer',
          entityId: input.id,
          ip: input.ipAddress,
          metadata: { reference, reason: error.message },
        });

        this.logger.warn('Stock transfer approval refused', {
          transferId: input.id,
          reference,
          reason: error.message,
          actorId: input.actorId,
        });
      }

      throw error;
    }
  }
}
