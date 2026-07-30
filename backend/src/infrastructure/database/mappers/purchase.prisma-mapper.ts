import type { Prisma } from '../../../generated/prisma/client.js';
import { Purchase, type PurchaseInvoiceFileProps } from '../../../core/domain/entities/purchase.entity.js';
import { GstTreatment } from '../../../core/domain/enums/purchase.enum.js';
import { decimalToNumber } from './inventory-item.prisma-mapper.js';

/**
 * The relations every purchase read needs.
 *
 * Declared once and shared so no query path omits the lines and produces an invoice that
 * looks empty. The supplier and recorder are selected down to the fields actually rendered
 * — selecting whole user rows would drag `passwordHash` into memory on every list page.
 */
export const PURCHASE_INCLUDE = {
  lines: { orderBy: { itemName: 'asc' } },
  supplier: { select: { name: true } },
  recordedBy: { select: { firstName: true, lastName: true } },
} as const satisfies Prisma.PurchaseInclude;

type PurchaseRow = Prisma.PurchaseGetPayload<{ include: typeof PURCHASE_INCLUDE }>;

function fullName(actor: { firstName: string; lastName: string } | null): string | null {
  return actor === null ? null : `${actor.firstName} ${actor.lastName}`.trim();
}

function toDomainTreatment(treatment: PurchaseRow['gstTreatment']): GstTreatment {
  switch (treatment) {
    case 'INTRA_STATE':
      return GstTreatment.INTRA_STATE;
    case 'INTER_STATE':
      return GstTreatment.INTER_STATE;
    case 'UNREGISTERED':
      return GstTreatment.UNREGISTERED;
  }
}

/**
 * Rebuilds the invoice file metadata, or null.
 *
 * All-or-nothing, matching the database CHECK. `storedName` is the discriminator because
 * it is the field without which the bytes are unreachable; the rest is presentation.
 */
function toInvoiceFile(row: PurchaseRow): PurchaseInvoiceFileProps | null {
  if (
    row.invoiceStoredName === null ||
    row.invoiceFileName === null ||
    row.invoiceMimeType === null ||
    row.invoiceSizeBytes === null ||
    row.invoiceChecksum === null ||
    row.invoiceUploadedAt === null
  ) {
    return null;
  }

  return {
    fileName: row.invoiceFileName,
    storedName: row.invoiceStoredName,
    mimeType: row.invoiceMimeType,
    sizeBytes: row.invoiceSizeBytes,
    checksum: row.invoiceChecksum,
    uploadedAt: row.invoiceUploadedAt,
  };
}

export const PurchasePrismaMapper = {
  toDomain(row: PurchaseRow): Purchase {
    return Purchase.fromPersistence({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.invoiceDate,

      supplierId: row.supplierId,
      supplierName: row.supplier.name,
      supplierGstin: row.supplierGstin,
      supplierStateCode: row.supplierStateCode,
      gstTreatment: toDomainTreatment(row.gstTreatment),

      subtotal: decimalToNumber(row.subtotal),
      totalCgst: decimalToNumber(row.totalCgst),
      totalSgst: decimalToNumber(row.totalSgst),
      totalIgst: decimalToNumber(row.totalIgst),
      totalTax: decimalToNumber(row.totalTax),
      totalAmount: decimalToNumber(row.totalAmount),

      notes: row.notes,
      invoiceFile: toInvoiceFile(row),

      recordedById: row.recordedById,
      recordedByName: fullName(row.recordedBy),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,

      lines: row.lines.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        itemName: line.itemName,
        unit: line.unit,
        category: line.category,
        quantity: decimalToNumber(line.quantity),
        unitRate: decimalToNumber(line.unitRate),
        hsnCode: line.hsnCode,
        gstRatePercent: decimalToNumber(line.gstRatePercent),
        taxableAmount: decimalToNumber(line.taxableAmount),
        cgstAmount: decimalToNumber(line.cgstAmount),
        sgstAmount: decimalToNumber(line.sgstAmount),
        igstAmount: decimalToNumber(line.igstAmount),
        lineTotal: decimalToNumber(line.lineTotal),
      })),
    });
  },

  toDomainList(rows: readonly PurchaseRow[]): Purchase[] {
    return rows.map((row) => PurchasePrismaMapper.toDomain(row));
  },
} as const;
