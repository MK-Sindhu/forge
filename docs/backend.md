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
│   ├── uploads/sign/     # POST — presigned R2 URL
│   ├── worlds/           # CRUD + likes + comments + reposts + reports + updates
│   ├── users/            # Profile + follow
│   ├── admin/            # Admin-only: reports queue, suspensions
│   ├── comments/         # DELETE single comment
│   ├── updates/          # PATCH / DELETE single update
│   └── notifications/    # (Slice 7 — to be added)
├── db/
│   └── schema.ts         # Drizzle schema — single source of truth for tables
└── lib/
    ├── users.ts          # Auth helpers (getOrCreateDbUser, requireAdmin, requireActiveDbUser)
    ├── r2.ts             # R2 client (lazy-init), presigned URLs
    └── format-relative.ts # "5m ago" timestamps (used by frontend too)
```

## Database Schema (Current — 9 Tables)

Authoritative source: `src/db/schema.ts`. This section is a reference summary.

### `users`
Synced from Clerk. Source of truth for app-level user state.

Key columns: `id`, `clerk_id`, `username`, `email`, `avatar_url`, `tos_accepted_at`, `is_admin`, `suspended_at`, `created_at`.

### `worlds`
The core entity. Each row = one published world.

Key columns: `id`, `user_id`, `title`, `description`, `glb_url`, `glb_size_bytes`, `views` (int, default 0), `created_at`.
Counters (denormalized, recount-from-source pattern): `likes_count`. Note: `comment_count` and `repost_count` are **not** stored on this table — they are computed from the `comments` and `reposts` tables at query time. There is no top-level `thumbnail_url`; thumbnails live in `world_media` with `type = 'thumbnail'`.

Phase 2 additions (not yet): `scene_graph` JSONB, version history, asset model.

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

### `worlds.search_vector` (DB-only, not in Drizzle schema)
Slice 7.2. `tsvector` column added directly to the `worlds` table via migration `0007_slice7_search.sql`. **This column is intentionally absent from `src/db/schema.ts`.** It is Postgres-managed — triggers populate and maintain it automatically. Application code never writes to it directly. Drizzle queries against `worlds` simply don't see this column (no TS errors, no runtime errors). Queries that need to search use raw `sql` template literals: `sql\`search_vector @@ websearch_to_tsquery('english', ${q})\``.

## Auth Helpers (`src/lib/users.ts`)

Three helpers, used everywhere. Pick the right one for the situation.

| Helper | Returns | Use when |
|---|---|---|
| `getOrCreateDbUser()` | The DB user row (creates from Clerk if missing) | Any authenticated handler that needs the DB user |
| `requireAdmin()` | DB user OR throws 403 | Admin routes — does the active-user check too |
| `requireActiveDbUser()` | DB user (active, not suspended) OR throws 403 | Write endpoints — blocks suspended users from likes, uploads, comments, follows, etc. |

### Suspension guard pattern

12 write endpoints use `requireActiveDbUser()` to block suspended users. The **report endpoint is exempt** (safety valve — a suspended user can still flag content). That's the only exception. New write endpoints should use `requireActiveDbUser` by default.

## Common Patterns

### Presigned upload flow

1. Client calls `POST /api/uploads/sign` with file kind (`glb`, `thumbnail`, `image`, `video`)
2. Server returns presigned PUT URL + the eventual public URL
3. Client uploads directly to R2 (bypasses our server)
4. Client calls `POST /api/worlds` with the resulting URLs
5. Server `HEAD`s each R2 key to verify the upload succeeded, then transactionally inserts `worlds` + `world_media` rows

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

Use `dbPool` for transactions. **Inside the transaction**, use raw `tx.insert/update/delete` — not `tx.query.*`. The schema isn't wired into `dbPool` (see `infra.md`).

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
| POST | `/api/uploads/sign` | required | Returns presigned R2 PUT URL | 1 |
| POST | `/api/worlds` | required, active | Create a world (HEADs R2 keys, transactional insert); accepts optional `tags` array (max 5, normalized + validated); inserts `tags` + `world_tags` in the same transaction | 1, 7.1 |
| GET | `/api/worlds/[id]` | public | Joins media + author + tags; includes `isLikedByCurrentUser`, `isRepostedByCurrentUser`; response includes `tags: { name: string }[]` | 1, 7.1 |
| POST | `/api/worlds/[id]/likes` | required, active | Like (idempotent, transactional recount) | 3 |
| DELETE | `/api/worlds/[id]/likes` | required, active | Unlike | 3 |
| POST | `/api/users/[username]/follow` | required, active | Follow (idempotent, rejects self-follow) | 3 |
| DELETE | `/api/users/[username]/follow` | required, active | Unfollow | 3 |
| POST | `/api/worlds/[id]/comments` | required, active | Add comment | 4 |
| GET | `/api/worlds/[id]/comments` | public | Paginated (cursor, ISO 8601 `createdAt`) | 4 |
| DELETE | `/api/comments/[id]` | required, author OR world-owner | Delete comment | 4 |
| POST | `/api/worlds/[id]/repost` | required, active | Repost (idempotent) | 4 |
| DELETE | `/api/worlds/[id]/repost` | required, active | Un-repost | 4 |
| POST | `/api/worlds/[id]/updates` | required, world-owner | Post a text update | 5 |
| GET | `/api/worlds/[id]/updates` | public | Paginated (cursor) | 5 |
| PATCH | `/api/updates/[id]` | required, world-owner | Edit update (sets `edited_at`) | 5 |
| DELETE | `/api/updates/[id]` | required, world-owner | Delete update | 5 |
| POST | `/api/worlds/[id]/reports` | required (suspension-EXEMPT) | File a report | 6 |
| GET | `/api/admin/reports` | admin | Paginated queue, status filter | 6 |
| PATCH | `/api/admin/reports/[id]` | admin | Resolve / dismiss | 6 |
| POST | `/api/admin/users/[id]/suspend` | admin | Suspend (blocks self-action) | 6 |
| DELETE | `/api/admin/users/[id]/suspend` | admin | Unsuspend | 6 |

## Phase 2 Prep (Scene Graph API)

Phase 2 introduces a **scene graph API** as the canonical mutation surface for worlds. The browser editor, future desktop apps, future plugins, and AI agents are all clients of this API. Design notes:

- Operations-based mutations (not whole-document replacements) — enables CRDT-based realtime later
- Versioned writes — every save creates a new version, full history retained
- Permission gates ready for Phase 3 collaboration (owner / editor / viewer roles)
- Audit log — who changed what when

See `ROADMAP.md` Phase 2 for the full design discussion.

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

## Known Gotchas

- **`auth()` and `currentUser()` are async in Clerk v7.** Always `await`.
- **`db.query.*` only on `db` (HTTP), never on `dbPool` / transactions.**
- **Migrations are hand-written.** Don't try `drizzle-kit generate` in an agent context.
- **`.env.local` needs explicit `dotenv.config({ path: ".env.local" })`** in tsx scripts.
- **Recount counters, don't increment.** Prevents drift.
- **`requireActiveDbUser` on every new write endpoint** by default. Exempt only with explicit justification (the reports endpoint is the canonical example).
- **Tag characters:** only `[a-z0-9_-]` allowed. Reject anything outside this set (spaces, emoji, `#`) with 400 at the route level. The DB CHECK constraint enforces lowercase + length as a safety net.