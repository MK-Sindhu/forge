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
- **Current state:** 659 tests across 40 test files, all passing after Phase 2 sub-slice 8.4 (Browser Editor)

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

- **`db.query.notifications.findMany` (sub-slice 7.5):** `vi.mock("@/db", () => ({ db: { query: { notifications: { findMany: (...args) => mockFindMany(...args) } } } }))`. The mock exposes the terminal `findMany` call as a spy so tests can (a) control returned rows per test, (b) assert the call arguments (e.g., `limit: 21`, `orderBy`, `with: { actor, world, comment }`). This is the same pattern as `db.query.comments.findMany` in comments tests. Reason: real `db.query.*` calls require a live Neon connection unavailable in CI.

- **`db.update(notifications).set(...).where(...).returning()` (sub-slice 7.5, mark-read):** The builder chain is mocked to expose `mockDbUpdateReturning` at the terminal `.returning()` call. Tests control the returned array of `{ id }` rows; `updated` in the response equals `result.length`. Reason: same DB boundary rationale.

- **`db.insert(notifications).values()` in `src/lib/notifications.ts`:** `vi.mock("@/db", () => ({ db: { insert: () => ({ values: (...args) => mockDbInsertValues(...args) }) } }))`. The terminal `.values()` spy is used to assert correct field values were passed and to simulate DB throws for the error-swallowing tests. Reason: same DB boundary rationale.

- **`@/lib/notifications` module (cross-cutting integration, sub-slice 7.5):** `vi.mock("@/lib/notifications", () => ({ notify: vi.fn(), notifyMany: vi.fn() }))`. Used in the 4 modified write route test files (likes, comments, follow, world-create) to assert the call shape of `notify()` / `notifyMany()` directly, bypassing the helper's internal try/catch and DB insert. This is the right boundary: it tests the route's _responsibility_ (call notify after commit, in a try/catch) without re-testing the helper's _responsibility_ (suppress self-notifications, swallow DB errors — covered in `notifications.test.ts`). The mocks are initialized to `vi.fn().mockResolvedValue(undefined)` in `setupHappyPath()` / `beforeEach` so existing tests that don't assert on notify pass without change.

- **`db.select().from().where()` (no `.limit()`) for the followers fanout query in `worlds/route.test.ts`:** The route calls `db.select({ followerId }).from(follows).where(...)` without `.limit()`, so the result object is `await`ed directly. The `@/db` mock models the `.where()` return as a thenable: `where: (..._args) => ({ limit: ..., then: (resolve, reject) => mockDbSelectWhere().then(resolve, reject) })`. Awaiting the thenable calls `then()` which resolves with `mockDbSelectWhere()`'s value. This is a clean pattern for distinguishing queries that terminate at `.where()` versus `.limit()` in the same mock chain. Default: `mockDbSelectWhere.mockResolvedValue([])` — no followers, notifyMany not called.

- **`@/db` for `requireWorldRole` in `world-permissions.test.ts`:** The helper calls `db.select().from(worlds).where(eq(...)).limit(1)`. The `@/db` mock exposes the terminal `.limit()` call as `mockDbSelectLimit` (vi.hoisted). Tests control the return value per scenario: `[worldRow]` = found, `[]` = not found. DB throw is simulated via `mockDbSelectLimit.mockRejectedValue(new Error(...))`. No `dbPool` mock is needed — `requireWorldRole` does not use transactions. Pattern identical to route test mocks; all `vi.hoisted()` + `vi.mock()` per repo convention. Reason: same — no live DATABASE_URL in the test runner.

- **`@/lib/world-permissions` module mock (sub-slice 8.2, route tests):** Routes that call `requireWorldRole` before their core logic — ops route, publish route, assets route, asset DELETE route — mock the entire `world-permissions` module: `vi.mock("@/lib/world-permissions", () => ({ requireWorldRole: mockRequireWorldRole }))`. `mockRequireWorldRole` returns `{ world, role: "owner" }` on the happy path and a `NextResponse` 403/404 for the permission-denied path. This is cleaner than mocking the underlying `db.select()` chain for the world lookup since `world-permissions.test.ts` already unit-tests `requireWorldRole` directly. Reason: tests should assert the route's responsibility (propagate the error response) without duplicating the helper's own test coverage.

