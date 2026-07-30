import type { Request, RequestHandler } from 'express';
import type { GetAnalyticsUseCase } from '../../../core/application/use-cases/analytics/get-analytics.use-case.js';
import type { IAnalyticsExporter } from '../../../core/application/ports/analytics-exporter.port.js';
import type { AnalyticsGranularity } from '../../../core/domain/repositories/analytics.repository.js';
import type { ReportFormat } from '../../../core/domain/enums/report.enum.js';
import { NotFoundError, UnauthorizedError } from '../../../core/domain/errors/domain-error.js';
import { asyncHandler } from '../../../shared/async-handler.js';
import { sendSuccess } from '../serializers/response.serializer.js';
import type {
  AnalyticsExportQueryInput,
  AnalyticsQueryInput,
} from '../validators/analytics.validators.js';

/**
 * HTTP adapter for analytics.
 *
 * The export deliberately re-runs the same use case rather than accepting a payload from
 * the client. A file that could be built from numbers the browser sent would be a file
 * anyone could put any number into.
 */
export class AnalyticsController {
  constructor(
    private readonly getUseCase: GetAnalyticsUseCase,
    private readonly exporters: readonly IAnalyticsExporter[],
  ) {}

  /** GET /analytics?from=&to=&granularity= */
  readonly get: RequestHandler = asyncHandler(async (req, res) => {
    const query = req.query as unknown as AnalyticsQueryInput;

    sendSuccess(
      res,
      await this.getUseCase.execute({
        from: query.from,
        to: query.to,
        granularity: query.granularity as AnalyticsGranularity,
      }),
    );
  });

  /** GET /analytics/export?format=xlsx|pdf */
  readonly export: RequestHandler = asyncHandler(async (req, res) => {
    const query = req.query as unknown as AnalyticsExportQueryInput;
    const exporter = this.exporters.find((candidate) => candidate.format === query.format);

    if (exporter === undefined) {
      throw new NotFoundError('Export format', String(query.format));
    }

    const snapshot = await this.getUseCase.execute({
      from: query.from,
      to: query.to,
      granularity: query.granularity as AnalyticsGranularity,
    });

    const file = await exporter.export(snapshot, this.nameOf(req));

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.bytes.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);

    res.send(file.bytes);
  });

  private nameOf(req: Request): string {
    if (req.user === undefined) {
      throw new UnauthorizedError();
    }

    return req.user.email;
  }
}

export type { ReportFormat };
