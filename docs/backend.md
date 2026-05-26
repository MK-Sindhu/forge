# Backend

> **Owner subagent:** `backend-dev`
> **Touches:** API routes (`src/app/api/`), DB schema (`src/db/schema.ts`), migrations, auth wiring, R2 upload signing, helpers in `src/lib/`
> **Does NOT touch:** UI components, 3D code

## Stack

- **Framework:** Next.js 16 App Router API routes (`src/app/api/**/route.ts`)
- **ORM:** Drizzle
- **DB:** Neon Postgres (see `infra.md` for HTTP vs WebSocket clients)
- **Storage:** Cloudflare R2 (see `infra.md`)
- **Auth:** Clerk v7 — server-side via `auth()` and `currentUser()` (both async)
- **Validation:** Zod (`zod@^4.4.3`, confirmed in `package.json`)

## File Structure

```
src/
├── app/api/              # API routes
│   ├── auth/             # (Clerk handles most; webhooks if any)
│   ├── uploads/sign/     # POST — presigned R2 URL (kinds: glb, thumbnail, image, video, asset)
│   ├── worlds/           # CRUD + likes + comments + reposts + reports + updates + scene-graph API
│   │   └── [id]/
│   │       ├── scene-graph/
│   │       │   ├── route.ts   # GET — latest scene graph + version metadata (public, Phase 2)
│   │       │   └── ops/       # POST — apply scene-graph op batch (owner-only, Phase 2, Chunk D2)
│   │       ├── versions/
│   │       │   ├── route.ts   # GET — paginated version history (public, Phase 2)
│   │       │   └── [v]/publish/  # POST — publish a specific version (owner-only, Chunk D2)
│   │       └── assets/
│   │           ├── route.ts       # GET (public) + POST (owner-only, record asset row, Chunk D2)
│   │           └── [assetId]/     # DELETE — strict-integrity asset removal (owner-only, Chunk D2)
│   ├── users/            # Profile + follow
│   ├── admin/            # Admin-only: reports queue, suspensions
│   ├── comments/         # DELETE single comment
│   ├── updates/          # PATCH / DELETE single update
│   └── notifications/    # GET list, POST mark-read, GET unread-count (Slice 7.5)
├── db/
│   └── schema.ts         # Drizzle schema — single source of truth for tables
└── lib/
    ├── users.ts          # Auth helpers (getOrCreateDbUser, requireAdmin, requireActiveDbUser)
    ├── r2.ts             # R2 client (lazy-init), presigned URLs, key builders, deleteObject
    ├── world-permissions.ts  # requireWorldRole helper (Phase 2)
    ├── scene-graph/
    │   ├── schema.ts     # SceneGraphV1 Zod schema, parseSceneGraph, emptySceneGraph
    │   └── operations.ts # Op types, applyOps reducer, OpsBatchSchema (Phase 2)
    └── format-relative.ts # "5m ago" timestamps (used by frontend too)
```

## Database Schema (Current — 15 Tables)

Authoritative source: `src/db/schema.ts`. This section is a reference summary.

### `users`
Synced from Clerk. Source of truth for app-level user state.

Key columns: `id`, `clerk_id`, `username`, `email`, `avatar_url`, `tos_accepted_at`, `is_admin`, `suspended_at`, `created_at`.

### `worlds`
The core entity. Each row = one published world.

Key columns: `id`, `user_id`, `title`, `description`, `glb_url`, `glb_size_bytes`, `views` (int, default 0), `created_at`.
Counters (denormalized, recount-from-source pattern): `likes_count`. Note: `comment_count` and `repost_count` are **not** stored on this table — they are computed from the `comments` and `reposts` tables at query time. There is no top-level `thumbnail_url`; thumbnails live in `world_media` with `type = 'thumbnail'`.

Phase 2 columns (Phase 2.1):
- `scene_graph` (jsonb, nullable) — NULL = legacy GLB-only world. Holds the latest draft if a draft newer than published exists, else the latest published scene graph. Renderer branches on this column.
- `published_version_id` (uuid, nullable) — FK → `world_versions.id` ON DELETE SET NULL. Set by the 8.2 publish endpoint; NULL until a world has been published via the scene-graph API.

Drizzle relations (Phase 2.1 additions): `assets: many(worldAssets)`, `versions: many(worldVersions, { relationName: "worldVersion" })`, `publishedVersion: one(worldVersions, { ..., relationName: "publishedVersion" })`.

### `world_media`
Optional extra media on a world (preview video, up to 4 extra images).

### `likes`
`(user_id, world_id)` — composite PK. CASCADE delete.

### `follows`
`(follower_id, followee_id)` — composite PK. CASCADE delete. CHECK constraint prevents self-follow at DB level.

### `comments`
On worlds. `id`, `world_id`, `user_id`, `body`, `created_at`. Author OR world-owner can delete. (Column is `user_id`, not `author_id`.)

### `reposts`
`(user_id, world_id)` — idempotent. Self-repost allowed.

### `world_updates`
Owner-only timeline on a world. Text only in v1.

### `reports`
Moderation queue. Unique constraint on `(reporter_id, world_id)`. CHECK enums on `reason` and `status`. `resolved_by_id` ON DELETE SET NULL.

### `tags`
Slice 7.1. Free-form creator tags. `id` (uuid PK), `name` (text, NOT NULL, UNIQUE), `created_at`. Named CHECK constraint `tags_name_check` enforces `length(name) BETWEEN 1 AND 32 AND name = lower(name)`. Max 5 per world is an API-layer concern — the DB allows more.

Accepted characters: `[a-z0-9_-]` (regex validated in `POST /api/worlds`). Emoji, spaces, and `#` are rejected at the route level.

