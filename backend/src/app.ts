import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import {
  API_BASE_PATH,
  JSON_BODY_LIMIT,
  REQUEST_ID_HEADER,
  REQUESTED_WITH_HEADER,
} from './config/constants.js';
import { env, isProduction } from './config/env.js';
import type { AppContainer } from './infrastructure/container/container.js';
import { createPinoInstance } from './infrastructure/logging/pino-logger.js';
import { errorHandler } from './presentation/http/middlewares/error-handler.middleware.js';
import { notFoundHandler } from './presentation/http/middlewares/not-found.middleware.js';
import { globalRateLimiter } from './presentation/http/middlewares/rate-limit.middleware.js';
import { requestContext } from './presentation/http/middlewares/request-context.middleware.js';
import { createApiRouter } from './presentation/http/routes/index.js';

/**
 * Builds the Express application without binding a port.
 *
 * Separating construction from listening is what makes the app testable — an
 * integration test can drive this instance in-process, and `main.ts` owns the
 * socket and shutdown lifecycle.
 *
 * Middleware order below is load-bearing; see the comments at each step.
 */
export function createApp(container: AppContainer): Express {
  const app = express();

  // TLS terminates at the edge, so without this `req.ip` is a proxy's address — the rate
  // limiter would treat all traffic as one client and `req.protocol` would report http.
  // The hop count is configurable because it depends on the deployment; see `TRUST_PROXY_HOPS`.
  if (isProduction) {
    app.set('trust proxy', env.TRUST_PROXY_HOPS);
  }

  app.disable('x-powered-by');

  // 1. Correlation id first, so every later log line and error carries it.
  app.use(requestContext());

  // 2. Security headers. CSP is left off because this process serves JSON only;
  //    the Angular app sets its own policy at the CDN.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // 3. CORS with an explicit allowlist. Credentials are enabled so the refresh
  //    token can travel as an httpOnly cookie.
  app.use(
    cors({
      origin: (origin, callback) => {
        // Same-origin and server-to-server calls send no Origin header.
        if (origin === undefined || env.CORS_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin "${origin}" is not allowed by CORS policy.`));
      },
      // Required for the httpOnly refresh cookie to travel cross-origin.
      credentials: true,
      /*
       * Must be allowed explicitly: these are non-safelisted, which is exactly why
       * `requireFetchIntent` can rely on the preflight it triggers.
       *
       * `Idempotency-Key` belongs here for a blunter reason — omit it and the browser rejects
       * the POS's order request at the preflight, so the one header that prevents a double
       * charge would stop every order instead.
       */
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'Idempotency-Key',
        REQUESTED_WITH_HEADER,
      ],
      /*
       * `Content-Disposition` is declared here, once.
       *
       * The export controllers used to set `Access-Control-Expose-Headers` themselves,
       * which *replaces* this value rather than adding to it — so on exactly the responses
       * most likely to fail (a large report build), the browser could no longer read
       * `X-Request-Id` and a failed download could not be tied to a server log line.
       */
      exposedHeaders: [REQUEST_ID_HEADER, 'Content-Disposition'],
    }),
  );

  app.use(compression());

  // 4. Body parsing, bounded so a large payload cannot exhaust memory.
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

  // 4b. Cookies — the refresh token arrives this way. Unsigned: the value is a
  //     high-entropy random token verified against its stored digest, so a
  //     signature would add nothing.
  app.use(cookieParser());

  // 5. Request logging. Reuses the correlation id assigned in step 1 so the
  //    access log and application logs join on one key.
  app.use(
    pinoHttp({
      logger: createPinoInstance(),
      // Reuse the id from step 1 so the access log and application logs join on
      // one key rather than pino generating a second, unrelated id.
      genReqId: (req) => (req as { requestId?: string }).requestId ?? 'unknown',
      // Trimmed serializers: the default ones dump every header on every line,
      // which buries the signal and widens the surface for leaking one.
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      // Client errors are expected traffic, not warnings worth paging on.
      customLogLevel: (_req, res, error) => {
        if (error !== undefined && error !== null) return 'error';
        if (res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: {
        // Probes would otherwise dominate the log volume.
        ignore: (req) => req.url?.includes('/health/') ?? false,
      },
    }),
  );

  app.use(globalRateLimiter());

  // 6. Application routes, versioned so a breaking change can ship as /v2
  //    alongside the existing contract.
  app.use(API_BASE_PATH, createApiRouter(container));

  // 7. Unmatched routes, then the single error exit point. Order matters:
  //    the error handler must be last to receive everything above it.
  app.use(notFoundHandler());
  app.use(errorHandler(container.logger));

  return app;
}
