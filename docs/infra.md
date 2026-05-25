# Infrastructure

> **Owner subagent:** `deploy-ops`
> **Touches:** Vercel, Neon, R2, GitHub Actions, env vars, deploy flow
> **Does NOT touch:** feature code, UI, 3D, API logic

## Stack

| Layer | Service | Notes |
|---|---|---|
| Frontend hosting + API | Vercel | Auto-deploys on push to `main` |
| Database | Neon Postgres | Two clients: HTTP (`db`) and WebSocket (`dbPool`) |
| Object storage | Cloudflare R2 | 2 buckets: `forge-glb`, `forge-media` (public read) |
| Auth | Clerk v7 | Hosted; user rows created on-demand via `getOrCreateDbUser` (no webhook) |
| CI | GitHub Actions | Lint + test + build on PR and push to `main` |
| AI (when used) | Anthropic Claude API | Phase 2 editor assist, Phase 5 full generation |

## Repository Configuration

| File | Purpose |
|---|---|
| `next.config.ts` | Next.js 16 config |
| `drizzle.config.ts` | Drizzle ORM config (points at `src/db/schema.ts`, output to `drizzle/`) |
| `vitest.config.ts` | Test runner config |
| `eslint.config.mjs` | ESLint flat config |
| `tsconfig.json` | TypeScript config |
| `postcss.config.mjs` | Tailwind / PostCSS |
| `.env.example` | Template env vars (commit-safe) |
| `.env.local` | Real secrets (gitignored, mirrored in Vercel dashboard) |
| `.github/workflows/ci.yml` | CI definition |

## Environments

| Env | Where | Vars come from |
|---|---|---|
| Local dev | Your machine | `.env.local` |
| CI | GitHub Actions | Inline placeholders in `ci.yml` (real values not needed for build) |
| Production | Vercel | Vercel dashboard env vars |

### Canonical env vars

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Neon Postgres connection string |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key |
| `CLERK_SECRET_KEY` | Yes | Clerk secret key |
| `R2_ACCOUNT_ID` | Yes | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Yes | R2 S3-compat access key |
| `R2_SECRET_ACCESS_KEY` | Yes | R2 S3-compat secret key |
| `R2_BUCKET_GLB` | Yes | `forge-glb` |
| `R2_BUCKET_MEDIA` | Yes | `forge-media` |
| `R2_PUBLIC_URL_GLB` | Yes | Public base URL for the GLB bucket |
| `R2_PUBLIC_URL_MEDIA` | Yes | Public base URL for the media bucket |

### Important gotcha — env vars are duplicated

Vercel uses real values. CI uses placeholders. They must stay in sync **manually** when a new env var is added. When adding a var:

1. Add to `.env.example` (commit it)
2. Add real value to Vercel dashboard (Production + Preview)
3. Add placeholder to `.github/workflows/ci.yml` if module-level code reads it at build time

### `.env.local` not `.env`

In any tsx script (migrations, smoke tests, etc.):

```ts
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
```

Default `dotenv` doesn't find `.env.local`.

## Database (Neon)

### Two clients

| Client | Type | Use for |
|---|---|---|
| `db` | HTTP | Standard queries, supports `db.query.*` relational queries |
| `dbPool` | WebSocket | Transactions (`tx.insert`, `tx.update` — **not** `tx.query.*`) |

**Gotcha:** `dbPool` doesn't have the Drizzle schema wired into it — `drizzlePool({ client: pool })` is called without the `schema` argument in `src/db/index.ts`. Inside a transaction, use raw `tx.insert(...)`, `tx.update(...)`, `tx.delete(...)`. `tx.query.*` only works on `db`. This is an open limitation: if a route ever needs both a transaction and a relational query in the same operation, pass `schema` to `drizzlePool` the same way `db` does (`drizzleHttp({ client: sql, schema })`).

### Migrations

- **Hand-written**, not generated. `drizzle-kit generate` needs interactive prompts for rename detection that don't work in agent contexts.
- File naming: `drizzle/NNNN_slice_description.sql`
- After writing the SQL, append the entry to `drizzle/meta/_journal.json` manually
- Apply with `npm run db:migrate` (runs `scripts/migrate.ts`)

Current migrations:

```
0000_salty_doctor_faustus.sql
0001_slice1_schema_migration.sql
0002_slice3_follows.sql
0003_slice4_engagement.sql
0004_slice5_world_updates.sql
0005_slice6_moderation.sql
0006_slice7_tags.sql
0007_slice7_search.sql   ← adds worlds.search_vector tsvector + trigger functions + GIN index
0008_slice7_views.sql          ← adds world_views table (viewer_id, world_id, day composite PK + FK constraints + world_views_world_id_idx)
0009_slice7_notifications.sql  ← adds notifications table (user_id, type CHECK, actor/world/comment nullable FKs, read_at) + composite index + partial index WHERE read_at IS NULL
```

**Note on `0007_slice7_search.sql`:** This migration defines three Postgres functions (`worlds_search_vector_build`, `worlds_search_vector_trigger_fn`, `world_tags_search_vector_trigger_fn`) and two triggers (`worlds_search_vector_trigger` BEFORE on `worlds`, `world_tags_search_vector_trigger` AFTER on `world_tags`). When applying to production, all three functions and both triggers must land cleanly — verify with `\df` and `\dT` in psql or a `SELECT proname FROM pg_proc WHERE proname LIKE 'worlds_%';` query after the migration runs.