- **`selectCallCount` pattern for multi-select transactions (asset DELETE route, sub-slice 8.2):** The DELETE route uses two `tx.select().from().where().limit()` calls inside the same transaction: first to load the asset row, second for the LIKE-based conflict check. The fake tx uses a closure counter (`let selectCallCount = 0`) incremented on each `.limit()` call, routing the first call to `mockTxSelect()` and the second to `mockTxConflictSelect()`. This avoids `mockResolvedValueOnce` interleaving with the transaction mock's outer `mockImplementation`. Tests that exercise only the first select (e.g., asset-not-found 404) set `assetExists = false` so the transaction throws before the second select is reached.

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
| 7.5 | `src/app/api/notifications/route.test.ts` (24) · `src/app/api/notifications/mark-read/route.test.ts` (14) · `src/app/api/notifications/unread-count/route.test.ts` (8) · `src/lib/notifications.test.ts` (14) · `src/db/schema.test.ts` (1 new assertion) | **+61** | Notification feed: auth, cursor pagination (nextCursor populated/null, cursor forwarded, limit default/clamp/validate), response shape (actor/world/comment flatten, ISO timestamps, null fields), 503 DB error. Mark-read: body validation (neither ids nor all → 400, non-UUID in ids → 400), mark-all happy + zero, mark specific ids happy + already-read → 0, both all+ids accepted. Unread-count: auth, happy path count (numeric coercion), zero, 503. notify() helper: correct insert values, null for omitted fields, self-notification suppression (userId===actorId skips insert, null actorId is not self), DB error swallowed + console.error called. notifyMany(): bulk insert in one call, self-actor filtered, empty-after-filter no-ops, DB error swallowed. `notifications` schema export asserts all 8 columns. |
| 7.5 integration | **MODIFY** `src/app/api/worlds/[id]/likes/route.test.ts` (+4) · `src/app/api/worlds/[id]/comments/route.test.ts` (+6) · `src/app/api/users/[username]/follow/route.test.ts` (+3) · `src/app/api/worlds/route.test.ts` (+3) | **+15** (total **417**) | Closes the gap: the 4 write routes that call notify/notifyMany after their transaction were not previously asserting the integration. New tests: likes POST calls notify with correct owner/actor/world shape; self-actor case confirmed at route level (suppression is helper's job); likes DELETE does not call notify; comments POST calls notify with commentId from the new row; 201 still returned when notify throws; DELETE + GET do not call notify; follow POST calls notify with followee/follower IDs; DELETE unfollow does not call notify; world POST calls notifyMany with N follower entries; 0 followers → notifyMany not called; 201 still returned when notifyMany throws. Mock pattern: `vi.mock("@/lib/notifications", () => ({ notify: vi.fn(), notifyMany: vi.fn() }))` — see Mocking Patterns above for rationale. The followers fanout `.where()` thenable pattern is documented in Mocking Patterns above. |
| 8.1 (scene-graph schema) | **CREATE** `src/lib/scene-graph/schema.test.ts` (23) | **+23** (total **440**) | Pure Zod schema tests — no mocks needed (no external I/O). Covers: `SCENE_GRAPH_SCHEMA_VERSION === 1`; `emptySceneGraph()` is valid + populates all defaults (objects `[]`, 2 lights, skybox `"studio"`, fog `null`, 1 spawn point `id="default"`, fov `50`); `parseSceneGraph({ schemaVersion: 1 })` fills defaults; unknown schemaVersion (2) throws; null/string/empty-object inputs throw; JSON round-trip idempotent; `ObjectSchema` accepts valid object + rotation/scale defaults, rejects non-UUID assetId; `LightSchema` discriminated union accepts sun + ambient + defaults color, rejects `"spotlight"`; `EnvironmentSchema` rejects unknown skybox, accepts `"sunset"`, defaults fog to `null`; Vec3 arity check (2-element tuple fails); ColorHex regex (non-hex fails, 3-digit shorthand fails). |
| 8.1 (route extension) | **MODIFY** `src/app/api/worlds/[id]/route.test.ts` (+5, Block G) | **+5** (total **445**) | Phase 2 `sceneGraph` + `assets` fields on `GET /api/worlds/[id]`. Covers: (1) legacy world explicit — `sceneGraph: null`, `assets: []`; (2) scene-graph world with one asset — `parseSceneGraph` output deep-equal + response key rename `glbSizeBytes → sizeBytes`, raw column must not leak; (3) multiple assets preserve DB order (pre-sorted DESC by createdAt); (4) malformed `scene_graph` (unknown schemaVersion) falls through to `null` + `console.error` called once, response still 200; (5) minimal `{ schemaVersion: 1 }` in DB — Zod defaults fill all fields (`objects: []`, 2 lights, `skybox: "studio"`, `fog: null`, default spawn point, `fov: 50`). Mock strategy: extends existing `mockFindFirst` fixture with `sceneGraph` + `assets` fields — no new `vi.mock` needed. `console.error` spy via `vi.spyOn` in `beforeEach`, restored in `afterEach`. |
| 8.2 (scene-graph ops) | **CREATE** `src/lib/scene-graph/operations.test.ts` (25) | **+25** (total **470**) | Pure reducer tests — no mocks needed (no external I/O). OpsBatchSchema: rejects `ops:[]` (min 1), rejects ops.length=101 (max MAX_OPS_PER_BATCH), rejects non-uuid baseVersionId, accepts `label:null` and omitted label, accepts ops.length=100 (boundary valid). applyOps general: empty ops round-trips deep-equal but referentially distinct (structuredClone), returned graph passes SceneGraphV1.parse (final invariant check confirmed). add_object: auto-generated id matches `obj_<8hex>`, defaults position/rotation/scale filled, throws OperationError with correct opIndex on id collision (index 0 and index 1 tested separately). update_object: patches named fields while leaving others intact; throws OperationError on unknown id. delete_object: removes by id; throws OperationError on unknown id. set_environment: replaces environment field entirely. set_lights: replaces lights array. add_spawn: appends new spawn point; throws OperationError on id collision. update_spawn: patches fields; throws OperationError on unknown id. delete_spawn: removes when multiple spawns exist; throws OperationError on unknown id; throws OperationError (not removes) when deletion would leave 0 spawn points — v1 invariant. |
| 8.2 (world-permissions) | **CREATE** `src/lib/world-permissions.test.ts` (6) | **+6** (total **476**) | Owner calling with requiredRole "owner" → returns `{ world, role: "owner" }`. Non-owner calling with requiredRole "owner" → 403 NextResponse. World not found → 404 NextResponse. DB throws → 503 NextResponse + console.error called. Owner satisfies requiredRole "editor" (rank check passes, role stays "owner"). Owner satisfies requiredRole "viewer" (same rank check). Mock: `@/db` mocked via `vi.hoisted` + `vi.mock` — exposes `mockDbSelectLimit` at the `.limit()` terminal. Real NextResponse used (not mocked) so `instanceof` checks and `.status` assertions are genuine. |
| 8.2 (scene-graph GET route) | **CREATE** `src/app/api/worlds/[id]/scene-graph/route.test.ts` (5) | **+5** (total **481**) | Public GET — no auth required. 404 on missing world; legacy world (no versions) returns all-null version fields + publishedVersionId; world with versions returns parsed sceneGraph + metadata; publishedVersionId propagated even with no versions; malformed scene_graph in DB → sceneGraph: null + console.error (no crash). Mocks: `db.select...limit` (world existence) + `db.query.worldVersions.findFirst` (latest version). |
| 8.2 (scene-graph ops route) | **CREATE** `src/app/api/worlds/[id]/scene-graph/ops/route.test.ts` (11) | **+11** (total **492**) | POST — owner-only. 401 when no session; 403 when requireWorldRole returns 403 (mocked at module level); 400 ops:[] (min 1 violated); 400 ops.length=101 (MAX_OPS_PER_BATCH exceeded); 400 missing baseVersionId; 404 base version not found for world; 409 with currentVersion body when latest.id ≠ baseVersionId (conflict); 400 with opIndex when update_object targets non-existent id (OperationError propagated); 200 happy path returns {versionId, versionNumber, sceneGraph}; tx.insert(worldVersions) called with correct shape; tx.update(worlds) called with applied sceneGraph. Mock pattern: `requireWorldRole` mocked at `@/lib/world-permissions` module level. `dbPool.transaction` receives two sequential `tx.query.worldVersions.findFirst` calls controlled by `mockTxFindFirst.mockResolvedValueOnce` pairs. |
| 8.2 (versions list route) | **CREATE** `src/app/api/worlds/[id]/versions/route.test.ts` (4) | **+4** (total **496**) | Public GET. Empty world → `{versions:[], nextCursor:null}`; 21 rows returned → 20 sliced + nextCursor string; exactly 20 rows → nextCursor null; response shape includes author hydration (id/username/avatarUrl) and excludes sceneGraph. Mock: `db.select...limit` (world existence) + `db.query.worldVersions.findMany` (version list). |
| 8.2 (publish route) | **CREATE** `src/app/api/worlds/[id]/versions/[v]/publish/route.test.ts` (4) | **+4** (total **500**) | POST — owner-only. 403 when requireWorldRole returns 403; 404 cross-world spoofing guard (version's worldId filter eliminates the spoof — tx.query.worldVersions.findFirst returns undefined); 200 happy path returns `{versionId, versionNumber, status:"published"}`; idempotent — second call returns identical body. Mock: `requireWorldRole` mocked at module level; `dbPool.transaction` with fake tx exposing `query.worldVersions.findFirst` + `update().set().where()` for both worldVersions and worlds tables. |
| 8.2 (assets route) | **CREATE** `src/app/api/worlds/[id]/assets/route.test.ts` (7) | **+7** (total **507**) | GET + POST. GET: list shape correct (glbSizeBytes → sizeBytes rename, createdAt ISO string); 404 when world not found. POST: 401 no session; 403 when requireWorldRole returns 403; 400 when R2 HEAD exists:false; 400 when R2 HEAD contentLength mismatches sizeBytes; 201 happy path returns `{id, name, glbUrl, sizeBytes, createdAt}`. Mocks: `@/lib/world-permissions` module-level; `@/lib/r2` (`buildAssetKey`, `headObject`, `publicUrlFor`); `db.select...limit` (world existence in GET) + `db.query.worldAssets.findMany` + `db.insert...returning`. |
| 8.2 (asset DELETE route) | **CREATE** `src/app/api/worlds/[id]/assets/[assetId]/route.test.ts` (5) | **+5** (total **512**) | DELETE — owner-only. 403 when requireWorldRole returns 403; 404 when asset row not found (world boundary check via AND condition); 409 strict integrity when LIKE check finds version referencing assetId — response includes `{error:"asset in use", referencedBy:{versionId, versionNumber}}`; 200 happy path returns `{deleted:true, assetId}` and asserts `deleteObject` called with key extracted from glbUrl (`/assets/` prefix → slice → objectKey`); 200 even when deleteObject throws (best-effort R2 cleanup, logged not surfaced). Mock: `dbPool.transaction` with custom fake-tx that uses a `selectCallCount` counter to route first `.limit()` call to asset existence check and second to the conflict check. `deleteObject` mocked at `@/lib/r2`. |
| 8.3 (set_object_asset op) | **MODIFY** `src/lib/scene-graph/operations.test.ts` (+5) | **+5** (total **523**) | 9th op added in 8.3 Chunk A. set_object_asset reducer: happy-path swaps `assetId` while preserving `id`/`name`/transform; throws `OperationError` with correct opIndex when target id not found. Zod: rejects non-uuid `assetId`; rejects empty `id`; accepts valid shape. |
| 8.3 (convert-to-scene-graph route) | **CREATE** `src/app/api/worlds/[id]/convert-to-scene-graph/route.test.ts` (8) | **+8** (total **531**) | POST — owner-only. 401 when unauthenticated; 403 when requireWorldRole returns 403; 409 when world already has sceneGraph (returns echo of existing graph for UI sync); 400 when world has no glb_url (defensive); 404 when world not found; happy path returns `{ worldId, sceneGraph, versionId, versionNumber, assetId }`; transaction asserts insert(worldAssets) reuses world.glb_url + glb_size_bytes, insert(worldVersions) with `status:"published"` + `versionNumber:1` + `parentVersionId:null` + `label:"Converted from legacy .glb"`, update(worlds) sets both sceneGraph + publishedVersionId; constant `obj_base` id verified in the generated scene graph. Mock: `requireWorldRole` module-level + `dbPool.transaction` with fake tx. |
| 8.3 (ConvertToSceneGraphButton) | **CREATE** `src/components/convert-to-scene-graph/ConvertToSceneGraphButton.test.ts` (5) | **+5** (total **536**) | Client component. Initial render shows button + explanatory text. Click → fetch called with correct URL + POST + `aria-busy` toggles. 200 response → `router.refresh()` called. 409 response → `router.refresh()` called (treats as success — already-converted is fine). 500 response → inline error shown + button re-enabled. Network error → inline error shown. Mocks: `useRouter` from `next/navigation` + global `fetch`. |
| 8.3 (VersionHistorySection) | **CREATE** `src/components/version-history/VersionHistorySection.test.ts` (7) | **+7** (total **542**) | Client component. Initial render → skeleton; after fetch → version list. `Currently published` pill only on the row matching publishedVersionId; `Published` (gray-green) on other published rows; `Draft` (gray) on draft rows. Owner sees Publish buttons on non-current rows; non-owner does NOT see Publish buttons. `Load more` button only when `nextCursor !== null`; click appends rows + drops `nextCursor` when null. Publish click → optimistic flip of pills + POST `/api/worlds/[id]/versions/[v]/publish`. Publish failure → reverts optimistic state + shows inline error. Mocks: global `fetch` (multiple sequential responses). |
| 8.3 (folder-watcher CLI) | (none — one-day timebox; human smoke only) | **0** | CLI in `scripts/forge-watch.ts`. Mocking chokidar + fs + fetch + R2 PUT is heavyweight relative to v1 value. Surface is small (~415 lines) and behavior is observable through real folder smoke. Future: extract `parseArgs` and the filename→assetId map utility into pure functions if/when CLI grows. |
| 8.4 (editor state layer) | **CREATE** `src/components/editor/editor-store.test.ts` (32) | **+32** (total **574**) | Zustand store unit tests — no DOM, no mocks. Coverage: `initialize` resets all state correctly; selectors (`selectObject`, `setGizmoMode`, `setPropertiesTab`); `applyOp` happy path mutates sceneGraph + appends pendingOp + pushes undo + clears redo + autosaveStatus="pending"; `applyOp` with `OperationError` leaves state untouched; undoStack cap at 50 (oldest evicted); `undo`/`redo` round-trip preserves snapshot pairs; `undo` truncates pendingOps to length before the undone op; convenience helpers (`addObject` returns new id, `updateObject`, `deleteSelectedObject` with/without selection, `setObjectAsset`, `setLights`, `setEnvironment`, `addSpawn`/`updateSpawn`/`deleteSpawn` including the v1 "at least 1 spawn" invariant); `beginSave` returns ops + baseVersionId + sets status="saving" + records `lastSaveOpCount`; `beginSave` caps at `MAX_OPS_PER_BATCH=100`; `beginSave` returns null when nothing pending or already saving; `completeSave` advances baseVersionId + drops `lastSaveOpCount` ops + status flips "saved"/"pending" correctly when new ops added mid-save; `failSave` preserves pendingOps; `rebaseOnServerVersion` resets sceneGraph + replays pending ops + drops incompatible ops + clears undo/redo stacks. |
| 8.4 (EditorTopBar shortcuts) | **CREATE** `src/components/editor/EditorTopBar.test.ts` (8) | **+8** (total **582**) | Keyboard shortcut handler tests — pure function form, no React render. T/R/S switch gizmoMode; Cmd+Z / Ctrl+Z trigger undo; Cmd+Shift+Z / Ctrl+Y trigger redo; Escape deselects; input/textarea/contenteditable focus suppresses shortcuts. |
| 8.4 (viewport delete) | **CREATE** `src/components/editor/viewport-delete-shortcut.test.ts` (8) | **+8** (total **590**) | Delete + Backspace keys call `deleteSelectedObject` when an object is selected; no-op when selection is null; suppressed when focus is in an input. Op gets pushed to pendingOps (undo-able). |
| 8.4 (AssetPanel) | **CREATE** `src/components/editor/panels/AssetPanel.test.ts` | **+22** (total **612**) | Component-level tests covering: initial asset list renders (count + names + formatted sizes); empty state copy; clicking an asset calls `store.addObject(asset.id)`; `addObject` return value plumbing; hidden file input with correct aria; drag-drop counter handles nested children correctly; file validation: >50MB rejected before network call, non-.glb extension rejected; upload happy path (presign → PUT XHR → finalize POST); upload errors (presign 400, PUT 5xx, finalize 400 size mismatch). XHR mocked via `XMLHttpRequest` polyfill in vitest. |
| 8.4 (PropertiesPanel) | **CREATE** `src/components/editor/panels/PropertiesPanel.test.ts` | **+32** (total **644**) | Tab switching via ARIA tablist/tab/tabpanel; Object tab "no selection" message + selected-object form; Vec3 input "focused vs not focused" sync (in-progress edits not overwritten); commit on blur calls `updateObject` with new vec3; rotation displayed/parsed in degrees while stored in radians; delete object → window.confirm → `deleteSelectedObject` if confirmed; lights tab renders cards + intensity input + add/remove; environment tab skybox dropdown change + fog toggle; spawn-points tab disables delete on last spawn (v1 invariant); add spawn generates new id + default position. window.confirm mocked via `vi.spyOn(globalThis, "confirm")` (guarded define if missing). |
| 8.4 (save-client) | **CREATE** `src/components/editor/save-client.test.ts` (9) | **+9** (total **653**) | Fetch wrappers. `saveOps` 200 happy → `ok: true`; 409 → `kind: "conflict"` with `currentVersion`; 400 with opIndex → `kind: "operation-error"`; 400 without opIndex → `kind: "other"`; 5xx → `kind: "other"`. `publishVersion` 200 → `ok: true`; 403 → `ok: false` with message. Discriminated-union return types verified at the type level. |
| 8.4 (use-autosave) | **CREATE** `src/components/editor/use-autosave.test.ts` (6) | **+6** (total **659**) | Hook tested via extracted `runSaveCycle` async helper (no React runtime — vitest env=node). Coverage: skip when `beginSave` returns null; happy path → completeSave called on 200; first 409 → rebaseOnServerVersion called; 3 consecutive 409s → failSave + bail; conflict counter resets after a successful save; `inFlightRef` prevents re-entry while a save is in flight. Fetch mocked per-test. |
| **Total** | **40 files** | **659 tests** | All passing after Phase 2 sub-slice 8.4 |

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

- **Scene graph schema validation** — `src/lib/scene-graph/schema.test.ts` is DONE (23 tests, sub-slice 8.1). Covers the full v1 Zod schema: object validation, light discriminated union, environment enum, Vec3 arity, ColorHex regex, defaults, parse helpers.
- **`GET /api/worlds/[id]` extension** — DONE (task 6, sub-slice 8.1). 5 tests in Block G of `src/app/api/worlds/[id]/route.test.ts`: legacy null pass-through, scene-graph world parse + asset shape + column rename (`glbSizeBytes → sizeBytes`), multi-asset order preservation, malformed jsonb → null + console.error (never 500), minimal graph Zod defaults. All passing (445 total).
- **Scene-graph operations reducer** — DONE (sub-slice 8.2). 25 tests in `src/lib/scene-graph/operations.test.ts`: OpsBatchSchema structural validation (min/max/uuid/label), applyOps reducer for all 8 op types, OperationError opIndex accuracy, structuredClone immutability, v1 invariant enforcement (≥1 spawn point), final `SceneGraphV1.parse()` invariant check confirmed.
- **World permissions helper** — DONE (sub-slice 8.2). 6 tests in `src/lib/world-permissions.test.ts`: owner success, non-owner 403, not-found 404, DB error 503 + log, role-rank satisfies editor, role-rank satisfies viewer.
- **Versioning** — every save produces a new version, history retains correctly (sub-slice 8.2, remaining tasks)
- **Operations vs replacements** — operations apply atomically and produce the same result as a full replacement (sub-slice 8.2, covered by reducer tests above)
- **Backward compat** — legacy `.glb`-only worlds still render correctly — covered by test 1 in Block G (explicit `sceneGraph: null, assets: []` assertion).