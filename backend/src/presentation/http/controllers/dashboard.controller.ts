import type { RequestHandler } from 'express';
import type { GetDashboardUseCase } from '../../../core/application/use-cases/dashboard/get-dashboard.use-case.js';
import { UnauthorizedError } from '../../../core/domain/errors/domain-error.js';
import { asyncHandler } from '../../../shared/async-handler.js';
import { sendSuccess } from '../serializers/response.serializer.js';
import type { DashboardQuery } from '../validators/dashboard.validators.js';

/**
 * HTTP adapter for the dashboard.
 *
 * The role comes from the authenticated token, never from the query string: what a user is
 * shown here is an authorisation decision, and one the client must not be able to ask for.
 */
export class DashboardController {
  constructor(private readonly getUseCase: GetDashboardUseCase) {}

  /** GET /dashboard */
  readonly get: RequestHandler = asyncHandler(async (req, res) => {
    const user = req.user;

    if (user === undefined) {
      throw new UnauthorizedError();
    }

    const query = req.query as unknown as DashboardQuery;

    sendSuccess(
      res,
      await this.getUseCase.execute({
        role: user.role,
        userId: user.id,
        // Falls back to the server's day only when the client did not say — see the
        // validator for why that is the worse of the two.
        forDate: query.date ?? new Date(new Date().toISOString().slice(0, 10)),
        windowDays: query.windowDays,
      }),
    );
  });
}
