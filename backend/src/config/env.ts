import 'dotenv/config';
import { z } from 'zod';

/**
 * Token lifetimes such as `15m` or `7d`. Validated here rather than trusted,
 * because an unparseable value would otherwise surface as a signing failure on
 * the first login attempt instead of at boot.
 */
const durationSchema = z
  .string()
  .regex(/^\d+\s*(ms|s|m|h|d)?$/, 'Must be a duration such as "900s", "15m", "7d".');

/**
 * Environment contract. Parsed once at startup so a misconfigured deployment
 * fails immediately and loudly rather than at the first request that needs a
 * missing value. Nothing outside this file reads `process.env`.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),

  /** Postgres connection string (Neon in staging/production). */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /**
   * Maximum simultaneous database connections this process may hold.
   *
   * Left unset it defaults to 1 in development and 10 in production, and the gap between
   * those is not a performance tuning choice — it is a correctness one.
   *
   * **The default local database cannot serve concurrent sessions.** `prisma dev` runs
   * PGlite, Postgres compiled to WebAssembly, and multiplexes every TCP connection onto a
   * single backend session. Two connections are not two sessions there. So when Prisma
   * opens a transaction on one connection and issues any other query on another, the
   * `BEGIN` and the unrelated statement interleave inside that one session and corrupt its
   * protocol state — surfacing as `bind message supplies N parameters, but prepared
   * statement "" requires 0`, a null dereference inside the client, or a dropped
   * connection. Measured at 4 concurrent requests: roughly 45% of the non-transactional
   * ones failed. At `max: 1` the driver serialises everything onto one connection, a
   * transaction can never overlap another query, and the failure rate is zero.
   *
   * A real Postgres isolates sessions properly and needs no such restraint, which is why
   * production keeps a real pool.
   *
   * **Raise this if you point development at a real Postgres** — the serialisation is
   * pure cost there, and it also means local load cannot exercise the row-locking that
   * `InventoryItemRepository.adjustQuantity` relies on. See PURCHASES.md and
   * ARCHITECTURE.md for how to run one.
   *
   * The ceiling of 50 is a guard against a typo'd value exhausting the database's own
   * connection budget, which on Neon is small.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).optional(),

  /**
   * How often the low-stock and expiry sweep runs, in minutes. `0` switches it off.
   *
   * Fifteen minutes is chosen against what the alerts are *for*: both lead to a purchase
   * or a write-off, decisions made in hours or days. Sweeping every minute would cost
   * ninety-six times as many queries to shorten a delay nobody would notice.
   *
   * Switching it off is a supported configuration, not a bug — it is what a second API
   * instance should do. The sweep is a singleton by assumption: two instances running it
   * together can both see an item as un-alerted and both write, so exactly one process
   * should have a non-zero interval.
   */
  ALERT_SCAN_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(1440).default(15),

  /**
   * How far ahead an expiry alert looks.
   *
   * A week is long enough to use the stock up or plan around losing it, and short enough
   * that the alert still feels like news when it arrives.
   */
  EXPIRY_ALERT_DAYS: z.coerce.number().int().min(1).max(90).default(7),

  /**
   * How long one alert about an item silences the next.
   *
   * A day, because the underlying conditions persist: an item below its reorder level is
   * still below it fifteen minutes later, and without this the same row would arrive
   * ninety-six times a day until somebody restocked. One reminder a day is a nudge; four
   * an hour is a reason to stop reading the bell.
   */
  ALERT_COOLDOWN_HOURS: z.coerce.number().int().min(1).max(720).default(24),

  /**
   * Signing secrets. Separate secrets per token type means a leaked access
   * token secret cannot be used to mint refresh tokens.
   */
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: durationSchema.default('15m'),
  JWT_REFRESH_EXPIRES_IN: durationSchema.default('7d'),
  JWT_ISSUER: z.string().default('paris-bites-api'),
  JWT_AUDIENCE: z.string().default('paris-bites-web'),

  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  /**
   * Domain appended to a bare login name, so `admin` reaches `admin@parisbites.local`.
   *
   * A local convenience only: it exists so the seeded dev accounts can be reached by typing
   * `admin` or `sunil` instead of a full address forty times a day. Set it to
   * `parisbites.local` in a development `.env`.
   *
   * **Ignored in production**, and not merely by convention — `devLoginDomain` below forces it
   * to `undefined` when `NODE_ENV=production`, so setting it in a production environment has no
   * effect at all. That matters because expanding a bare name is a small widening of what the
   * login endpoint accepts, and the guarantee worth having is that the widening cannot exist on
   * a deployed instance regardless of how its environment is configured.
   */
  DEV_LOGIN_DOMAIN: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9.-]+$/,
      'DEV_LOGIN_DOMAIN must be a bare hostname such as "parisbites.local".',
    )
    .optional(),

  /**
   * Refresh-token cookie attributes.
   *
   * The production default is `SameSite=None; Secure`, which dates from the app and the API
   * being on different registrable domains (Vercel and Render). They no longer are: Vercel
   * rewrites `/api/*` to this service, so the browser sees one origin and the cookie is
   * first-party. `None` is still correct — it means "send in every context", which includes
   * same-site — and is left as the default so a direct-to-Render frontend keeps working.
   *
   * Setting `COOKIE_SAME_SITE=lax` behind the proxy is a small hardening win: it makes the
   * browser itself refuse the cookie on cross-site requests instead of leaving CSRF entirely to
   * `requireFetchIntent`. Do not set it while any client still calls the API cross-origin.
   *
   * Locally both are on `localhost`, where `Lax` works and `Secure` would stop the cookie being
   * stored over plain HTTP — hence the separate defaults per environment.
   */
  COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).optional(),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  /** Leave unset unless the API and app share a parent domain. */
  COOKIE_DOMAIN: z.string().optional(),

  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:4200')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),

  /**
   * How many reverse proxies sit in front of this process, counted from the app outwards.
   *
   * `req.ip` is only as trustworthy as this number, and two things depend on it: the rate
   * limiter's per-client bucket and the address recorded against every login attempt.
   *
   * In production the chain is browser → Vercel's edge (the `/api/*` rewrite in `vercel.json`)
   * → Render's router → here, so two hops belong to us. Set it too low and `req.ip` resolves to
   * Vercel's edge address: every user lands in one rate-limit bucket and the audit trail records
   * a datacentre instead of a device. Set it too high and a client can spoof its address by
   * sending its own `X-Forwarded-For`.
   *
   * Configurable rather than hard-coded because the correct value is a property of the
   * deployment, not of the code — a direct-to-Render setup with no proxy in front wants 1.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().positive().default(2),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Public base URL of the API, used for absolute links in responses. */
  API_URL: z.string().url().default('http://localhost:4000'),
  /** Public base URL of the Angular app, used for e-mail links and redirects. */
  WEB_URL: z.string().url().default('http://localhost:4200'),

  /**
   * The business's own GST state code.
   *
   * Drives the tax split on every purchase: a supplier in this state is billed
   * CGST + SGST, anywhere else is IGST. There is deliberately no default — guessing it
   * would silently misfile every invoice, and the wrong answer is invisible until a
   * return is rejected. Two digits, e.g. "27" for Maharashtra.
   */
  BUSINESS_STATE_CODE: z
    .string()
    .regex(/^\d{2}$/, 'BUSINESS_STATE_CODE must be a two-digit GST state code, e.g. "27".'),

  /**
   * Where uploaded invoice files are written.
   *
   * Relative paths resolve against the process working directory. Note this is local
   * disk: on a platform with an ephemeral filesystem the files do not survive a redeploy.
   * See `IFileStorage` for the swap point.
   */
  UPLOAD_DIR: z.string().min(1).default('./uploads'),

  /** Ceiling on one invoice file. Large enough for a scanned multi-page bill. */
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .default(10 * 1024 * 1024),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    // Thrown before the logger exists, so write straight to stderr and exit.
    process.stderr.write(`\nInvalid environment configuration:\n${details}\n\n`);
    process.exit(1);
  }

  return parsed.data;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

/**
 * The bare-login-name domain, or `undefined` when there is none.
 *
 * Hard-gated on the environment rather than read straight from `env`, so a production
 * deployment that happens to carry `DEV_LOGIN_DOMAIN` still refuses bare names. See the
 * schema entry for why the guarantee is worth the extra export.
 */
export const devLoginDomain: string | undefined = isProduction
  ? undefined
  : env.DEV_LOGIN_DOMAIN;

/** Resolved cookie attributes, with environment-appropriate defaults applied. */
export const cookieOptions = {
  sameSite: env.COOKIE_SAME_SITE ?? (isProduction ? ('none' as const) : ('lax' as const)),
  // `SameSite=None` is invalid without `Secure`, so production must be secure.
  secure: env.COOKIE_SECURE ?? isProduction,
  domain: env.COOKIE_DOMAIN,
} as const;
