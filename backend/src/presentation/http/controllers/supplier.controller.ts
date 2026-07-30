import type { Request, RequestHandler } from 'express';
import type { RequestContext } from '../../../core/application/dtos/auth.dto.js';
import type {
  CreateSupplierUseCase,
  DeleteSupplierUseCase,
  UpdateSupplierUseCase,
} from '../../../core/application/use-cases/suppliers/manage-suppliers.use-case.js';
import type {
  GetSupplierUseCase,
  ListSupplierOptionsUseCase,
  ListSuppliersUseCase,
} from '../../../core/application/use-cases/suppliers/read-suppliers.use-case.js';
import { NotFoundError, UnauthorizedError } from '../../../core/domain/errors/domain-error.js';
import { asyncHandler } from '../../../shared/async-handler.js';
import {
  sendCreated,
  sendNoContent,
  sendPage,
  sendSuccess,
} from '../serializers/response.serializer.js';
import type {
  CreateSupplierBody,
  ListSuppliersQuery,
  UpdateSupplierBody,
} from '../validators/purchase.validators.js';

/** HTTP adapter for suppliers. Thin: read validated input, call one use case, serialise. */
export class SupplierController {
  constructor(
    private readonly listUseCase: ListSuppliersUseCase,
    private readonly optionsUseCase: ListSupplierOptionsUseCase,
    private readonly getUseCase: GetSupplierUseCase,
    private readonly createUseCase: CreateSupplierUseCase,
    private readonly updateUseCase: UpdateSupplierUseCase,
    private readonly deleteUseCase: DeleteSupplierUseCase,
  ) {}

  /** GET /suppliers */
  readonly list: RequestHandler = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListSuppliersQuery;

    sendPage(
      res,
      await this.listUseCase.execute({
        search: query.search,
        isActive: query.isActive,
        stateCode: query.stateCode,
        page: query.page,
        pageSize: query.pageSize,
        sortField: query.sortField,
        sortDirection: query.sortDirection,
      }),
    );
  });

  /** GET /suppliers/options — unpaginated, for the purchase form's dropdown. */
  readonly options: RequestHandler = asyncHandler(async (_req, res) => {
    sendSuccess(res, await this.optionsUseCase.execute());
  });

  /** GET /suppliers/:id */
  readonly getById: RequestHandler = asyncHandler(async (req, res) => {
    sendSuccess(res, await this.getUseCase.execute({ id: this.idOf(req) }));
  });

  /** POST /suppliers */
  readonly create: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as CreateSupplierBody;

    sendCreated(
      res,
      await this.createUseCase.execute({
        actorId: this.actorIdOf(req),
        ...body,
        ...this.contextOf(req),
      }),
    );
  });

  /** PATCH /suppliers/:id */
  readonly update: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as UpdateSupplierBody;

    sendSuccess(
      res,
      await this.updateUseCase.execute({
        actorId: this.actorIdOf(req),
        id: this.idOf(req),
        ...body,
        ...this.contextOf(req),
      }),
    );
  });

  /**
   * DELETE /suppliers/:id
   *
   * Answers 200 with the deactivated supplier when it had purchase history, and 204 when
   * it was genuinely removed. The difference is deliberate and the client acts on it: a
   * body means "this is still here, now inactive", which is not what the user pressed but
   * is what could safely be done.
   */
  readonly remove: RequestHandler = asyncHandler(async (req, res) => {
    const result = await this.deleteUseCase.execute({
      actorId: this.actorIdOf(req),
      id: this.idOf(req),
      ...this.contextOf(req),
    });

    if (result === null) {
      sendNoContent(res);
      return;
    }

    sendSuccess(res, result);
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
      throw new NotFoundError('Supplier');
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
