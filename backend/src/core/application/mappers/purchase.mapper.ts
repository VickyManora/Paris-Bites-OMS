import type { Purchase } from '../../domain/entities/purchase.entity.js';
import {
  INVENTORY_CATEGORY_LABELS,
  INVENTORY_UNIT_ABBREVIATIONS,
} from '../../domain/enums/inventory.enum.js';
import { GST_TREATMENT_LABELS } from '../../domain/enums/purchase.enum.js';
import type { PurchaseSummary } from '../../domain/repositories/purchase.repository.js';
import type {
  PurchaseDto,
  PurchaseInvoiceFileDto,
  PurchaseLineDto,
  PurchaseSummaryDto,
} from '../dtos/purchase.dto.js';

/**
 * Domain entity to outbound DTO.
 *
 * The download URL is built here as a **relative API path**. Returning a filesystem path
 * or a bucket URL would leak the storage adapter to the client and break the day local
 * disk is swapped for S3 — the point of `IFileStorage` is that nothing above it knows.
 */
export const PurchaseMapper = {
  toDto(purchase: Purchase): PurchaseDto {
    const props = purchase.toProps();

    return {
      id: purchase.id,
      invoiceNumber: purchase.invoiceNumber,
      // Date-only column: the time part is meaningless, so it is trimmed rather than
      // shipped as a midnight timestamp the client would render in its own timezone —
      // which can move the date by a day.
      invoiceDate: props.invoiceDate.toISOString().slice(0, 10),

      supplierId: props.supplierId,
      supplierName: props.supplierName,
      supplierGstin: props.supplierGstin,
      supplierStateCode: props.supplierStateCode,
      supplierStateName: purchase.supplierStateName,

      gstTreatment: props.gstTreatment,
      gstTreatmentLabel: GST_TREATMENT_LABELS[props.gstTreatment],

      subtotal: props.subtotal,
      totalCgst: props.totalCgst,
      totalSgst: props.totalSgst,
      totalIgst: props.totalIgst,
      totalTax: props.totalTax,
      totalAmount: props.totalAmount,

      notes: props.notes,

      invoiceFile: PurchaseMapper.toInvoiceFileDto(purchase),
      hasInvoiceFile: purchase.hasInvoiceFile,

      lineCount: purchase.lineCount,
      lines: props.lines.map((line): PurchaseLineDto => {
        const abbreviation = INVENTORY_UNIT_ABBREVIATIONS[line.unit];

        return {
          id: line.id,
          itemId: line.itemId,
          itemName: line.itemName,
          unit: line.unit,
          unitAbbreviation: abbreviation,
          category: line.category,
          categoryLabel: INVENTORY_CATEGORY_LABELS[line.category],

          quantity: line.quantity,
          displayQuantity: `${line.quantity} ${abbreviation}`,
          unitRate: line.unitRate,
          hsnCode: line.hsnCode,
          gstRatePercent: line.gstRatePercent,

          taxableAmount: line.taxableAmount,
          cgstAmount: line.cgstAmount,
          sgstAmount: line.sgstAmount,
          igstAmount: line.igstAmount,
          lineTotal: line.lineTotal,
        };
      }),

      recordedByName: props.recordedByName,
      createdAt: props.createdAt.toISOString(),
    };
  },

  toDtoList(purchases: readonly Purchase[]): PurchaseDto[] {
    return purchases.map((purchase) => PurchaseMapper.toDto(purchase));
  },

  toInvoiceFileDto(purchase: Purchase): PurchaseInvoiceFileDto | null {
    const file = purchase.invoiceFile;

    if (file === null) {
      return null;
    }

    return {
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      uploadedAt: file.uploadedAt.toISOString(),
      downloadUrl: `/purchases/${purchase.id}/invoice`,
    };
  },

  toSummaryDto(summary: PurchaseSummary): PurchaseSummaryDto {
    return {
      purchaseCount: summary.purchaseCount,
      totalValue: summary.totalValue,
      totalTax: summary.totalTax,
      missingInvoiceFiles: summary.missingInvoiceFiles,
    };
  },
} as const;