## Object Storage (R2)

- **Buckets:** `forge-glb` (world `.glb` files), `forge-media` (thumbnails, preview videos, extra images)
- **Access:** public read, presigned PUT for uploads
- **Client:** `src/lib/r2.ts` — **lazy-init S3Client** (doesn't read env at module load)
- **Setup details:** see [`R2_SETUP.md`](./R2_SETUP.md)

### Why lazy-init matters

Vercel build evaluates module-level code. If `r2.ts` read env vars at module load time and they were missing → build breaks. Two fixes are in place:

1. `r2.ts` initializes the S3 client lazily (on first use, not module load)
2. CI workflow has placeholder env vars for R2 to be safe

## CI (GitHub Actions)

`.github/workflows/ci.yml` runs on every PR and push to `main`:

1. Install deps
2. Lint
3. Test (Vitest)
4. Build (Next.js)

CI uses placeholder env vars (R2 keys, Clerk keys, DB URL) sufficient for compile-time evaluation. The build passes without real credentials because of the lazy-init pattern in `r2.ts` and the way Next.js handles runtime env.

## Deploy Flow

1. `git push origin main`
2. Vercel detects the push, runs build with production env vars
3. If build passes, deploy is live within ~1–2 minutes
4. CI runs separately on GitHub Actions (not blocking on Vercel)
5. Founder does production smoke test in browser
6. Update `TRACKER.md` to flip 🟢 → ✅ for the slice

### Migration deploy flow

Migrations apply to the **dev DB on local machine**, not auto-deployed. Production DB migration is manual:

```bash
# Local — apply to .env.local DATABASE_URL
npm run db:migrate

# Production — override DATABASE_URL inline so migrate.ts connects to the prod DB
DATABASE_URL="postgresql://..." npm run db:migrate
```

## Clerk v7 Config

- App configured in Clerk dashboard
- No Clerk webhook is wired. There is no `/api/webhooks/clerk` route. User rows are created on-demand by `getOrCreateDbUser` in `src/lib/users.ts`, called from every authenticated route on first access.
- `<ClerkProvider>` wraps the app in `src/app/layout.tsx`
- Sign-in / sign-up routes: `/sign-in` and `/sign-up` (catch-all segments: `src/app/sign-in/[[...sign-in]]`, `src/app/sign-up/[[...sign-up]]`)
- Quirks documented in `frontend.md`

## Health Check Commands

Run anytime to verify infra state:

```bash
npm run build            # Clean build
npm test                 # 328 tests pass
npm run db:smoke         # All 11 tables present, current row counts (scripts/smoke.ts)
git status               # Clean tree
git log --oneline -5     # Recent commits
```

## Production Dashboards

- **Vercel:** https://vercel.com/mk-sindhu-projects/forge
- **Neon:** https://console.neon.tech (forge project)
- **Cloudflare R2:** dash.cloudflare.com → R2 (forge-glb + forge-media)
- **GitHub Actions:** https://github.com/MK-Sindhu/forge/actions
- **Clerk:** dashboard.clerk.com

## Analytics (Vercel Web Analytics)

Wired via `@vercel/analytics/next`. The `<Analytics />` component lives
in the root layout (`src/app/layout.tsx`), mounted as the last child of
`<body>`. No env vars to set. No third-party signup beyond Vercel itself.

### To enable in production

1. Vercel dashboard → forge project → **Analytics** tab → **Enable**.
2. That's it. The next deploy automatically starts capturing pageviews.
3. Verify by loading the site once, then refresh the Analytics dashboard
   in Vercel within ~30 seconds.

### What's tracked

Default Vercel Web Analytics: pageviews + referrer + page-load
performance metrics + country (derived from IP, then IP discarded).
Cookieless. No cross-site tracking. No personal data leaves the
browser/edge.

### Hobby tier limits

Free on Vercel Hobby with the documented event limit (currently 2.5k
events/month at time of wiring — check the Vercel dashboard for the
current limit). For early launch this is plenty. If FORGE exceeds the
limit, upgrade to Pro ($20/mo) or move to a self-hosted alternative.

### Local dev

`<Analytics />` is a no-op in local dev unless explicitly enabled. You
will not see traffic show up while running `npm run dev` — that's
intentional.

### Privacy Policy obligation

Vercel Web Analytics is already documented in the Privacy Policy §4
(third parties) + §6 (cookies). If you ever add custom events via
`@vercel/analytics`'s `track()` function (e.g. to measure specific
button clicks), update §4 to describe the events before that deploy
goes live.

## When Things Break

| Symptom | Likely cause | Fix |
|---|---|---|
| Build fails on Vercel with missing env error | New env var added without updating Vercel dashboard | Add to Vercel Production + Preview |
| CI build fails with missing env error | New env var added without placeholder in `ci.yml` | Add placeholder |
| `db.query.*` works locally, fails in transaction | Using `dbPool`/`tx` for relational queries | Use raw `tx.insert/update/delete`, only use `db` for `query.*` |
| Migration script silently fails | `.env.local` not loaded | Add `dotenv.config({ path: ".env.local" })` |
| R2 upload returns 403 | Bucket policy or presigned URL expired | Check bucket public-read + URL expiry window |