### `world_tags`
Slice 7.1. Join table between `worlds` and `tags`. Composite PK on `(world_id, tag_id)`. Both FKs are CASCADE DELETE. Index `world_tags_tag_id_idx` on `tag_id` for "all worlds with tag X" queries. `onConflictDoNothing` used on insert (idempotent tag assignment).

### `world_views`
Slice 7.3. Per-user-per-day view deduplication table. Composite PK on `(viewer_id, world_id, day)` (Postgres `date` type, UTC `YYYY-MM-DD`). Both FKs are CASCADE DELETE. Index `world_views_world_id_idx` on `world_id` for efficient recount.

Anonymous views are intentionally ignored (locked decision, PROJECT.md §7). Only signed-in, active users increment `worlds.views`.

No Drizzle relations are defined — this table is internal and never queried via `db.query` relational helpers. The recount-from-source pattern (same as likes) writes to `worlds.views` in the same transaction.

### `notifications`
Slice 7.5. In-app notification feed. One row per notification event.

Key columns: `id` (uuid PK), `user_id` (FK → users, CASCADE), `type` (text with CHECK), `actor_id` (nullable FK → users, CASCADE), `world_id` (nullable FK → worlds, CASCADE), `comment_id` (nullable FK → comments, CASCADE), `created_at`, `read_at` (null until marked read).

`type` CHECK constraint: `IN ('like', 'comment', 'follow', 'new_world')`.

Indexes:
- `notifications_user_id_created_at_idx` — `(user_id, created_at DESC)` for the feed query
- `notifications_user_id_unread_idx` — PARTIAL `(user_id) WHERE read_at IS NULL` for the cheap unread-badge count

Drizzle relations: `recipient` (→ users, `relationName: "notificationRecipient"`), `actor` (→ users, `relationName: "notificationActor"`), `world` (→ worlds), `comment` (→ comments). Back-relations on `usersRelations`: `receivedNotifications` and `actedNotifications`.

Self-notifications (userId === actorId) are suppressed in the `notify()` helper — no DB CHECK for this.

### `world_assets`
Phase 2.1. Per-world reusable `.glb` assets that compose into scene graphs. Scoped to a single world in Phase 2; cross-world asset library is Phase 5.

Key columns: `id` (uuid PK), `world_id` (FK → worlds, CASCADE), `uploader_id` (FK → users, RESTRICT — preserves upload history even if user is deleted), `name` (text), `glb_url` (text), `glb_size_bytes` (int), `kind` (text, default `'glb'`), `created_at`.

CHECK constraint `world_assets_kind_check`: `kind IN ('glb')`.

Index `world_assets_world_id_created_at_idx`: `(world_id, created_at DESC)`.

Drizzle relations: `world: one(worlds)`, `uploader: one(users)`.

### `world_versions`
Phase 2.1. Immutable scene-graph snapshots — every save creates a new row, full history retained.

Key columns: `id` (uuid PK), `world_id` (FK → worlds, CASCADE), `author_id` (FK → users, RESTRICT), `version_number` (int), `scene_graph` (jsonb, NOT NULL), `status` (text, default `'draft'`), `label` (text, nullable), `parent_version_id` (uuid, nullable self-reference FK → `world_versions.id` ON DELETE SET NULL), `created_at`.

CHECK constraint `world_versions_status_check`: `status IN ('draft', 'published')`.
UNIQUE constraint `world_versions_world_version_unique`: `(world_id, version_number)`.

Indexes:
- `world_versions_world_id_version_idx` — `(world_id, version_number DESC)` for version history queries.
- `world_versions_world_id_status_idx` — `(world_id, status)` for "find latest published" lookups (added 8.2).
- `world_versions_parent_version_id_idx` — `(parent_version_id)` for version-tree traversal (added 8.2; used by 8.5 conversion tool).

Drizzle relations: `world: one(worlds, { relationName: "worldVersion" })`, `author: one(users)`, `parent: one(worldVersions, { relationName: "parent" })` (self-reference), `publishedFor: one(worlds, { relationName: "publishedVersion" })`.

### `worlds.search_vector` (DB-only, not in Drizzle schema)
Slice 7.2. `tsvector` column added directly to the `worlds` table via migration `0007_slice7_search.sql`. **This column is intentionally absent from `src/db/schema.ts`.** It is Postgres-managed — triggers populate and maintain it automatically. Application code never writes to it directly. Drizzle queries against `worlds` simply don't see this column (no TS errors, no runtime errors). Queries that need to search use raw `sql` template literals: `sql\`search_vector @@ websearch_to_tsquery('english', ${q})\``.

## Auth Helpers (`src/lib/users.ts`)

Three helpers, used everywhere. Pick the right one for the situation.

| Helper | Returns | Use when |
|---|---|---|
| `getOrCreateDbUser()` | The DB user row (creates from Clerk if missing) | Any authenticated handler that needs the DB user |
| `requireAdmin()` | DB user OR throws 403 | Admin routes — does the active-user check too |
| `requireActiveDbUser()` | DB user (active, not suspended) OR throws 403 | Write endpoints — blocks suspended users from likes, uploads, comments, follows, etc. |

## World Permission Helper (`src/lib/world-permissions.ts`)

Phase-3-ready role gate for world-scoped write endpoints.

```ts
requireWorldRole(
  worldId: string,
  dbUser: DbUser,
  requiredRole: WorldRole   // "owner" | "editor" | "viewer"
): Promise<WorldWithRole | NextResponse>
```

Returns `{ world: WorldRow, role: WorldRole }` on success. Returns `NextResponse` with status 404 (world missing), 403 (not the owner or insufficient role), or 503 (DB error) on failure. Callers check `instanceof NextResponse` before destructuring.

