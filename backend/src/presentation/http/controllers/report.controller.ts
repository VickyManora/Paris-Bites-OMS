import type { Request, RequestHandler } from 'express';
import type {
  ExportReportUseCase,
  ListReportsUseCase,
  RunReportUseCase,
} from '../../../core/application/use-cases/reports/run-report.use-case.js';
import type { InventoryLocation } from '../../../core/domain/enums/inventory.enum.js';
import { permissionsForRole } from '../../../core/domain/enums/permission.enum.js';
import type { ReportFormat, ReportId } from '../../../core/domain/enums/report.enum.js';
import { NotFoundError, UnauthorizedError } from '../../../core/domain/errors/domain-error.js';
import type { ReportFilters } from '../../../core/domain/repositories/report.repository.js';
import { asyncHandler } from '../../../shared/async-handler.js';
import { sendSuccess } from '../serializers/response.serializer.js';
import type { ReportExportQuery, ReportQuery } from '../validators/report.validators.js';

/**
 * HTTP adapter for reports.
 *
 * Permissions are derived from the authenticated role, never taken from the request. What
 * a caller may see is an authorisation decision and not something the client gets to ask
 * for — which matters more here than elsewhere, because the answer decides whether cost
 * columns are in the payload at all.
 */
export class ReportController {
  constructor(
    private readonly listUseCase: ListReportsUseCase,
    private readonly runUseCase: RunReportUseCase,
    private readonly exportUseCase: ExportReportUseCase,
  ) {}

  /** GET /reports — the reports this caller may run. */
  readonly list: RequestHandler = asyncHandler(async (req, res) => {
    sendSuccess(res, await this.listUseCase.execute(this.permissionsOf(req)));
  });

  /** GET /reports/:id */
  readonly run: RequestHandler = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ReportQuery;

    sendSuccess(
      res,
      await this.runUseCase.execute({
        id: this.idOf(req),
        permissions: this.permissionsOf(req),
        filters: this.filtersOf(query),
        page: query.page,
        pageSize: query.pageSize,
      }),
    );
  });

  /**
   * GET /reports/:id/export?format=xlsx|pdf
   *
   * `Content-Disposition: attachment` — unlike a purchase invoice, which opens inline, a
   * report is a file you keep, and a spreadsheet rendered in a browser tab is useless.
   */
  readonly export: RequestHandler = asyncHandler(async (req, res) => {
    const query = req.query as unknown as ReportExportQuery;

    const file = await this.exportUseCase.execute({
      id: this.idOf(req),
      format: query.format as ReportFormat,
      permissions: this.permissionsOf(req),
      filters: this.filtersOf(query),
      generatedBy: this.nameOf(req),
    });

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.bytes.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);

    res.send(file.bytes);
  });

  private filtersOf(query: ReportQuery): ReportFilters {
    return {
      search: query.search,
      fromDate: query.fromDate,
      toDate: query.toDate,
      location: query.location as InventoryLocation | undefined,
      supplierId: query.supplierId,
      sortField: query.sortField,
      sortDirection: query.sortDirection,
    };
  }

  private permissionsOf(req: Request) {
    if (req.user === undefined) {
      throw new UnauthorizedError();
    }
    return permissionsForRole(req.user.role);
  }

  private nameOf(req: Request): string {
    return req.user === undefined ? 'Unknown' : req.user.email;
  }

  private idOf(req: Request): ReportId {
    const id: unknown = req.params['id'];

    if (typeof id !== 'string') {
      throw new NotFoundError('Report');
    }

    return id as ReportId;
  }
}
