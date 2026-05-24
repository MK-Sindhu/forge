# Testing

> **Owner subagent:** `test-engineer`
> **Touches:** Test files (Vitest), test utilities, mocks
> **Does NOT touch:** Source code to make tests pass — surfaces bugs back to the dev agent that owns the failing module

## Philosophy

The test-engineer subagent has one rule that overrides everything else:

> **Test against the spec, not the implementation.**

Workflow:

1. Read the PROJECT.md / TRACKER.md spec for the slice
2. Draft test cases from the spec — what should this code do?
3. Only THEN read the implementation, and only to learn import paths and exact function signatures
4. If a test fails: surface the bug back to the dev agent — do not edit source to make tests pass

This catches drift between what was intended (in the spec) and what was built. If the test-engineer rewrites tests to match buggy code, the spec/code gap gets papered over.

## Stack

- **Framework:** Vitest (configured in `vitest.config.ts`)
- **Current state:** 328 tests across 16 test files, all passing on `main`

## File Structure

Tests are colocated with their source files — a `*.test.ts` sits in the same directory as the `route.ts` (or `schema.ts`) it exercises. No separate `tests/` folder exists for these files. The Vitest config (`vitest.config.ts`) includes both `src/**/*.test.ts` and `tests/**/*.test.ts`, but all 16 current test files live under `src/`.

Confirmed colocation example:

```
src/
├── db/
│   ├── schema.ts
│   └── schema.test.ts          ← 1 test
└── app/api/worlds/[id]/likes/
    ├── route.ts
    └── route.test.ts           ← 22 tests
```

## What Gets Tested

| Layer | What to test |
|---|---|
| API routes | Happy path, auth checks, permission checks, suspension guards, edge cases (idempotency, missing fields, malformed input), DB state after the call |
| DB helpers (in `src/lib/`) | Pure function behavior, correct queries, correct error messages |
| React components | Render with various props, optimistic update logic, error states, accessibility basics |
| 3D components | No test files exist for R3F components. `WorldViewer` and all `<Canvas>` content are untested at the unit level. The Vitest `environment: "node"` setting makes WebGL unavailable; testing R3F output is deferred to Phase 2 scope (see bottom of this doc). |
| End-to-end | Unit + integration only. No Playwright or Cypress suite exists. All 311 tests are Vitest route-handler and DB-helper tests. |

## Mocking Patterns

All mocks are applied with `vi.hoisted()` + `vi.mock()` — no MSW, no testcontainers, no real Neon branch.

- **Clerk auth (`@clerk/nextjs/server`):** `vi.mock("@clerk/nextjs/server", () => ({ auth: mockAuth, currentUser: mockCurrentUser }))`. `mockAuth` returns `{ userId: string | null }`; `mockCurrentUser` returns a fake Clerk user object. Reason: Clerk requires live signed cookies and network access that are unavailable in CI.

- **Database (`@/db`):** `vi.mock("@/db", () => ({ db: { ... }, dbPool: { ... } }))`. The mock replicates the Drizzle builder chain — `select().from().where().limit()` — with fine-grained `vi.fn()` spies at the terminal call so individual tests can control what the "query" returns and assert what values were passed. `dbPool.transaction()` receives the real callback and runs it against a fake `tx` object. No real Postgres connection is made. Reason: tests run without `DATABASE_URL`; a real Neon connection would require network + credentials unavailable in CI.

  The `fakeTx` inside the `dbPool.transaction` mock also exposes:
  - `tx.insert(table).values(values)` → records the call via `mockTxInsert(table, values)` and returns `{ onConflictDoNothing: () => Promise.resolve() }` to support the tags insert chain (`tx.insert(tags).values(...).onConflictDoNothing()`).
  - `tx.select(columns).from(table).where(arg)` → calls `mockTxSelect(arg)` (returns `[]` by default; individual tests override with `mockTxSelect.mockResolvedValue([...])`) to support the tag re-select step.
  - `tx.update(table).set(values).where()` → records the call via `mockTxUpdate(table, values)`.

- **Auth helpers (`@/lib/users`):** `vi.mock("@/lib/users", () => ({ requireActiveDbUser: mockFn, requireAdmin: mockFn, getOrCreateDbUser: mockFn }))`. These helpers cross the DB boundary; mocking at this seam keeps tests hermetic. Each test injects either a user row (happy path) or a `NextResponse` (error path — 400 / 403 / 503).

- **R2 (`@/lib/r2`):** `vi.mock("@/lib/r2", () => ({ getPresignedPutUrl: mockFn, headObject: mockFn, publicUrlFor: mockFn, buildGlbKey: mockFn, buildThumbnailKey: mockFn, buildMediaKey: mockFn }))`. `getPresignedPutUrl` returns a predictable URL string; `headObject` returns `{ exists: bool, contentLength: number | undefined }`; `publicUrlFor` returns a deterministic CDN URL from bucket + key. Reason: R2 requires AWS SDK credentials and live network access not available in the test runner.

