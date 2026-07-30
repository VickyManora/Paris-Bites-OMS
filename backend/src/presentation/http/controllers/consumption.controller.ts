import type { Request, RequestHandler } from 'express';
import type { RequestContext } from '../../../core/application/dtos/auth.dto.js';
import type {
  GetConsumptionSummaryUseCase,
  GetConsumptionUseCase,
  ListConsumptionUseCase,
} from '../../../core/application/use-cases/consumption/read-consumption.use-case.js';
import type {
  RecordConsumptionUseCase,
  UpdateConsumptionUseCase,
  VoidConsumptionUseCase,
} from '../../../core/application/use-cases/consumption/manage-consumption.use-case.js';
import type { InventoryLocation } from '../../../core/domain/enums/inventory.enum.js';
import { NotFoundError, UnauthorizedError } from '../../../core/domain/errors/domain-error.js';
import { asyncHandler } from '../../../shared/async-handler.js';
import { sendCreated, sendPage, sendSuccess } from '../serializers/response.serializer.js';
import type {
  ListConsumptionQuery,
  RecordConsumptionBody,
  UpdateConsumptionBody,
  VoidConsumptionBody,
} from '../validators/consumption.validators.js';

/**
 * HTTP adapter for daily consumption.
 *
 * Thin by design: read already-validated input, call one use case, hand the result to a
 * serializer. No business rules, no Prisma, no try/catch.
 */
export class ConsumptionController {
  constructor(
    private readonly listUseCase: ListConsumptionUseCase,
    private readonly summaryUseCase: GetConsumptionSummaryUseCase,
    private readonly getUseCase: GetConsumptionUseCase,
    private readonly recordUseCase: RecordConsumptionUseCase,
    private readonly updateUseCase: UpdateConsumptionUseCase,
    private readonly voidUseCase: VoidConsumptionUseCase,
  ) {}

  /** GET /consumption */
  readonly list: RequestHandler = asyncHandler(async (req, res) => {
    sendPage(res, await this.listUseCase.execute(this.queryOf(req)));
  });

  /** GET /consumption/summary — totals for the *same* filter as the list. */
  readonly summary: RequestHandler = asyncHandler(async (req, res) => {
    sendSuccess(res, await this.summaryUseCase.execute(this.queryOf(req)));
  });

  /** GET /consumption/:id — includes the full revision history. */
  readonly getById: RequestHandler = asyncHandler(async (req, res) => {
    sendSuccess(res, await this.getUseCase.execute({ id: this.idOf(req) }));
  });

  /** POST /consumption — records the sheet and deducts its stock. */
  readonly record: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as RecordConsumptionBody;

    sendCreated(
      res,
      await this.recordUseCase.execute({
        actorId: this.actorIdOf(req),
        entryDate: body.entryDate,
        location: body.location as InventoryLocation,
        notes: body.notes,
        lines: body.lines,
        ...this.contextOf(req),
      }),
    );
  });

  /** PUT /consumption/:id — replaces the sheet and re-applies the difference. */
  readonly update: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as UpdateConsumptionBody;

    sendSuccess(
      res,
      await this.updateUseCase.execute({
        actorId: this.actorIdOf(req),
        id: this.idOf(req),
        entryDate: body.entryDate,
        location: body.location as InventoryLocation,
        notes: body.notes,
        lines: body.lines,
        note: body.note,
        ...this.contextOf(req),
      }),
    );
  });

  /**
   * POST /consumption/:id/void — returns the stock and marks the entry voided.
   *
   * A POST to a sub-resource rather than `DELETE /:id`, because the row survives and the
   * call carries a required body. `DELETE` with a mandatory payload, on something that is
   * not deleted, would describe none of that.
   */
  readonly void: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as VoidConsumptionBody;

    sendSuccess(
      res,
      await this.voidUseCase.execute({
        actorId: this.actorIdOf(req),
        id: this.idOf(req),
        reason: body.reason,
        ...this.contextOf(req),
      }),
    );
  });

  private queryOf(req: Request): {
    filter: {
      search?: string | undefined;
      location?: InventoryLocation | undefined;
      itemId?: string | undefined;
      fromDate?: Date | undefined;
      toDate?: Date | undefined;
      includeVoided?: boolean | undefined;
    };
    page: number;
    pageSize: number;
    sort: { field: ListConsumptionQuery['sortField']; direction: 'asc' | 'desc' };
  } {
    const query = req.query as unknown as ListConsumptionQuery;

    return {
      filter: {
        search: query.search,
        location: query.location as InventoryLocation | undefined,
        itemId: query.itemId,
        fromDate: query.fromDate,
        toDate: query.toDate,
        includeVoided: query.includeVoided,
      },
      page: query.page,
      pageSize: query.pageSize,
      sort: { field: query.sortField, direction: query.sortDirection },
    };
  }

  /**
   * `authenticate` guarantees `req.user`, but reading it through a check keeps the type
   * honest without a non-null assertion.
   */
  private actorIdOf(req: Request): string {
    if (req.user === undefined) {
      throw new UnauthorizedError();
    }
    return req.user.id;
  }

  private idOf(req: Request): string {
    const id: unknown = req.params['id'];

    if (typeof id !== 'string') {
      throw new NotFoundError('Consumption entry');
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
