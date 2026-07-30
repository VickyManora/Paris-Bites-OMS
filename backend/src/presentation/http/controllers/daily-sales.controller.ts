import type { Request, RequestHandler } from 'express';
import type { RequestContext } from '../../../core/application/dtos/auth.dto.js';
import type { DailySalesAmountInput } from '../../../core/application/dtos/daily-sales.dto.js';
import type {
  GetDailySalesByDateUseCase,
  GetDailySalesSummaryUseCase,
  GetDailySalesUseCase,
  ListDailySalesUseCase,
} from '../../../core/application/use-cases/sales/read-daily-sales.use-case.js';
import type {
  RecordDailySalesUseCase,
  UpdateDailySalesUseCase,
} from '../../../core/application/use-cases/sales/manage-daily-sales.use-case.js';
import type { SalesChannel, SalesPaymentMode } from '../../../core/domain/enums/sales.enum.js';
import type { DailySalesFilter } from '../../../core/domain/repositories/daily-sales.repository.js';
import { NotFoundError, UnauthorizedError } from '../../../core/domain/errors/domain-error.js';
import { asyncHandler } from '../../../shared/async-handler.js';
import { sendCreated, sendPage, sendSuccess } from '../serializers/response.serializer.js';
import type {
  DailySalesSummaryQuery,
  ListDailySalesQuery,
  RecordDailySalesBody,
  UpdateDailySalesBody,
} from '../validators/daily-sales.validators.js';

/**
 * HTTP adapter for daily sales.
 *
 * Thin by design: read already-validated input, call one use case, hand the result to a
 * serializer. No business rules, no Prisma, no try/catch.
 */
export class DailySalesController {
  constructor(
    private readonly listUseCase: ListDailySalesUseCase,
    private readonly summaryUseCase: GetDailySalesSummaryUseCase,
    private readonly getUseCase: GetDailySalesUseCase,
    private readonly getByDateUseCase: GetDailySalesByDateUseCase,
    private readonly recordUseCase: RecordDailySalesUseCase,
    private readonly updateUseCase: UpdateDailySalesUseCase,
  ) {}

  /** GET /daily-sales */
  readonly list: RequestHandler = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListDailySalesQuery;

    sendPage(
      res,
      await this.listUseCase.execute({
        filter: this.filterOf(query),
        page: query.page,
        pageSize: query.pageSize,
        sortField: query.sortField,
        sortDirection: query.sortDirection,
      }),
    );
  });

  /** GET /daily-sales/summary — totals for the *same* filter as the list. */
  readonly summary: RequestHandler = asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await this.summaryUseCase.execute(
        this.filterOf(req.query as unknown as DailySalesSummaryQuery),
      ),
    );
  });

  /**
   * GET /daily-sales/by-date/:date
   *
   * Returns `null` rather than 404 when the day has not been entered. "Not recorded yet"
   * is the expected answer most of the time — it is what the form asks before deciding
   * between recording and editing — and a 404 would make the normal case look like a
   * failure in the client's error handling.
   */
  readonly getByDate: RequestHandler = asyncHandler(async (req, res) => {
    const params = req.params as unknown as { date: Date };

    sendSuccess(res, await this.getByDateUseCase.execute(params.date));
  });

  /** GET /daily-sales/:id — includes the full revision history. */
  readonly getById: RequestHandler = asyncHandler(async (req, res) => {
    sendSuccess(res, await this.getUseCase.execute(this.idOf(req)));
  });

  /** POST /daily-sales */
  readonly record: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as RecordDailySalesBody;

    sendCreated(
      res,
      await this.recordUseCase.execute({
        actorId: this.actorIdOf(req),
        entryDate: body.entryDate,
        notes: body.notes,
        amounts: this.amountsOf(body.amounts),
        ...this.contextOf(req),
      }),
    );
  });

  /**
   * PUT /daily-sales/:id
   *
   * `PUT`, not `PATCH`: the body is the day's complete desired state. A partial update
   * would leave the server guessing whether an omitted channel meant "unchanged" or
   * "actually zero", and those are different days.
   */
  readonly update: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as UpdateDailySalesBody;

    sendSuccess(
      res,
      await this.updateUseCase.execute({
        actorId: this.actorIdOf(req),
        id: this.idOf(req),
        notes: body.notes,
        amounts: this.amountsOf(body.amounts),
        reason: body.reason,
        ...this.contextOf(req),
      }),
    );
  });

  private amountsOf(
    amounts: readonly { channel: string; paymentMode: string; amount: number }[],
  ): DailySalesAmountInput[] {
    return amounts.map((amount) => ({
      channel: amount.channel as SalesChannel,
      paymentMode: amount.paymentMode as SalesPaymentMode,
      amount: amount.amount,
    }));
  }

  private filterOf(query: ListDailySalesQuery | DailySalesSummaryQuery): DailySalesFilter {
    return {
      fromDate: query.fromDate,
      toDate: query.toDate,
      channel: query.channel as SalesChannel | undefined,
    };
  }

  private idOf(req: Request): string {
    const id: unknown = req.params['id'];

    if (typeof id !== 'string') {
      throw new NotFoundError('Sales entry');
    }

    return id;
  }

  private actorIdOf(req: Request): string {
    if (req.user === undefined) {
      throw new UnauthorizedError();
    }

    return req.user.id;
  }

  private contextOf(req: Request): RequestContext {
    return { ipAddress: req.ip, userAgent: req.get('user-agent') };
  }
}