Phase 2: only the `"owner"` role exists (world.userId === dbUser.id). Phase 3 will extend the internal role-lookup block with a `world_collaborators` query; all call sites stay unchanged.

`requiredRole` is the **minimum** acceptable role (`owner >= editor >= viewer`).

**Usage pattern:**
```ts
const roleResult = await requireWorldRole(worldId, dbUser, "owner");
if (roleResult instanceof NextResponse) return roleResult;
const { world, role } = roleResult;
```

Exported types: `WorldRole`, `WorldRow` (`typeof worlds.$inferSelect`), `WorldWithRole`.

### Suspension guard pattern

12 write endpoints use `requireActiveDbUser()` to block suspended users. The **report endpoint is exempt** (safety valve — a suspended user can still flag content). That's the only exception. New write endpoints should use `requireActiveDbUser` by default.

## Common Patterns

### Presigned upload flow

1. Client calls `POST /api/uploads/sign` with file kind (`glb`, `thumbnail`, `image`, `video`, `asset`)
2. Server returns presigned PUT URL + the eventual public URL
3. Client uploads directly to R2 (bypasses our server)
4. Client calls `POST /api/worlds` (or `POST /api/worlds/[id]/assets` in Phase 2) with the resulting URLs
5. Server `HEAD`s each R2 key to verify the upload succeeded, then transactionally inserts the relevant rows

**Phase 2 `kind: "asset"` specifics:**
- Body must include `assetId: uuid` (client-generated) AND `worldId: uuid` (ownership scope).
- Server verifies `worldId` belongs to the current user; returns 404 if world missing, 403 if world belongs to another user.
- R2 key is `buildAssetKey(clerkUserId, assetId)` → `assets/{userId}/{assetId}/asset.glb` in the `glb` bucket.
- Same content types + 50 MB cap as `kind: "glb"`.

### Recount-from-source for counters

When a like/comment/repost is added or removed, the count is **recomputed** from the source table in the same transaction, not incremented/decremented. This prevents drift on race conditions.

```ts
// pseudo
await db.transaction(async (tx) => {
  await tx.insert(likes).values({ user_id, world_id });
  const count = await tx.select({ c: count() }).from(likes).where(eq(likes.world_id, world_id));
  await tx.update(worlds).set({ like_count: count[0].c }).where(eq(worlds.id, world_id));
});
```

### Transactions

Use `dbPool` for transactions. **Inside the transaction**, both raw `tx.insert/update/delete` and `tx.query.*` are available — the schema is wired into `dbPool` (`drizzlePool({ client: pool, schema })`, fixed in 8.2 2026-05-26). See `infra.md` for the full two-client description.

### Cursor pagination

Used for comments, admin reports queue, update timelines. Pattern:

- Take a `cursor` query param (the last `id` or `created_at` from the previous page)
- Take a `limit` (default 20, max 50)
- Return `nextCursor` in the response (null if no more)
- Order by `created_at DESC, id DESC` for stable pagination

No shared helper has been extracted. Cursor pagination is open-coded per route. Each implementation follows the same pattern: parse `cursor` as an ISO 8601 string, convert to `Date`, apply `lt(createdAt, cursorDate)`, fetch `limit + 1` rows, set `nextCursor` to the last row's `createdAt.toISOString()` if `rows.length > limit`, else `null`. See `src/app/api/worlds/[id]/comments/route.ts`, `src/app/api/worlds/[id]/updates/route.ts`, and `src/app/api/admin/reports/route.ts` for the three canonical examples.

### Idempotency

`POST/DELETE /api/worlds/[id]/repost`, `POST/DELETE /api/users/[username]/follow`, `POST /api/worlds/[id]/likes` are all idempotent — repeated calls don't error or duplicate. Use `ON CONFLICT DO NOTHING` (or equivalent) in the SQL.

### Permission checks

Owner-only mutations (world update edit/delete, comment delete by author, etc.) check `world.user_id === currentUser.id` (or `comment.author_id === currentUser.id`) **inside the transaction**, not before. Avoids TOCTOU.

## API Route Inventory

Verified by walking `src/app/api/` (15 `route.ts` files as of Slice 6). `/api/feed` and `/api/users/[username]` are server-rendered pages, not API routes — they are not listed here.

