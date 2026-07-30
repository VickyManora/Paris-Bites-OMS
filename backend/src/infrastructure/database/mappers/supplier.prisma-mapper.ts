import type { Supplier as PrismaSupplier } from '../../../generated/prisma/client.js';
import { Supplier } from '../../../core/domain/entities/supplier.entity.js';

export const SupplierPrismaMapper = {
  toDomain(row: PrismaSupplier): Supplier {
    return Supplier.fromPersistence({
      id: row.id,
      name: row.name,
      gstin: row.gstin,
      stateCode: row.stateCode,
      contactName: row.contactName,
      email: row.email,
      phone: row.phone,
      addressLine: row.addressLine,
      city: row.city,
      notes: row.notes,
      isActive: row.isActive,
      createdById: row.createdById,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  },

  toDomainList(rows: readonly PrismaSupplier[]): Supplier[] {
    return rows.map((row) => SupplierPrismaMapper.toDomain(row));
  },
} as const;
