# Deployment — Phase 1 (testing)

Getting the app onto free infrastructure so it can be tried on a real phone, over real mobile data,
from outside the shop.

| Component | Platform | Tier |
| --- | --- | --- |
| Frontend | Vercel | Free (Hobby) |
| Backend | Render | Free web service |
| Database | Neon | Free |

**This is a testing setup, not a production one.** The free tiers have three properties that matter
for a till, and they are described honestly in [What free costs you](#what-free-costs-you) at the
end. Read that before letting anyone take a real order on it.

---

## The order matters

The three services reference each other, so there is one sequence that avoids doing anything twice:

```
Neon  ──DATABASE_URL──▶  Render  ──API URL──▶  frontend code  ──▶  Vercel
                            ▲                                        │
                            └──────────── CORS_ORIGINS ──────────────┘
```

The loop at the bottom is why the last step goes back to Render: the backend cannot be told which
origin to trust until the frontend has a URL.

### The four steps, and the three things between them

The deploy itself really is four steps. What catches people out is that each one has a small
prerequisite, and skipping any of the three leaves a deployment that looks finished and does not
work:

| | Step | Must happen first |
| --- | --- | --- |
| 1 | Push to GitHub | — *(already done)* |
| — | **Create the Neon database, migrate and seed it** | **Render has no database without this. It will deploy, boot, and fail readiness.** |
| 2 | Deploy the backend on Render | Neon connection string in hand |
| — | **Change `apiBaseUrl` to the Render URL and push** | The committed value still points at a dead Railway host, and Angular bakes it in at build time — it cannot be a Vercel setting |
| 3 | Deploy the frontend on Vercel | the step above, committed |
| — | **Set `CORS_ORIGINS` and `WEB_URL` on Render to the Vercel URL** | Otherwise the browser blocks every request and sign-in silently does nothing |
| 4 | Send Sunil the URL | all of the above |

No domain, no SSL setup, no Docker, no nginx, no CI — both platforms give you HTTPS on their own
subdomain, which is all the PWA needs to install on his phone.

---

## 0. Before you start

The repository is on GitHub at `VickyManora/Paris-Bites-OMS` with a clean working tree, which is all
both platforms need — each builds from a branch.

Two things to confirm:

- **`backend/.env` is git-ignored.** It is (`backend/.gitignore:5`). Nothing in this guide asks you
  to commit a secret.
- **Node 22.** `engines` requires `>=22` and `.nvmrc` pins 22. Both platforms are told this below;
  neither defaults to it.

---

## 1. Database — Neon

1. Sign in at **neon.tech** and create a project. Name it `paris-bites`, pick the region closest to
   the shop (`ap-south-1` Mumbai for India), and leave the Postgres version at the default.
2. On the project dashboard open **Connection string** and copy the **pooled** one. It looks like:

   ```
   postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
   ```

   **Take the pooled endpoint — the hostname with `-pooler` in it.** The API opens a connection pool
   of its own, and a free Neon project has a small direct-connection budget that a restarting
   container will exhaust. The pooler exists for exactly this.

3. Keep that string somewhere for the next two steps. It is the whole of your database credentials.

## 2. Schema and seed data

Run these **from your laptop**, pointed at Neon. A free Render instance has no shell, so this is the
practical way to migrate — and it is the same command a release step would run.

```bash
cd backend

# One shell, one variable. Do not put this in .env — that file is your local database.
export DATABASE_URL='postgresql://…-pooler….neon.tech/neondb?sslmode=require'

npx prisma migrate deploy    # creates every table; safe to re-run
npm run prisma:seed          # accounts, inventory master, menu
```

`migrate deploy` applies the committed migrations in order and never generates new ones, which is
what you want against a shared database.

Confirm it worked before moving on:

```bash
npx prisma studio            # opens a browser against Neon
```

You should see `users` (2), `products` (16), `inventory_items` (40).

**Change the seeded passwords.** `prisma/seed.ts` reads `SEED_ADMIN_PASSWORD` and
`SEED_MANAGER_PASSWORD` from the environment, and accounts are keyed on email and **never
overwritten** — so set them *before* you seed, or change them in-app afterwards. Do not deploy with
whatever is in your local `.env`.

## 3. Backend — Render

### The quick way: the committed blueprint

`render.yaml` at the repo root already declares the service — root directory, build and start
commands, health check path, region, and which variables to prompt for.

**New** → **Blueprint** → pick this repo → Render reads the file and asks only for the five values it
should never store in git:

| Prompt | Value |
| --- | --- |
| `DATABASE_URL` | the pooled Neon string from step 1 |
| `JWT_ACCESS_SECRET` | `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | run it again — a **different** value |
| `CORS_ORIGINS` | `http://localhost:4200` for now; corrected in step 6 |
| `WEB_URL` | same, corrected in step 6 |

That is the whole of step 2. Skip to step 4.

The blueprint exists mostly for one field: **`rootDir: backend`**. Getting that wrong is the most
common way this deploy fails, and it fails with a confusing missing-dependency error rather than
anything that names the cause.

### The manual way

If you would rather use the form:

1. At **render.com** → **New** → **Web Service** → connect the GitHub repo.
2. Settings:

   | Field | Value |
   | --- | --- |
   | Name | `paris-bites-api` |
   | Root Directory | `backend` |
   | Runtime | Node |
   | Build Command | `npm ci && npm run build` |
   | Start Command | `npm start` |
   | Health Check Path | `/api/v1/health/live` |
   | Instance Type | Free |

   **Root Directory is `backend`.** This repo is deliberately not an npm workspace — the two apps
   install separately — so a build from the repo root finds no `package.json` worth building.

   **Health check is `/live`, not `/ready`.** `/live` reports only that the process is up; `/ready`
   opens a database connection. Pointing the platform's restart trigger at `/ready` turns a brief
   Neon hiccup into a restart loop, which is the note in `health.routes.ts`.

3. Environment variables. Four are **required** — the app refuses to start without them — and the
   rest have defaults that are wrong for production:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | the pooled Neon string from step 1 |
   | `JWT_ACCESS_SECRET` | a fresh random string (see below) |
   | `JWT_REFRESH_SECRET` | a **different** fresh random string |
   | `BUSINESS_STATE_CODE` | `27` (Maharashtra — decides CGST/SGST vs IGST) |
   | `NODE_ENV` | `production` |
   | `NODE_VERSION` | `22` |
   | `CORS_ORIGINS` | `http://localhost:4200` for now — corrected in step 6 |
   | `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | only if you intend to seed from here |

   Generate the secrets properly — they sign your sessions:

   ```bash
   openssl rand -base64 48    # run twice, use a different value for each
   ```

   `NODE_ENV=production` is doing more than it looks. It switches the refresh cookie to
   `SameSite=None; Secure`, which is **required** because the browser will be on `vercel.app` while
   the API is on `onrender.com` — a cross-site cookie. Without it, sign-in appears to succeed and
   then every refresh silently fails.

4. Deploy, and wait for the first build. Then check it is alive:

   ```bash
   curl https://paris-bites-api.onrender.com/api/v1/health/live
   ```

   Note the URL Render gives you — the next step needs it.

## 4. Point the frontend at the API

**This is a code change, not a setting.** Angular bakes its configuration into the bundle at build
time, so the API URL cannot be an environment variable on Vercel. `frontend/src/environments/environment.ts`
still points at the old Railway host:

```ts
apiBaseUrl: 'https://paris-bites-api.up.railway.app/api/v1',
```

Change it to your Render URL, keeping the `/api/v1` suffix:

```ts
apiBaseUrl: 'https://paris-bites-api.onrender.com/api/v1',
```

Commit and push. Every future change of API host needs a rebuild — there is no runtime switch.

## 5. Frontend — Vercel

1. At **vercel.com** → **Add New** → **Project** → import the same repo.
2. Set **Root Directory** to `frontend`. Everything else comes from the committed
   `frontend/vercel.json`: build command, output directory, SPA rewrites, security headers and cache
   policy are all already declared there, so leave the framework preset as **Other** and do not
   override them.
3. No environment variables. The frontend has none — see step 4.
4. Deploy. Note the URL, e.g. `https://paris-bites-oms.vercel.app`.

## 6. Close the loop

Back on Render, correct two variables now that the frontend has an address:

| Key | Value |
| --- | --- |
| `CORS_ORIGINS` | `https://paris-bites-oms.vercel.app` |
| `WEB_URL` | `https://paris-bites-oms.vercel.app` |

`CORS_ORIGINS` is an **exact-match allowlist** — no wildcards, no trailing slash. Get it wrong and
the browser blocks every request before it is sent, which shows up as a login that does nothing.

Save; Render redeploys. If you want Vercel preview deployments to work too, add their origins as a
comma-separated list.

## 7. Verify

Work through these in order — each one fails differently.

```bash
API=https://paris-bites-api.onrender.com

curl $API/api/v1/health/live      # process up
curl $API/api/v1/health/ready     # database reachable — proves DATABASE_URL
curl $API/api/v1                  # {"name":"Paris Bites…","businessStateCode":"27"}
```

Then in a browser, on the Vercel URL:

1. **Sign in.** If the form submits and returns you to the login page, it is CORS or the cookie —
   open the network tab and look for a blocked preflight.
2. **Reload the page.** Still signed in means the cross-site refresh cookie is working. Bounced to
   login means `NODE_ENV` is not `production` on Render.
3. **Open `/pos/new`.** Sixteen products with photos.
4. **Add two Premium bowls.** The cart should show `Any 2 Premium Bowls −₹79`.
5. **Take a cash order.** Then check `/pos/orders`.
6. **Open it on your phone**, over mobile data rather than the shop wifi. That is the whole point of
   this phase.

---

## What free costs you

Three limits, and they are not equally forgivable for a till.

### Render free sleeps after ~15 minutes idle

The instance stops, and the next request wakes it. **The cold start is typically 30–60 seconds.**

This is the one that matters. The app's request timeout is **30 seconds**
(`environment.requestTimeoutMs`), so the first order after a quiet spell can time out before the
server answers. The counter sees "The server is taking too long to respond" and taps **Try again**,
which works — the idempotency key means the retry cannot double-charge, and by then the instance is
awake.

So it degrades safely rather than dangerously, but a customer is standing there. Two options:

- **Keep it warm.** A free cron (cron-job.org, UptimeRobot) hitting `/api/v1/health/live` every 10
  minutes. Note this consumes the 750 free instance-hours/month, which is roughly one always-on
  service — fine for one, not for two.
- **Pay.** Render's cheapest paid instance removes the sleep entirely. For a real till this is the
  honest answer.

Neon free also autosuspends (~5 minutes), adding a second or two on the first query. Much less
disruptive, and the pooled endpoint handles it.

### Uploaded invoices do not survive a restart

Purchase invoice files are written to local disk (`LocalFileStorage`, `UPLOAD_DIR`). Render's free
filesystem is **ephemeral** — every deploy and every wake-from-sleep starts a fresh container, and
the files are gone. The purchase records survive; the attachments do not.

Fine for testing. Before real use, this needs object storage (S3, R2, Supabase Storage) behind the
existing `IFileStorage` port — which is why that port exists.

### One instance only

The alert sweep that generates low-stock and expiry notifications assumes a single instance
(`ALERT_SCAN_INTERVAL_MINUTES`, default 15). On free that is guaranteed. If you ever scale to two,
set the interval to `0` on all but one, or they will both write the same alerts —
see [NOTIFICATIONS.md](./NOTIFICATIONS.md).

---

## When something is wrong

| Symptom | Cause |
| --- | --- |
| Login does nothing, network tab shows a blocked preflight | `CORS_ORIGINS` does not exactly match the Vercel origin |
| Login succeeds, reload signs you out | `NODE_ENV` is not `production`, so the cookie is not `SameSite=None; Secure` |
| Every API call 404s | `apiBaseUrl` missing the `/api/v1` suffix, or still pointing at Railway |
| First request of the day times out | Render cold start — see above |
| `/health/ready` 503s but `/live` is fine | `DATABASE_URL` wrong, or Neon suspended and slow to wake |
| Build fails on Render with a missing package | Root Directory is not `backend` |
| Deep links 404 on Vercel | Root Directory is not `frontend`, so `vercel.json` was never read |
| Product images 404 | They live in `frontend/public/products` and ship with the frontend build — check the build log copied them |

---

## After this phase

In rough order of what you will feel first:

1. **A paid Render instance**, to remove the cold start.
2. **Object storage** for invoice attachments.
3. **A CI pipeline** — typecheck, lint and both test suites currently run only on your laptop, so
   nothing stops a broken build reaching either platform.
4. **A custom domain** on both, which also makes the cookie same-site and removes a whole class of
   browser-policy risk.
