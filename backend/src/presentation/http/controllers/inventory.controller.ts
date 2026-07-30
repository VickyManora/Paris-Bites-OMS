import type { Request, RequestHandler } from 'express';
import type { RequestContext } from '../../../core/application/dtos/auth.dto.js';
import type {
  InventoryCategory,
  InventoryItemStatus,
  InventoryLocation,
  InventoryUnit,
} from '../../../core/domain/enums/inventory.enum.js';
import { NotFoundError, UnauthorizedError } from '../../../core/domain/errors/domain-error.js';
import type { AdjustInventoryQuantityUseCase } from '../../../core/application/use-cases/inventory/adjust-inventory-quantity.use-case.js';
import type { CreateInventoryItemUseCase } from '../../../core/application/use-cases/inventory/create-inventory-item.use-case.js';
import type { DeleteInventoryItemUseCase } from '../../../core/application/use-cases/inventory/delete-inventory-item.use-case.js';
import type { GetInventoryHistoryUseCase } from '../../../core/application/use-cases/inventory/get-inventory-history.use-case.js';
import type { GetInventoryItemUseCase } from '../../../core/application/use-cases/inventory/get-inventory-item.use-case.js';
import type { GetInventoryDashboardUseCase } from '../../../core/application/use-cases/inventory/get-inventory-summary.use-case.js';
import type { ListInventoryItemsUseCase } from '../../../core/application/use-cases/inventory/list-inventory-items.use-case.js';
import type { UpdateInventoryItemUseCase } from '../../../core/application/use-cases/inventory/update-inventory-item.use-case.js';
import { asyncHandler } from '../../../shared/async-handler.js';
import {
  sendCreated,
  sendNoContent,
  sendPage,
  sendSuccess,
} from '../serializers/response.serializer.js';
import type {
  AdjustQuantityBody,
  CreateInventoryItemBody,
  HistoryQuery,
  ListInventoryQuery,
  UpdateInventoryItemBody,
} from '../validators/inventory.validators.js';

/**
 * HTTP adapter for the inventory module.
 *
 * Thin by design: read already-validated input, call one use case, hand the result to a
 * serializer. No business rules, no Prisma, no try/catch — failures propagate to
 * `errorHandler`, the single place errors become responses.
 */
export class InventoryController {
  constructor(
    private readonly listUseCase: ListInventoryItemsUseCase,
    private readonly getUseCase: GetInventoryItemUseCase,
    private readonly createUseCase: CreateInventoryItemUseCase,
    private readonly updateUseCase: UpdateInventoryItemUseCase,
    private readonly adjustUseCase: AdjustInventoryQuantityUseCase,
    private readonly deleteUseCase: DeleteInventoryItemUseCase,
    private readonly historyUseCase: GetInventoryHistoryUseCase,
    private readonly dashboardUseCase: GetInventoryDashboardUseCase,
  ) {}

  /** GET /inventory/items */
  readonly list: RequestHandler = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListInventoryQuery;

    const page = await this.listUseCase.execute({
      filter: {
        search: query.search,
        category: query.category as InventoryCategory | undefined,
        location: query.location as InventoryLocation | undefined,
        unit: query.unit as InventoryUnit | undefined,
        status: query.status as InventoryItemStatus | undefined,
        needsRestocking: query.needsRestocking,
      },
      page: query.page,
      pageSize: query.pageSize,
      sortField: query.sortField,
      sortDirection: query.sortDirection,
    });

    // `sendPage` puts the rows in `data` and the paging figures in `meta.pagination`,
    // which is the envelope the client's paginator reads.
    sendPage(res, page);
  });

  /** GET /inventory/items/:id */
  readonly getById: RequestHandler = asyncHandler(async (req, res) => {
    sendSuccess(res, await this.getUseCase.execute({ id: this.idOf(req) }));
  });

  /** POST /inventory/items */
  readonly create: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as CreateInventoryItemBody;

    const item = await this.createUseCase.execute({
      actorId: this.actorIdOf(req),
      name: body.name,
      category: body.category as InventoryCategory,
      unit: body.unit as InventoryUnit,
      location: body.location as InventoryLocation,
      currentQuantity: body.currentQuantity,
      openingQuantity: body.openingQuantity,
      minimumQuantity: body.minimumQuantity,
      purchasePrice: body.purchasePrice,
      supplierId: body.supplierId,
      lowStockAlertEnabled: body.lowStockAlertEnabled,
      batchNumber: body.batchNumber,
      expiryDate: body.expiryDate,
      status: body.status as InventoryItemStatus | undefined,
      notes: body.notes,
      ...this.contextOf(req),
    });

    sendCreated(res, item);
  });

  /** PATCH /inventory/items/:id */
  readonly update: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as UpdateInventoryItemBody;

    const item = await this.updateUseCase.execute({
      actorId: this.actorIdOf(req),
      id: this.idOf(req),
      name: body.name,
      category: body.category as InventoryCategory | undefined,
      unit: body.unit as InventoryUnit | undefined,
      location: body.location as InventoryLocation | undefined,
      minimumQuantity: body.minimumQuantity,
      purchasePrice: body.purchasePrice,
      supplierId: body.supplierId,
      lowStockAlertEnabled: body.lowStockAlertEnabled,
      batchNumber: body.batchNumber,
      expiryDate: body.expiryDate,
      status: body.status as InventoryItemStatus | undefined,
      notes: body.notes,
      ...this.contextOf(req),
    });

    sendSuccess(res, item);
  });

  /** PATCH /inventory/items/:id/quantity */
  readonly adjustQuantity: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as AdjustQuantityBody;

    const item = await this.adjustUseCase.execute({
      actorId: this.actorIdOf(req),
      id: this.idOf(req),
      delta: body.delta,
      quantity: body.quantity,
      note: body.note,
      ...this.contextOf(req),
    });

    sendSuccess(res, item);
  });

  /** DELETE /inventory/items/:id */
  readonly remove: RequestHandler = asyncHandler(async (req, res) => {
    await this.deleteUseCase.execute({
      actorId: this.actorIdOf(req),
      id: this.idOf(req),
      ...this.contextOf(req),
    });

    sendNoContent(res);
  });

  /** GET /inventory/items/:id/history */
  readonly history: RequestHandler = asyncHandler(async (req, res) => {
    const query = req.query as unknown as HistoryQuery;

    const page = await this.historyUseCase.execute({
      itemId: this.idOf(req),
      page: query.page,
      pageSize: query.pageSize,
    });

    sendPage(res, page);
  });

  /** GET /inventory/dashboard */
  readonly dashboard: RequestHandler = asyncHandler(async (_req, res) => {
    sendSuccess(res, await this.dashboardUseCase.execute());
  });

  /**
   * `authenticate` guarantees `req.user`, but reading it through a check keeps the type
   * honest without a non-null assertion — which lint forbids for good reason.
   */
  private actorIdOf(req: Request): string {
    if (req.user === undefined) {
      throw new UnauthorizedError();
    }
    return req.user.id;
  }

  /**
   * `validate({ params: idParamSchema })` guarantees this is a single UUID string, but
   * Express types params as `string | string[]` because a route can repeat a name.
   * Narrowed rather than asserted, so a malformed route definition fails loudly here
   * instead of passing an array into a repository.
   */
  private idOf(req: Request): string {
    const id: unknown = req.params['id'];

    if (typeof id !== 'string') {
      throw new NotFoundError('Inventory item');
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