| Method | Path | Auth | What it does | Slice |
|---|---|---|---|---|
| GET | `/api/me` | required | Returns (or creates) the DB user row for the signed-in Clerk user | 0 |
| POST | `/api/uploads/sign` | required | Returns presigned R2 PUT URL; `kind` enum extended with `"asset"` in Phase 2 (`assetId` + `worldId` ownership check required for that kind) | 1, 8.2 |
| POST | `/api/worlds` | required, active | Create a world (HEADs R2 keys, transactional insert); accepts optional `tags` array (max 5, normalized + validated); inserts `tags` + `world_tags` in the same transaction; fans out `new_world` notifications to followers post-commit | 1, 7.1, 7.5 |
| GET | `/api/worlds/[id]` | public | Joins media + author + tags + assets; includes `isLikedByCurrentUser`, `isRepostedByCurrentUser`; response includes `tags: { name: string }[]`; Phase 2 additions: `sceneGraph: SceneGraphV1 \| null` (parsed defensively; null = legacy or parse failure) and `assets: { id, name, glbUrl, sizeBytes }[]` (empty array for legacy worlds) | 1, 7.1, 8.1 |
| POST | `/api/worlds/[id]/likes` | required, active | Like (idempotent, transactional recount); notifies world owner post-commit | 3, 7.5 |
| DELETE | `/api/worlds/[id]/likes` | required, active | Unlike | 3 |
| POST | `/api/users/[username]/follow` | required, active | Follow (idempotent, rejects self-follow); notifies followee post-commit | 3, 7.5 |
| DELETE | `/api/users/[username]/follow` | required, active | Unfollow | 3 |
| POST | `/api/worlds/[id]/comments` | required, active | Add comment; notifies world owner post-commit | 4, 7.5 |
| GET | `/api/worlds/[id]/comments` | public | Paginated (cursor, ISO 8601 `createdAt`) | 4 |
| DELETE | `/api/comments/[id]` | required, author OR world-owner | Delete comment | 4 |
| POST | `/api/worlds/[id]/repost` | required, active | Repost (idempotent) | 4 |
| DELETE | `/api/worlds/[id]/repost` | required, active | Un-repost | 4 |
| POST | `/api/worlds/[id]/updates` | required, world-owner | Post a text update | 5 |
| GET | `/api/worlds/[id]/updates` | public | Paginated (cursor) | 5 |
| PATCH | `/api/updates/[id]` | required, world-owner | Edit update (sets `edited_at`) | 5 |
| DELETE | `/api/updates/[id]` | required, world-owner | Delete update | 5 |
| POST | `/api/worlds/[id]/views` | required, active | Record a view (idempotent per user+world+day); recounts `worlds.views` in a transaction | 7.3 |
| POST | `/api/worlds/[id]/reports` | required (suspension-EXEMPT) | File a report | 6 |
| GET | `/api/admin/reports` | admin | Paginated queue, status filter | 6 |
| PATCH | `/api/admin/reports/[id]` | admin | Resolve / dismiss | 6 |
| POST | `/api/admin/users/[id]/suspend` | admin | Suspend (blocks self-action) | 6 |
| DELETE | `/api/admin/users/[id]/suspend` | admin | Unsuspend | 6 |
| GET | `/api/notifications` | required, active | Cursor-paginated notification feed; joins actor, world, comment; newest first | 7.5 |
| POST | `/api/notifications/mark-read` | required, active | Mark specific ids or all unread as read; scoped to own notifications only | 7.5 |
| GET | `/api/notifications/unread-count` | required, active | Cheap unread badge count via partial index | 7.5 |
| GET | `/api/worlds/[id]/scene-graph` | public | Latest scene graph for a world + version metadata (`versionId`, `versionNumber`, `status`, `publishedVersionId`). Defensive parse — returns `sceneGraph: null` on parse failure rather than 500. Legacy worlds (no `world_versions` rows) return all version fields as null. | 8.2 |
| GET | `/api/worlds/[id]/versions` | public | Cursor-paginated list of `world_versions` rows (newest first); excludes `sceneGraph` JSONB — too large for list. Each row includes `author: { id, username, avatarUrl }`. | 8.2 |
| GET | `/api/worlds/[id]/assets` | public | All `world_asset` rows for a world (newest first, capped at 100); maps `glbSizeBytes` → `sizeBytes` in response. | 8.2 |
| POST | `/api/worlds/[id]/scene-graph/ops` | required, owner | Apply a batch of scene-graph ops (`OpsBatchSchema`) on top of `baseVersionId`. Returns new `{ versionId, versionNumber, sceneGraph }`. 409 with `currentVersion` body on conflict. 400 with `opIndex` on invalid op. | 8.2 D2 |
| POST | `/api/worlds/[id]/versions/[v]/publish` | required, owner | Mark a specific version as published; sets `worlds.published_version_id`. Idempotent. | 8.2 D2 |
| POST | `/api/worlds/[id]/assets` | required, owner | Record a `world_assets` row after client has PUT the file to R2. HEADs R2 to verify upload + size; 400 on mismatch. Returns 201 `{ id, name, glbUrl, sizeBytes, createdAt }`. | 8.2 D2 |
| DELETE | `/api/worlds/[id]/assets/[assetId]` | required, owner | Strict-integrity delete: 409 if any `world_versions.scene_graph` references the asset. Post-commit best-effort R2 cleanup. Returns `{ deleted: true, assetId }`. | 8.2 D2 |
| POST | `/api/worlds/[id]/convert-to-scene-graph` | required, owner | Convert a legacy GLB-only world to a scene-graph world. Reuses existing `glb_url` — no upload or file copy. Inserts a `world_assets` row, builds a 1-object `SceneGraphV1` wrapping the existing GLB, inserts a `world_versions` row (`status=published`, `versionNumber=1`), and sets `worlds.scene_graph` + `worlds.published_version_id`. Returns `{ worldId, sceneGraph, versionId, versionNumber, assetId }`. 409 if already converted. Idempotent in the sense that a second call returns 409 — the first call cannot be undone via API. See `docs/scene-graph-api.md` §10.a for the full conversion flow. | 8.3 |

## CLI Scripts

### `scripts/forge-watch.ts` (Phase 2, 8.3 Chunk D)

The folder-watcher CLI — the "edit in Blender, save the .glb, it appears in FORGE" workflow.

**Invocation:**
```bash
npm run forge:watch -- \
  --world-id=<uuid> \
  --folder=<local-path> \
  --session=<clerk-session-cookie> \
  [--base-url=http://localhost:3000]
```
`--session` can also be supplied via `FORGE_SESSION` env var.

**Auth:** Cookie-based only (v1). The user copies the `__session` cookie from browser DevTools and passes it here. The script sets `Cookie: __session=<value>` on every API request. On 401, it prints a clear message and exits.

