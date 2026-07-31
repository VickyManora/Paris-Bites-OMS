import type { Request, RequestHandler } from 'express';
import type { RequestContext } from '../../../core/application/dtos/auth.dto.js';
import type {
  CancelOrderUseCase,
  PlaceOrderUseCase,
  ReceivePaymentUseCase,
} from '../../../core/application/use-cases/pos/manage-orders.use-case.js';
import type {
  GetMenuUseCase,
  GetOrderUseCase,
  GetPosSummaryUseCase,
  ListOrdersUseCase,
} from '../../../core/application/use-cases/pos/read-orders.use-case.js';
import type { IProductRepository } from '../../../core/domain/repositories/pos.repository.js';
import { permissionsForRole } from '../../../core/domain/enums/permission.enum.js';
import type { DiscountType, OrderStatus, PaymentMethod } from '../../../core/domain/enums/pos.enum.js';
import type { SalesChannel } from '../../../core/domain/enums/sales.enum.js';
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../../core/domain/errors/domain-error.js';
import { asyncHandler } from '../../../shared/async-handler.js';
import { sendCreated, sendPage, sendSuccess } from '../serializers/response.serializer.js';
import { idempotencyKeySchema } from '../validators/pos.validators.js';
import type {
  CancelOrderBody,
  ListOrdersQuery,
  MenuQueryInput,
  PlaceOrderBody,
  PosSummaryQuery,
  ProductAvailabilityBody,
  ReceivePaymentBody,
} from '../validators/pos.validators.js';

/**
 * HTTP adapter for the point of sale.
 *
 * Permissions are derived from the authenticated role and passed to the use cases, which is
 * what lets one endpoint serve both roles: the same list call returns everything for an admin
 * and only today's own orders for a Store Manager, decided server-side rather than by a
 * parameter the client could change.
 */
export class PosController {
  constructor(
    private readonly menuUseCase: GetMenuUseCase,
    private readonly summaryUseCase: GetPosSummaryUseCase,
    private readonly listUseCase: ListOrdersUseCase,
    private readonly getUseCase: GetOrderUseCase,
    private readonly placeUseCase: PlaceOrderUseCase,
    private readonly paymentUseCase: ReceivePaymentUseCase,
    private readonly cancelUseCase: CancelOrderUseCase,
    private readonly products: IProductRepository,
  ) {}

  /** GET /pos/menu */
  readonly menu: RequestHandler = asyncHandler(async (req, res) => {
    const query = req.query as unknown as MenuQueryInput;

    sendSuccess(res, await this.menuUseCase.execute({ includeUnavailable: query.includeUnavailable }));
  });

  /** GET /pos/summary — today's figures, scoped to what the caller may see. */
  readonly summary: RequestHandler = asyncHandler(async (req, res) => {
    const query = req.query as unknown as PosSummaryQuery;

    sendSuccess(
      res,
      await this.summaryUseCase.execute({
        day: query.date ?? new Date(),
        actorId: this.actorIdOf(req),
        permissions: this.permissionsOf(req),
      }),
    );
  });

  /** GET /pos/orders */
  readonly list: RequestHandler = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ListOrdersQuery;

    sendPage(
      res,
      await this.listUseCase.execute({
        actorId: this.actorIdOf(req),
        permissions: this.permissionsOf(req),
        filter: {
          search: query.search,
          fromDate: query.fromDate,
          toDate: query.toDate,
          status: query.status as OrderStatus | undefined,
          paymentMethod: query.paymentMethod as PaymentMethod | undefined,
          channel: query.channel as SalesChannel | undefined,
        },
        page: query.page,
        pageSize: query.pageSize,
        sortField: query.sortField,
        sortDirection: query.sortDirection,
      }),
    );
  });

  /** GET /pos/orders/:id */
  readonly getById: RequestHandler = asyncHandler(async (req, res) => {
    sendSuccess(
      res,
      await this.getUseCase.execute({
        id: this.idOf(req),
        actorId: this.actorIdOf(req),
        permissions: this.permissionsOf(req),
      }),
    );
  });

  /**
   * POST /pos/orders
   *
   * Takes the whole order in one call, payment included when the money is already in hand.
   * That is the counter's common path and splitting it into create-then-pay would double the
   * slowest part of a ten-second order.
   *
   * Safe to call twice with the same `Idempotency-Key`: the second call returns the first
   * order. That is what lets the till retry a request whose reply was lost on mobile data
   * without charging the customer twice.
   */
  readonly place: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as PlaceOrderBody;

    sendCreated(
      res,
      await this.placeUseCase.execute({
        actorId: this.actorIdOf(req),
        permissions: this.permissionsOf(req),
        idempotencyKey: this.idempotencyKeyOf(req),
        lines: body.lines,
        discountType: body.discountType as DiscountType,
        discountValue: body.discountValue,
        discountReason: body.discountReason,
        notes: body.notes,
        customer: body.customer,
        payment:
          body.payment === undefined
            ? undefined
            : { method: body.payment.method as PaymentMethod, reference: body.payment.reference },
        payments: body.payments?.map((payment) => ({
          method: payment.method as PaymentMethod,
          amount: payment.amount,
          reference: payment.reference,
        })),
        ...this.contextOf(req),
      }),
    );
  });

  /** POST /pos/orders/:id/payment */
  readonly receivePayment: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as ReceivePaymentBody;

    sendSuccess(
      res,
      await this.paymentUseCase.execute({
        actorId: this.actorIdOf(req),
        orderId: this.idOf(req),
        method: body.method as PaymentMethod,
        reference: body.reference,
        ...this.contextOf(req),
      }),
    );
  });

  /** POST /pos/orders/:id/cancel */
  readonly cancel: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as CancelOrderBody;

    sendSuccess(
      res,
      await this.cancelUseCase.execute({
        actorId: this.actorIdOf(req),
        orderId: this.idOf(req),
        reason: body.reason,
        ...this.contextOf(req),
      }),
    );
  });

  /** PATCH /pos/products/:id/availability — the sold-out toggle. */
  readonly setAvailability: RequestHandler = asyncHandler(async (req, res) => {
    const body = req.body as ProductAvailabilityBody;

    sendSuccess(res, await this.products.setAvailability(this.idOf(req), body.isAvailable));
  });

  private idOf(req: Request): string {
    const id: unknown = req.params['id'];

    if (typeof id !== 'string') {
      throw new NotFoundError('Order');
    }

    return id;
  }

  /**
   * The `Idempotency-Key` header, when the caller sent one.
   *
   * Validated here rather than by `validate()`, which covers body, query and params only. A
   * present-but-malformed key is a 422 instead of a silent drop: a client that believes its
   * retries are deduplicated when they are not would double-charge at the counter.
   */
  private idempotencyKeyOf(req: Request): string | undefined {
    const header = req.get('idempotency-key');

    if (header === undefined || header.trim().length === 0) {
      return undefined;
    }

    const result = idempotencyKeySchema.safeParse(header);

    if (!result.success) {
      throw new ValidationError('The submitted data is invalid.', {
        'headers.idempotency-key': result.error.issues.map((issue) => issue.message),
      });
    }

    return result.data;
  }

  private actorIdOf(req: Request): string {
    if (req.user === undefined) {
      throw new UnauthorizedError();
    }

    return req.user.id;
  }

  private permissionsOf(req: Request) {
    if (req.user === undefined) {
      throw new UnauthorizedError();
    }

    return permissionsForRole(req.user.role);
  }

  private contextOf(req: Request): RequestContext {
    return { ipAddress: req.ip, userAgent: req.get('user-agent') };
  }
}
