import type { Readable } from 'node:stream';
import { BusinessRuleError, NotFoundError } from '../../../domain/errors/domain-error.js';
import type { IAuditLogRepository } from '../../../domain/repositories/audit-log.repository.js';
import type { IPurchaseRepository } from '../../../domain/repositories/purchase.repository.js';
import type {
  DownloadPurchaseInvoiceInput,
  PurchaseDto,
  UploadPurchaseInvoiceInput,
} from '../../dtos/purchase.dto.js';
import { PurchaseMapper } from '../../mappers/purchase.mapper.js';
import type { IFileStorage } from '../../ports/file-storage.port.js';
import type { ILogger } from '../../ports/logger.port.js';
import type { IUseCase } from '../../ports/use-case.port.js';
import { PurchaseAuditAction } from './purchase-audit.js';

/**
 * What an invoice may be.
 *
 * A closed allowlist rather than a blocklist, and checked against the *declared* type
 * only — the multipart layer verifies the magic bytes agree before this is reached. PDFs
 * and phone photos cover how bills actually arrive; anything else is far more likely to be
 * a mistake or an attack than a genuine invoice.
 */
const ALLOWED_MIME_TYPES: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
];

const MIME_LABELS = 'PDF, JPEG, PNG, WebP or HEIC';

export interface InvoiceDownload {
  readonly stream: Readable;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

/**
 * Attaches a bill to a purchase, or replaces the one already there.
 *
 * Replacing is allowed even though the purchase itself is immutable, and the distinction
 * matters: the file is *evidence for* the record, not part of it. Nothing financial
 * changes, so re-uploading a legible scan over a blurry one is a correction the system
 * should not stand in the way of.
 *
 * Ordering is deliberate — bytes are written first, then the database row is pointed at
 * them. The reverse would leave a row referencing a file that was never written if the
 * write failed. This way a failure between the two leaves an orphaned file, which wastes
 * disk but breaks nothing, and the previous file is only unlinked after the row commits.
 */
export class UploadPurchaseInvoiceUseCase implements IUseCase<
  UploadPurchaseInvoiceInput,
  PurchaseDto
> {
  constructor(
    private readonly purchases: IPurchaseRepository,
    private readonly storage: IFileStorage,
    private readonly auditLog: IAuditLogRepository,
    private readonly logger: ILogger,
  ) {}

  async execute(input: UploadPurchaseInvoiceInput): Promise<PurchaseDto> {
    const existing = await this.purchases.findById(input.id);

    if (existing === null) {
      throw new NotFoundError('Purchase', input.id);
    }

    if (!ALLOWED_MIME_TYPES.includes(input.mimeType)) {
      throw new BusinessRuleError(`An invoice must be a ${MIME_LABELS} file.`, {
        invoice: [`Upload a ${MIME_LABELS} file.`],
      });
    }

    if (input.bytes.length === 0) {
      throw new BusinessRuleError('The uploaded file is empty.', {
        invoice: ['This file has no content.'],
      });
    }

    const stored = await this.storage.store({
      originalName: input.originalName,
      mimeType: input.mimeType,
      bytes: input.bytes,
    });

    const replacedStoredName = await this.purchases.attachInvoiceFile(input.id, {
      fileName: input.originalName,
      storedName: stored.storedName,
      mimeType: input.mimeType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      uploadedAt: new Date(),
    });

    /*
     * Only now that the row is committed. Deleting the old file earlier would destroy the
     * only copy if the update then failed — and a purchase whose evidence has vanished is
     * worse than one with a stale file.
     */
    if (replacedStoredName !== null) {
      await this.storage.delete(replacedStoredName);
    }

    await this.auditLog.record({
      actorId: input.actorId,
      action: PurchaseAuditAction.INVOICE_UPLOADED,
      entityType: 'Purchase',
      entityId: input.id,
      ip: input.ipAddress,
      metadata: {
        fileName: input.originalName,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        replacedPrevious: replacedStoredName !== null,
      },
    });

    this.logger.info('Purchase invoice uploaded', {
      purchaseId: input.id,
      sizeBytes: stored.sizeBytes,
      replacedPrevious: replacedStoredName !== null,
    });

    const updated = await this.purchases.findById(input.id);

    if (updated === null) {
      throw new NotFoundError('Purchase', input.id);
    }

    return PurchaseMapper.toDto(updated);
  }
}

/**
 * Streams a stored invoice back.
 *
 * Streamed rather than buffered: a scanned multi-page bill is megabytes, and reading each
 * one fully into memory to hand it to Express would make concurrent downloads a memory
 * spike proportional to file size times users.
 *
 * The purchase is loaded first so the stored name comes from the database and never from
 * the request. A client that could name the file to read would be able to read every file
 * in the upload directory.
 */
export class DownloadPurchaseInvoiceUseCase implements IUseCase<
  DownloadPurchaseInvoiceInput,
  InvoiceDownload
> {
  constructor(
    private readonly purchases: IPurchaseRepository,
    private readonly storage: IFileStorage,
  ) {}

  async execute({ id }: DownloadPurchaseInvoiceInput): Promise<InvoiceDownload> {
    const purchase = await this.purchases.findById(id);

    if (purchase === null) {
      throw new NotFoundError('Purchase', id);
    }

    const file = purchase.invoiceFile;

    if (file === null) {
      throw new NotFoundError('Invoice file for purchase', id);
    }

    return {
      stream: await this.storage.read(file.storedName),
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    };
  }
}
