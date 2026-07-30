import type { PrismaClient, Prisma } from '../../../generated/prisma/client.js';
import type {
  CreateAuditLogData,
  IAuditLogRepository,
} from '../../../core/domain/repositories/audit-log.repository.js';
import type { ILogger } from '../../../core/application/ports/logger.port.js';

export class AuditLogPrismaRepository implements IAuditLogRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly logger: ILogger,
  ) {}

  async record(data: CreateAuditLogData): Promise<void> {
    try {
      await this.client.auditLog.create({
        data: {
          actorId: data.actorId,
          action: data.action,
          entityType: data.entityType,
          entityId: data.entityId ?? null,
          metadata: (data.metadata ?? null) as Prisma.InputJsonValue,
          ip: data.ip ?? null,
        },
      });
    } catch (error) {
      /*
       * Auditing must never break the operation it describes. A failed insert
       * here would otherwise turn a successful login into a 500.
       *
       * The failure is logged at error level so it is still visible — a silently
       * broken audit trail is worse than a noisy one.
       */
      this.logger.error('Failed to write audit log entry', error, {
        action: data.action,
        entityType: data.entityType,
      });
    }
  }
}