- **Network / fetch:** no fetch mocking needed — all external I/O goes through the mocked modules above. No MSW is configured.

## Test Inventory by Slice

Per-file test counts verified by `npx vitest run --reporter=json` on commit `127f5d7`. Slice attribution from `git log --follow --diff-filter=A`.

| Slice | Test files added | Test count | Notes |
|---|---|---|---|
| 0 | (infra only — no test files) | — | Vitest + `vitest.config.ts` wired up here |
| 1 | `src/db/schema.test.ts` (1) · `src/app/api/me/route.test.ts` (6) · `src/app/api/uploads/sign/route.test.ts` (39) · `src/app/api/worlds/route.test.ts` (51) · `src/app/api/worlds/[id]/route.test.ts` (28) | **125** | Schema smoke, user bootstrap, R2 presign, world create + GET |
| 2 | (no new test files — Slice 2 media gallery tests are in `worlds/route.test.ts` blocks C/F/G/H added to the Slice 1 file) | — | Media-kind validation, multi-media inserts, per-item HEAD checks covered inside `worlds/route.test.ts` |
| 3 | `src/app/api/worlds/[id]/likes/route.test.ts` (22) · `src/app/api/users/[username]/follow/route.test.ts` (18) | **40** | Like/unlike with recount-from-source, follow/unfollow, self-follow guard, suspension guard, idempotency |
| 4 | `src/app/api/worlds/[id]/comments/route.test.ts` (29) · `src/app/api/comments/[id]/route.test.ts` (9) · `src/app/api/worlds/[id]/repost/route.test.ts` (15) | **53** | Comment CRUD + cursor pagination, delete auth (author or world owner), repost/un-repost idempotency |
| 5 | `src/app/api/worlds/[id]/updates/route.test.ts` (29) · `src/app/api/updates/[id]/route.test.ts` (20) | **49** | World updates POST/GET + cursor pagination, PATCH/DELETE with owner-only authorization |
| 6 | `src/app/api/worlds/[id]/reports/route.test.ts` (11) · `src/app/api/admin/reports/route.test.ts` (13) · `src/app/api/admin/reports/[id]/route.test.ts` (10) · `src/app/api/admin/users/[id]/suspend/route.test.ts` (10) | **44** | Report submit (suspension-exempt safety valve tested explicitly), admin queue + status filter, resolve/dismiss, suspend/unsuspend with self-action guard |
| 7.1 | `src/app/api/worlds/route.test.ts` (Block I — 15 new) · `src/db/schema.test.ts` (2 new assertions) | **+17** | Tag normalization, validation, dedup, char limits, disallowed chars, whitespace stripping, existing-tag reuse; `tags` + `worldTags` schema exports |
| 7.3 | `src/app/api/worlds/[id]/views/route.test.ts` (13 new) · `src/db/schema.test.ts` (1 new assertion) | **+14** | View count auth (401 × 2, 403 suspended), 400 invalid uuid, 404 world not found, happy path insert + recount + update, idempotency (same day no-op still writes recount), 503 DB error; `worldViews` schema export |
| **Total** | **17 files** | **342 tests** | All passing after sub-slice 7.3 view count tests added |

## Common Test Cases for Every API Route

Make sure every new API route has tests for:

- **Auth required** → returns 401/403 when unauthenticated
- **Suspension guard** → suspended user gets 403 on write endpoints (exception: reports — exempt by design)
- **Permission gates** → non-owner can't edit, non-admin can't access admin routes
- **Idempotency** (if applicable) → duplicate calls don't error or double-insert
- **Validation** → malformed input returns 400 with clear error
- **Happy path** → returns expected shape, DB is in expected state

## Boundary Crossings (Past Mistakes)

Twice this session, a backend-dev agent wrote tests alongside the API route instead of leaving them to test-engineer:

1. `/api/worlds/[id]` tests
2. `FeedCard` attribution UI tests alongside the Following feed query

Decision both times: read the work; if quality, accept and mark the test-engineer task as "subsumed." Both times it was quality, so accepted.

**Going forward:** delegation prompts to backend-dev say explicitly "Do not write tests — task X covers them." Reduces boundary creep by 90%.

## Running Tests

```bash
npm test                 # All tests, watch off
npm test -- --watch      # Watch mode
npm test path/to/file    # Single file
npm test -- --coverage   # Coverage report
```

## CI Integration

Tests run on every PR and push to `main` via `.github/workflows/ci.yml`. CI uses placeholder env vars (see `infra.md`). Tests should not depend on real Clerk / R2 / Neon credentials — mock them.

## Phase 2 Testing Considerations

Scene graph API + browser editor introduces:

- **Scene graph schema validation** — every mutation must produce a valid scene graph (Zod schema test)
- **Versioning** — every save produces a new version, history retains correctly
- **Operations vs replacements** — operations apply atomically and produce the same result as a full replacement
- **Backward compat** — legacy `.glb`-only worlds still render correctly

These will be in-scope when Phase 2 starts. Don't write them now.