**What it does:**
1. Validates args + resolves the folder path.
2. `GET /api/worlds/[id]/scene-graph` — checks the world exists and is scene-graph (not legacy).
3. `GET /api/worlds/[id]/assets` — loads the existing asset name map (lowercase basename-without-ext → assetId).
4. Starts chokidar (`awaitWriteFinish: { stabilityThreshold: 500 }`) watching for `.glb` changes.
5. On `add`: presigns + uploads + finalizes asset row + posts `add_object` op at origin.
6. On `change`: presigns + uploads a NEW asset (old row kept for version history), then posts `set_object_asset` ops for all matching scene objects.
7. On `unlink`: prints a warning, removes from local map, does NOT delete from the world.
8. On 409 conflict from `/ops`: retries once with a fresh `baseVersionId` from the conflict body.
9. All ops are serialized via a simple async queue (no concurrent POSTs to same world).
10. SIGINT/SIGTERM → clean chokidar close + exit 0.

**Key design decisions:**
- Files are read into a Buffer (not streamed) — max 50 MB per R2 cap, acceptable for .glb assets.
- Old `world_assets` rows are intentionally kept on change — they are referenced by past `world_versions` (history is immutable).
- Auto-delete on `unlink` is intentionally NOT implemented — a folder rename would destroy a world otherwise.
- No dotenv load — this script does NOT access the DB directly; it only calls the FORGE HTTP API.

**See:** `scripts/forge-watch.md` for user-facing documentation (session cookie steps, event glyphs, known limitations).

### `scripts/seed-worlds.ts` / `scripts/seed-worlds-direct.ts` — Bulk Seeding (Launch Ops Tool)

`scripts/seed-worlds.ts` is a CLI tool for batch-uploading worlds before public launch. It reuses the existing API surface with no new routes:

1. Calls `POST /api/uploads/sign` (with `kind`, `worldId`, `contentType`, `sizeBytes`, and `mediaId` for image/video) to get each presigned R2 PUT URL.
2. PUTs each file body directly to R2 (same as the browser upload flow — bytes never touch the server).
3. Calls `POST /api/worlds` with the resulting object keys, metadata, and `tosAccepted: true`.

Auth: passes `Authorization: Bearer <session_token>` on every request. Clerk's `auth()` reads the token from the `Authorization` header (the header is parsed identically to the `__session` cookie JWT). The session token = the `__session` cookie value copied from browser DevTools.

Key notes for this route:
- `/api/uploads/sign` requires `worldId` (UUID v4) in the body — the script generates a single UUID per world and threads it through both the sign call and the worlds call so R2 key paths align.
- `POST /api/worlds` enforces exactly one thumbnail in the `media` array — the script requires `thumbnailPath` in the manifest and throws if absent.
- Rate limit on `/api/uploads/sign`: the route has a TODO for rate-limiting but no implementation yet. Sequential uploads at ~1/world avoids the concern for now; raise this before adding parallelism.

See `scripts/seed-worlds/README.md` for setup + auth instructions.

## Scene-graph JSONB structure (`src/lib/scene-graph/schema.ts`)

The `worlds.scene_graph` column is a nullable `jsonb` column (NULL = legacy single-GLB world). When present, the column always contains a v1 scene-graph document validated by the Zod schema in `src/lib/scene-graph/schema.ts`.

The schema defines a versioned JSON document with:
- `schemaVersion: 1` — literal discriminant. When v2 ships, extend `SceneGraphAny` to a `z.discriminatedUnion("schemaVersion", ...)`.
- `objects: ObjectSchema[]` — positioned `.glb` assets; each references a `world_assets.id` (`assetId`) plus `position`, `rotation` (Euler radians), and `scale` Vec3 tuples.
- `lights: LightSchema[]` — discriminated union of `sun` (directional) and `ambient` light types; world-scope only in v1.
- `environment: EnvironmentSchema` — `skybox` preset enum + optional `fog` (color/near/far).
- `spawnPoints: SpawnPointSchema[]` — at least one with `id: "default"` expected.
- `camera: CameraSchema` — `position`, `target`, `fov` defaults.

**Parsing at the API boundary** is handled by `parseSceneGraph(input: unknown): SceneGraphAny` — THROWS on invalid input. The GET handler wraps it in try/catch and returns `null` on failure so the client falls through to the legacy renderer. Never trust raw DB output; always call `parseSceneGraph`.

**`emptySceneGraph(): SceneGraphV1`** — builds a fully-defaulted v1 document (all Zod `.default()` values applied). Used by 8.5's conversion tool and by tests.

Exported symbols: `SCENE_GRAPH_SCHEMA_VERSION`, `SceneGraphV1` (Zod schema + TS type), `SceneGraphAny` (TS type, = `SceneGraphV1` today), `ObjectSchema`, `LightSchema`, `EnvironmentSchema`, `SpawnPointSchema`, `CameraSchema`, `parseSceneGraph`, `emptySceneGraph`.

## Phase 2 Read Routes (Chunk D1 — 8.2)

Three new public GET routes added. All are **auth-free** (locked decision: worlds and their internals are public by design — matches `GET /api/worlds/[id]`).

| Route | Returns | Notes |
|---|---|---|
| `GET /api/worlds/[id]/scene-graph` | Latest scene graph + version metadata | `sceneGraph` defensively parsed — `null` on failure; legacy worlds return all version fields null |
| `GET /api/worlds/[id]/versions` | Paginated version history with author | Excludes `sceneGraph` JSONB from list (fetch individually for full doc) |
| `GET /api/worlds/[id]/assets` | All `world_asset` rows (max 100) | POST handler added in Chunk D2 |

All three return 400 on invalid UUID, 404 on missing world, 503 on DB error.

## Phase 2 Prep (Scene Graph API)

