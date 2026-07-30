import type { Request, RequestHandler } from 'express';
import { pipeline } from 'node:stream/promises';
import type { RequestContext } from '../../../core/application/dtos/auth.dto.js';
import type { CreatePurchaseLineInput } from '../../../core/application/dtos/purchase.dto.js';
import type {
  DownloadPurchaseInvoiceUseCase,
  UploadPurchaseInvoiceUseCase,
} from '../../../core/application/use-cases/purchases/manage-purchase-invoice.use-case.js';
import type {
  GetPurchaseSummaryUseCase,
  GetPurchaseUseCase,
  ListPurchasesUseCase,
} from '../../../core/application/use-cases/purchases/read-purchases.use-case.js';
import type { RecordPurchaseUseCase } from '../../../core/application/use-cases/purchases/record-purchase.use-case.js';
import type {
  InventoryCategory,
  InventoryUnit,
} from '../../../core/domain/enums/inventory.enum.js';
import type { GstTreatment } from '../../../core/domain/enums/purchase.enum.js';
import {
  BusinessRuleError,
  NotFoundError,
  UnauthorizedError,
} from '../../../core/domain/errors/domain-error.js';
import { asyncHandler } from '../../../shared/async-handler.js';
import { assertSignatureMatches } from '../middlewares/upload.middleware.js';
import { sendCreated, sendPage, sendSuccess } from '../serializers/response.serializer.js';
import type {
  CreatePurchaseBody,
  ListPurchasesQuery,
} from '../validators/purchase.validators.js';

/**
 * HTTP adapter for purchases.
 *
 * Thin, with one exception worth noting: the invoice download streams rather than
 * serialising, so it bypasses the response envelope entirely. A file is not JSON, and
 * wrapping bytes in `{ data: … }` would make it undownloadable.
 */
export class PurchaseController {
  constructor(
    private readonly listUseCase: ListPurchasesUseCase,
    private readonly getUseCase: GetPurchaseUseCase,
    private readonly summaryUseCase: GetPurchaseSummaryUseCase,
    private readonly recordUseCase: RecordPurchaseUseCase,
    private readonly uploadUseCase: UploadPurchaseInvoiceUseCase,
    private readonly downloadUseCase: DownloadPurchaseInvoiceUseCase,
  ) {}

  /** GET /purchases */
  readonly list: RequestHandler = asyncHandler(async (req, res) => {
    sendPage(res, await this.listUseCase.execute(this.queryOf(req)));
  });

  /** GET /purchases/summary — totals for the *same* filter as the list. */
  readonly summary: RequestHandler = asyncHandler(async (req, res) => {
    sendSuccess(res, await this.summaryUseCase.execute(this.queryOf(req)));
  });

  /** GET /purchases/:id */
  readonly getById: RequestHandler = asyncHandler(async (req, res) => {
    sendSuccess(res, await this.getUseCase.execute({ id: this.idOf(req) }));
  });

  /**
   * POST /purchases
   *
   * Records the invoice and adds its stock. Returns the purchase plus the per-item
   * before/after, so the client can report what moved without a request per line.
   */
  readonly create: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as CreatePurchaseBody;

    sendCreated(
      res,
      await this.recordUseCase.execute({
        actorId: this.actorIdOf(req),
        supplierId: body.supplierId,
        invoiceNumber: body.invoiceNumber,
        invoiceDate: body.invoiceDate,
        notes: body.notes,
        lines: body.lines.map((line) => this.toLineInput(line)),
        ...this.contextOf(req),
      }),
    );
  });

  /** POST /purchases/:id/invoice — multipart, field name `invoice`. */
  readonly uploadInvoice: RequestHandler = asyncHandler(async (req, res) => {
    const file = req.file;

    if (file === undefined) {
      throw new BusinessRuleError('No file was uploaded.', {
        invoice: ['Attach the bill.'],
      });
    }

    // Declared MIME versus actual bytes. Cannot happen in multer's `fileFilter`, which
    // runs before any content exists.
    assertSignatureMatches(file.mimetype, file.buffer);

    sendSuccess(
      res,
      await this.uploadUseCase.execute({
        actorId: this.actorIdOf(req),
        id: this.idOf(req),
        originalName: file.originalname,
        mimeType: file.mimetype,
        bytes: file.buffer,
        ...this.contextOf(req),
      }),
    );
  });

  /**
   * GET /purchases/:id/invoice — streams the stored bill.
   *
   * `Content-Disposition: inline` so a PDF or photo opens in the browser rather than
   * downloading; the filename is still supplied for when the user does save it.
   *
   * `X-Content-Type-Options: nosniff` matters more here than anywhere else in the API:
   * this is the one route that serves user-supplied bytes back, and without it a browser
   * may ignore the declared type and execute what it guesses instead.
   *
   * `pipeline` rather than `stream.pipe`, because it destroys the read stream if the
   * client disconnects mid-download — a plain pipe leaks the file handle.
   */
  readonly downloadInvoice: RequestHandler = asyncHandler(async (req, res) => {
    const download = await this.downloadUseCase.execute({ id: this.idOf(req) });

    res.setHeader('Content-Type', download.mimeType);
    res.setHeader('Content-Length', download.sizeBytes);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${this.sanitiseFileName(download.fileName)}"`,
    );

    await pipeline(download.stream, res);
  });

  /**
   * Narrows one validated line.
   *
   * `z.enum` over a readonly array widens its members back to `string`, so `category` and
   * `unit` arrive untyped even though the schema has already proved they are members —
   * the same reason `InventoryController` casts them. Built field by field rather than
   * spread, because a spread keeps the wide `newItem` in the resulting union.
   */
  private toLineInput(line: CreatePurchaseBody['lines'][number]): CreatePurchaseLineInput {
    const newItem = line.newItem;

    return {
      itemId: line.itemId,
      quantity: line.quantity,
      unitRate: line.unitRate,
      hsnCode: line.hsnCode,
      gstRatePercent: line.gstRatePercent,
      newItem:
        newItem === undefined
          ? undefined
          : {
              name: newItem.name,
              category: newItem.category as InventoryCategory,
              unit: newItem.unit as InventoryUnit,
              minimumQuantity: newItem.minimumQuantity,
            },
    };
  }

  private queryOf(req: Request): ListPurchasesQuery & {
    gstTreatment?: GstTreatment | undefined;
  } {
    const query = req.query as unknown as ListPurchasesQuery;

    return { ...query, gstTreatment: query.gstTreatment as GstTreatment | undefined };
  }

  /**
   * Strips quotes and control characters from a filename before it goes in a header.
   *
   * A stored name is a UUID, but this is the *original* name, which came from the user. A
   * quote or CRLF in it would break out of the header value — the classic response-header
   * injection.
   */
  private sanitiseFileName(fileName: string): string {
    // eslint-disable-next-line no-control-regex
    return fileName.replace(/[\u0000-\u001f"\\]/g, '_').slice(0, 200) || 'invoice';
  }

  private actorIdOf(req: Request): string {
    if (req.user === undefined) {
      throw new UnauthorizedError();
    }
    return req.user.id;
  }

  private idOf(req: Request): string {
    const id: unknown = req.params['id'];

    if (typeof id !== 'string') {
      throw new NotFoundError('Purchase');
    }

    return id;
  }

  private contextOf(req: Request): RequestContext {
    return {
      ipAddress: req.ip,
      userAgent: req.get('user-agent')?.slice(0, 255),
    };
  }
}
