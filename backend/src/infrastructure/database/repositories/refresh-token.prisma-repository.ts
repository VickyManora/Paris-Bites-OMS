import type { PrismaClient } from '../../../generated/prisma/client.js';
import type {
  CreateRefreshTokenData,
  IRefreshTokenRepository,
  RefreshTokenRecord,
} from '../../../core/domain/repositories/refresh-token.repository.js';

export class RefreshTokenPrismaRepository implements IRefreshTokenRepository {
  constructor(private readonly client: PrismaClient) {}

  async findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const row = await this.client.refreshToken.findUnique({ where: { tokenHash } });

    if (row === null) {
      return null;
    }

    return {
      id: row.id,
      userId: row.userId,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      scope: row.scope,
      deviceName: row.deviceName,
    };
  }

  async create(data: CreateRefreshTokenData): Promise<RefreshTokenRecord> {
    const row = await this.client.refreshToken.create({
      data: {
        tokenHash: data.tokenHash,
        userId: data.userId,
        expiresAt: data.expiresAt,
        userAgent: data.userAgent ?? null,
        ipAddress: data.ipAddress ?? null,
        // The column defaults to FULL, so an omitted scope narrows nothing.
        ...(data.scope === undefined ? {} : { scope: data.scope }),
        deviceName: data.deviceName ?? null,
      },
    });

    return {
      id: row.id,
      userId: row.userId,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      scope: row.scope,
      deviceName: row.deviceName,
    };
  }

  async revoke(id: string): Promise<void> {
    await this.client.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async rotate(id: string, successorId: string): Promise<void> {
    await this.client.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date(), replacedById: successorId },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async deleteExpired(now: Date): Promise<number> {
    const { count } = await this.client.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] },
    });
    return count;
  }
}