Phase 2 introduces a **scene graph API** as the canonical mutation surface for worlds. The browser editor, future desktop apps, future plugins, and AI agents are all clients of this API. Design notes:

- Operations-based mutations (not whole-document replacements) — enables CRDT-based realtime later
- Versioned writes — every save creates a new version, full history retained
- Permission gates ready for Phase 3 collaboration (owner / editor / viewer roles)
- Audit log — who changed what when

See `ROADMAP.md` Phase 2 for the full design discussion.

### Scene-graph operations (`src/lib/scene-graph/operations.ts`)

Pure module — no DB, no I/O. Defines the full mutation vocabulary for scene graphs.

**9 operation types** (Zod discriminated union on `"op"` key):

| Op | Key fields | Notes |
|---|---|---|
| `add_object` | `assetId` (uuid), optional `id`, `name`, `position`, `rotation`, `scale` | Server auto-generates `id = obj_<8hex>` if absent |
| `update_object` | `id`, `patch` (partial ObjectSchema minus id/assetId) | Errors if id missing |
| `set_object_asset` | `id`, `assetId` (uuid) | Identity-preserving asset swap — replaces the `assetId` of an existing object while keeping its `id`, `name`, `position`, `rotation`, `scale` unchanged. Used by folder-watcher CLI (sub-slice 8.3) when a re-uploaded `.glb` replaces a prior asset. Reducer does NOT validate that `assetId` exists in `world_assets`; FK violation surfaces as 503 at insert time. |
| `delete_object` | `id` | Errors if id missing |
| `set_environment` | `environment` (EnvironmentSchema) | Replaces the full environment |
| `set_lights` | `lights` (LightSchema[]) | Replaces the full lights array |
| `add_spawn` | `id`, `position`, `rotation` | Errors if id collides |
| `update_spawn` | `id`, `patch` | Errors if id missing |
| `delete_spawn` | `id` | Errors if id missing or would leave 0 spawn points |

**Key exports:**
- `SceneGraphOp` — Zod discriminated union + TS type
- `OpsBatchSchema` — wraps `ops[]` (1–100), `baseVersionId` (uuid), optional `label`
- `MAX_OPS_PER_BATCH = 100`
- `OperationError extends Error` — carries `opIndex: number` (0-based); thrown by `applyOps`
- `applyOps(graph: SG, ops: SceneGraphOp[]): SG` — pure reducer; `structuredClone` + `SceneGraphV1.parse` final check

**`applyOps` error conditions (throws `OperationError`):**
- `update_object` / `delete_object` / `set_object_asset` / `update_spawn` / `delete_spawn` — id not found
- `add_object` with explicit id that collides with an existing object
- `add_spawn` with id that collides with an existing spawn point
- `delete_spawn` that would leave 0 spawn points (v1 invariant: >= 1 required)

The `randomShortId` helper is internal (not exported). It uses `crypto.randomUUID()` (Node 18+ native) and takes the first 8 hex chars.

See [`docs/scene-graph-api.md`](./scene-graph-api.md) for the public-API-quality reference for these ops, all endpoints, the optimistic concurrency protocol, and example curl flows.

## Search (Postgres FTS) Pattern (Slice 7.2)

FORGE uses Postgres native full-text search (`tsvector` + GIN index) for world search. No external search engine is involved.

### Why `search_vector` is not in `schema.ts`

The column is entirely Postgres-managed. Storing it in Drizzle would mean Drizzle could accidentally overwrite it on an ORM `update(worlds).set({...})` call that doesn't include it (it would be left at the old value if included, or Drizzle would try to write NULL). Keeping it out of the schema is the safest option — triggers own the column exclusively.

### Trigger design

Two DB functions + two triggers keep `search_vector` current at all times:

**`worlds_search_vector_build(world_id_in uuid) → tsvector`** — helper function called by both triggers. Queries the `worlds` and `world_tags`/`tags` tables to build:

```
setweight(to_tsvector('english', title),       'A')
|| setweight(to_tsvector('english', description), 'B')
|| setweight(to_tsvector('english', tag_names),   'A')
```

Weight A = title + tags (highest relevance). Weight B = description.

**`worlds_search_vector_trigger`** — BEFORE INSERT OR UPDATE OF title, description ON `worlds`. Sets `NEW.search_vector = worlds_search_vector_build(NEW.id)`. Fires on every world creation and every title/description edit.

**`world_tags_search_vector_trigger`** — AFTER INSERT OR DELETE ON `world_tags`. Reads `COALESCE(NEW.world_id, OLD.world_id)` to get the affected world, then runs `UPDATE worlds SET search_vector = worlds_search_vector_build(target_world_id) WHERE id = target_world_id`. This fires the BEFORE trigger on `worlds` which overwrites the vector with the now-current tag list.

### Insert ordering note

When a world is first created (`POST /api/worlds`):
1. `worlds` row is inserted → BEFORE trigger fires → vector built from title/description (tags empty at this point).
2. `world_tags` rows are inserted → AFTER trigger fires for each → vector rebuilt with the correct tag list.

Final state is always correct. The intermediate state (no tags in vector) is never visible to users because the transaction commits atomically.

### GIN index

`CREATE INDEX worlds_search_vector_gin ON worlds USING gin(search_vector)` — standard GIN index for `@@` operator performance.

### Querying

Search results pages use direct DB queries with raw `sql` template literals (no API route):

```ts
// q-only search
db.query.worlds.findMany({
  where: sql`search_vector @@ websearch_to_tsquery('english', ${q})`,
  orderBy: sql`ts_rank(search_vector, websearch_to_tsquery('english', ${q})) DESC, created_at DESC`,
  limit: 50,
})
```

### Backfill

