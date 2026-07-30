import type { Request, RequestHandler } from 'express';
import type { RequestContext } from '../../../core/application/dtos/auth.dto.js';
import type { ApproveStockTransferUseCase } from '../../../core/application/use-cases/transfers/approve-stock-transfer.use-case.js';
import type { CompleteStockTransferUseCase } from '../../../core/application/use-cases/transfers/complete-stock-transfer.use-case.js';
import type { CreateStockTransferUseCase } from '../../../core/application/use-cases/transfers/create-stock-transfer.use-case.js';
import type {
  GetStockTransferUseCase,
  GetTransferSummaryUseCase,
  ListStockTransfersUseCase,
} from '../../../core/application/use-cases/transfers/read-stock-transfers.use-case.js';
import type { RejectStockTransferUseCase } from '../../../core/application/use-cases/transfers/reject-stock-transfer.use-case.js';
import type { StockTransferStatus } from '../../../core/domain/enums/stock-transfer.enum.js';
import { NotFoundError, UnauthorizedError } from '../../../core/domain/errors/domain-error.js';
import { asyncHandler } from '../../../shared/async-handler.js';
import { sendCreated, sendPage, sendSuccess } from '../serializers/response.serializer.js';
import type {
  ApproveTransferBody,
  CreateTransferBody,
  ListTransfersQuery,
  RejectTransferBody,
} from '../validators/stock-transfer.validators.js';

/**
 * HTTP adapter for stock transfers.
 *
 * Thin: read validated input, call one use case, serialise. The transactional stock
 * movement lives entirely below this layer.
 */
export class StockTransferController {
  constructor(
    private readonly listUseCase: ListStockTransfersUseCase,
    private readonly getUseCase: GetStockTransferUseCase,
    private readonly summaryUseCase: GetTransferSummaryUseCase,
    private readonly createUseCase: CreateStockTransferUseCase,
    private readonly approveUseCase: ApproveStockTransferUseCase,
    private readonly rejectUseCase: RejectStockTransferUseCase,
    private readonly completeUseCase: CompleteStockTransferUseCase,
  ) {}

  /** GET /transfers */
  readonly list: RequestHandler = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListTransfersQuery;

    const page = await this.listUseCase.execute({
      status: query.status as StockTransferStatus | undefined,
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
      sortField: query.sortField,
      sortDirection: query.sortDirection,
    });

    sendPage(res, page);
  });

  /** GET /transfers/summary */
  readonly summary: RequestHandler = asyncHandler(async (_req, res) => {
    sendSuccess(res, await this.summaryUseCase.execute());
  });

  /** GET /transfers/:id — the "Transfer Details" view, including its lines. */
  readonly getById: RequestHandler = asyncHandler(async (req, res) => {
    sendSuccess(res, await this.getUseCase.execute({ id: this.idOf(req) }));
  });

  /** POST /transfers */
  readonly create: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as CreateTransferBody;

    const transfer = await this.createUseCase.execute({
      actorId: this.actorIdOf(req),
      notes: body.notes,
      lines: body.lines,
      ...this.contextOf(req),
    });

    sendCreated(res, transfer);
  });

  /**
   * POST /transfers/:id/approve
   *
   * Deducts the source location. Returns the transfer plus the per-item before/after, so the
   * client can report what moved without a follow-up request per item.
   */
  readonly approve: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as ApproveTransferBody;

    sendSuccess(
      res,
      await this.approveUseCase.execute({
        actorId: this.actorIdOf(req),
        id: this.idOf(req),
        note: body.note,
        ...this.contextOf(req),
      }),
    );
  });

  /** POST /transfers/:id/reject */
  readonly reject: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as RejectTransferBody;

    sendSuccess(
      res,
      await this.rejectUseCase.execute({
        actorId: this.actorIdOf(req),
        id: this.idOf(req),
        reason: body.reason,
        ...this.contextOf(req),
      }),
    );
  });

  /** POST /transfers/:id/complete — credits the destination location. */
  readonly complete: RequestHandler = asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await this.completeUseCase.execute({
        actorId: this.actorIdOf(req),
        id: this.idOf(req),
        ...this.contextOf(req),
      }),
    );
  });

  private actorIdOf(req: Request): string {
    if (req.user === undefined) {
      throw new UnauthorizedError();
    }
    return req.user.id;
  }

  private idOf(req: Request): string {
    const id: unknown = req.params['id'];

    if (typeof id !== 'string') {
      throw new NotFoundError('Stock transfer');
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