Migration includes `UPDATE worlds SET title = title;` to fire the BEFORE trigger on all existing rows. This populates `search_vector` for all worlds that existed before the migration.

## View Tracking Pattern (Slice 7.3)

`POST /api/worlds/[id]/views` uses the same recount-from-source transaction shape as likes, with an extra dedup layer:

```ts
await dbPool.transaction(async (tx) => {
  await tx.insert(worldViews)
    .values({ viewerId, worldId, day })  // day = UTC YYYY-MM-DD
    .onConflictDoNothing();              // composite PK dedup: (viewer, world, day)

  const [row] = await tx.select({ count: count() })
    .from(worldViews).where(eq(worldViews.worldId, worldId));

  await tx.update(worlds)
    .set({ views: Number(row.count) })
    .where(eq(worlds.id, worldId));
});
```

**Locked decisions:**
- Anonymous views are ignored — only signed-in users via `requireActiveDbUser` reach the insert.
- Suspended users do not increment views (`requireActiveDbUser` returns 403 for them).
- Day boundary is UTC (`new Date().toISOString().slice(0, 10)`). A user who visits at 23:59 UTC and again at 00:01 UTC the next day counts as two views.
- No Drizzle relations on `world_views` — the table is write-and-recount only, never joined via `db.query.*`.

## Optimistic Concurrency — Ops Route (Phase 2, Chunk D2)

`POST /api/worlds/[id]/scene-graph/ops` implements last-write-wins optimistic concurrency via the `baseVersionId` field.

**Protocol:**
1. Client tracks the `versionId` from the last successful save (or from `GET /scene-graph`).
2. Client includes `baseVersionId` in every ops batch.
3. Server loads the base version and the latest version for the world inside a single transaction.
4. If `latest.id !== baseVersionId`, the server returns **409** with the full current version body for client-side rebase:
   ```json
   {
     "error": "version conflict",
     "currentVersion": {
       "versionId": "...", "versionNumber": 12,
       "sceneGraph": { ... }, "status": "draft"
     }
   }
   ```
5. Client merges its pending ops onto the current version and retries.

**Transaction rollback on 409:**
The 409 path is triggered by throwing a `VersionConflict` sentinel instance from inside the `dbPool.transaction()` callback. Drizzle rolls back the transaction on any throw; the sentinel is caught outside the transaction block to return the appropriate response. This is the canonical "txn aborts on business-rule violation" pattern in this codebase.

**Error codes returned:**
- `400` — Zod validation failure, or `OperationError` thrown by `applyOps` (includes `opIndex`)
- `404` — world not found (via `requireWorldRole`) or `baseVersionId` not in this world's versions
- `409` — version conflict, with `currentVersion` in body

## Strict Referential Integrity — Asset DELETE (Phase 2, Chunk D2)

`DELETE /api/worlds/[id]/assets/[assetId]` refuses to delete an asset if any `world_versions` row for the world references it in its `scene_graph` JSONB.

**Reference check:**
The check uses a text-cast LIKE query rather than a JSON path operator to avoid needing a GIN-based `@>` query on an arbitrary UUID:

```sql
WHERE world_id = $worldId
  AND scene_graph::text LIKE '%"assetId":"<uuid>"%'
LIMIT 1
```

This pattern is intentional: asset deletions are rare, so a full-index scan is acceptable. A positional false-positive (an asset UUID appearing in a `label` or `name` field) is very unlikely and would only cause an unnecessary 409 — it is not a correctness bug.

If a reference is found, the route returns **409**:
```json
{
  "error": "asset in use",
  "referencedBy": { "versionId": "...", "versionNumber": 7 }
}
```

## Best-Effort Post-Commit R2 Cleanup (Phase 2, Chunk D2)

`DELETE /api/worlds/[id]/assets/[assetId]` deletes the `world_assets` DB row inside a transaction, then (outside the transaction, after commit) attempts to delete the corresponding R2 object.

**Object key derivation:**
The key is extracted from the stored `glbUrl` by finding the `/assets/` prefix substring in the URL:
```ts
const assetsIndex = capturedGlbUrl.indexOf("/assets/");
const objectKey = capturedGlbUrl.slice(assetsIndex + 1); // strips leading "/"
```
This avoids the need for an additional uploader-clerkId lookup or storing the raw object key separately in the DB.

**Failure handling:**
```ts
try {
  await deleteObject({ bucket: "glb", objectKey });
} catch (err) {
  console.error("[DELETE asset] R2 cleanup failed (orphaned object):", err);
  // Never surface to client — DB row is already gone; orphan is tolerable in v1
}
```

Orphaned R2 objects are logged but not treated as errors. This avoids user-visible failures when R2 has a transient issue after the DB delete already committed.

This is the canonical "best-effort post-commit side effect" pattern alongside `notify()` / `notifyMany()`. Both follow the same try/catch shape.

## Tag Normalization Pattern (Slice 7.1)

Used in `POST /api/worlds` to sanitize tag input before DB insertion:

1. Lowercase + trim each input string
2. Filter out empty strings
3. Deduplicate (Set)
4. Validate each against `/^[a-z0-9][a-z0-9_-]*$/` — reject with 400 if any fail
5. Enforce max 5 tags; reject with 400 if exceeded
6. Inside the existing worlds transaction:
   - `INSERT INTO tags (name) VALUES (...) ON CONFLICT (name) DO NOTHING` (bulk)
   - Re-select any tag rows whose IDs weren't returned via `SELECT id, name FROM tags WHERE name = ANY($1)`
   - Bulk `INSERT INTO world_tags` (idempotent via `onConflictDoNothing`)

## Best-Effort Post-Commit Notification Pattern (Slice 7.5)

**Locked decision (PROJECT.md §7):** Notification failures must NEVER break the parent action (like, comment, follow, world create). This is enforced structurally.

### The `notify()` / `notifyMany()` helpers (`src/lib/notifications.ts`)

```ts
// Single notification — post-commit, best-effort
await notify({
  userId: worldOwner.id,       // recipient
  type: "like",
  actorId: dbUser.id,          // who did the action
  worldId: world.id,           // optional context
  commentId: null,             // optional context
});

// Fan-out — e.g., new world → all followers
await notifyMany([
  { userId: followerId, type: "new_world", actorId: authorId, worldId },
  // ...
]);
```

Signatures:
- `notify(input: NotifyInput): Promise<void>` — inserts a single notification row; catches and swallows all DB errors
- `notifyMany(inputs: NotifyInput[]): Promise<void>` — bulk insert; catches and swallows all DB errors

`NotifyInput`: `{ userId: string; type: "like"|"comment"|"follow"|"new_world"; actorId?: string|null; worldId?: string|null; commentId?: string|null; }`

### Self-notification suppression

Both helpers check `input.actorId && input.userId === input.actorId` and return early (no DB insert). This is the single enforcement point.

### Call-site pattern

```ts
// Inside route handler, AFTER the action's transaction (or insert) commits
// and BEFORE the return statement:
try {
  // Optional: look up owner/recipient if not already in scope
  const [worldRow] = await db
    .select({ ownerId: worlds.userId })
    .from(worlds)
    .where(eq(worlds.id, worldId))
    .limit(1);
  if (worldRow) {
    await notify({
      userId: worldRow.ownerId,
      type: "like",             // one of: "like" | "comment" | "follow" | "new_world"
      actorId: dbUser.id,
      worldId,
      // commentId: created.id, // include for "comment" type
    });
  }
} catch (err) {
  // Double safety: notify() already swallows DB errors internally, but this
  // outer catch protects the HTTP response from any unforeseen synchronous throw.
  console.error("[POST likes] notify call wrapper failed:", err);
}
return NextResponse.json({ ... });
```

For fan-out (world create → all followers):

```ts
try {
  const followerRows = await db
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(eq(follows.followeeId, dbUser.id));
  if (followerRows.length > 0) {
    await notifyMany(
      followerRows.map((r) => ({
        userId: r.followerId,
        type: "new_world" as const,
        actorId: dbUser.id,
        worldId,
      }))
    );
  }
} catch (err) {
  console.error("[POST worlds] new-world fanout notify failed:", err);
}
```

The outer `try/catch` is the second defensive layer — `notify()`/`notifyMany()` already swallows errors, but this protects against any unforeseen synchronous throw from caller-side code (e.g., the owner-lookup query itself).

### Integration points (shipped in Slice 7.5)

These routes call `notify()` / `notifyMany()` post-commit:
- `POST /api/worlds/[id]/likes` → looks up `worlds.userId`, calls `notify({ type: "like", userId: worldOwner.id, actorId: dbUser.id, worldId })`
- `POST /api/worlds/[id]/comments` → looks up `worlds.userId`, calls `notify({ type: "comment", userId: worldOwner.id, actorId: dbUser.id, worldId, commentId: created.id })`
- `POST /api/users/[username]/follow` → calls `notify({ type: "follow", userId: followeeId, actorId: followerId })`
- `POST /api/worlds` → queries `follows WHERE followee_id = dbUser.id`, calls `notifyMany([...followers])` with `type: "new_world"`

All four integrations follow the double-defense call-site shape (outer `try/catch` + `notify()`'s internal `try/catch`).

## R2 Key Helpers (`src/lib/r2.ts`)

All object-key construction is server-side in `r2.ts`. Never let clients choose paths.

| Helper | Signature | Notes |
|---|---|---|
| `buildGlbKey` | `(userId, worldId) → string` | `worlds/{userId}/{worldId}/world.glb` |
| `buildThumbnailKey` | `(userId, worldId, ext) → string` | `worlds/{userId}/{worldId}/thumbnail.{ext}` |
| `buildMediaKey` | `(userId, worldId, mediaId, ext) → string` | `worlds/{userId}/{worldId}/media/{mediaId}.{ext}` |
| `buildAssetKey` | `(userId, assetId) → string` | `assets/{userId}/{assetId}/asset.glb` — Phase 2 world assets (added 8.2) |
| `deleteObject` | `({ bucket, objectKey }) → Promise<void>` | Best-effort R2 delete; swallows 404/NoSuchKey; rethrows other errors. Used when a `world_asset` DB row is removed (added 8.2). |

## Known Gotchas

- **`auth()` and `currentUser()` are async in Clerk v7.** Always `await`.
- **`db.query.*` and `tx.query.*` work on both clients.** The schema is wired into both `db` (HTTP) and `dbPool` (WebSocket pool) as of sub-slice 8.2 (2026-05-26). `tx.query.*` (relational joins inside a transaction) is actively used by the ops and publish routes in Chunk D2. Previously `dbPool` was missing the `schema` argument — **resolved 2026-05-26**.
- **Migrations are hand-written.** Don't try `drizzle-kit generate` in an agent context.
- **`.env.local` needs explicit `dotenv.config({ path: ".env.local" })`** in tsx scripts.
- **Recount counters, don't increment.** Prevents drift.
- **`requireActiveDbUser` on every new write endpoint** by default. Exempt only with explicit justification (the reports endpoint is the canonical example).
- **Tag characters:** only `[a-z0-9_-]` allowed. Reject anything outside this set (spaces, emoji, `#`) with 400 at the route level. The DB CHECK constraint enforces lowercase + length as a safety net.