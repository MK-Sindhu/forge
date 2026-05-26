# FORGE — Progress Tracker

> The "what is done, what is left, what is in-flight" doc. Updated after every slice ships and after every prod smoke test.

**Last updated:** 2026-05-27 (10.1 close — Slice 10 underway)

---

## 1. At-a-Glance State

| | |
|---|---|
| Current phase | Slice 10 — Realtime editor collab (Phase 3 work). 10.1 (editor presence + chat-in-editor + rebase toast) shipped. 10.2 (concurrent CRDT-based co-editing) + 10.3 (voice chat) planned. |
| Current slice | Slice 9 (visitor walk + collab + presence) + Slice 10.1 (editor presence) all shipped 🟢. |
| In-flight | Awaiting founder prod migration for 0012 (9.2 schema) + 2-device prod smoke covering 9.1 + 9.2 + 9.3 + 10.1. Both visitor + editor presence active in the same Liveblocks room per world. |
| Tests | 822 across 57 test files |
| Commits on main | Slices 0–7 + Phase 2 (8.1–8.4) + Slice 9 + Slice 10.1 closeout (latest commit pending) |
| Latest commit | (this commit — Slice 10.1 Realtime editor presence) |
| Branch state | `main` clean, in sync with `origin/main` |
| Production | https://forge-black-eta.vercel.app |
| DB | Neon Postgres — 16 tables, 12 migrations applied locally (0010 = 8.1 substrate; 0011 = 8.2 indexes; 0012 = 9.2 world_collaborators + notifications enum). **Prod has 0010 + 0011 applied (2026-05-26). Prod migration for 0012 pending founder action.** |
| Storage | Cloudflare R2 — 2 buckets (forge-glb, forge-media); 8.2 adds `assets/{userId}/{assetId}/asset.glb` prefix under `forge-glb` |

## 2. Phase Rollup

| Phase | Status | Notes |
|---|---|---|
| Phase 0 — Foundation | ✅ COMPLETE | Slices 0–6 shipped |
| Phase 1 — Launch | 🟡 IN PROGRESS | Slice 7 ✅ verified 2026-05-25; launch ops next (Terms, DMCA, onboarding, seed worlds, analytics, public launch) |
| Phase 2 — Architectural Pivot | 🟢 SUBSTANTIALLY COMPLETE | Sub-slices 8.1 (Scene Graph Foundation) + 8.2 (Scene Graph API) + 8.3 (Improved Upload + Convert + Folder-Watcher CLI; absorbs 8.5 scope) + 8.4 (Browser Editor) all shipped 2026-05-26. ~~8.5~~ absorbed into 8.3. 8.6 (AI assist) parked per founder direction. Awaiting founder prod migration + prod smoke to flip 🟢 → ✅. |
| Slice 9 — "Worlds Are Spaces" reframe | 🟢 SHIPPED | Bridge between Phase 2 and Phase 3. Driven by founder's clarification that worlds are interactive virtual spaces. Sub-slices 9.1 (walk mode + collision + copy reframe) + 9.2 (collaborators) + 9.3 (multi-user presence + chat via Liveblocks) all shipped 2026-05-26. Pulled async-collab + visitor presence forward from Phase 3. |
| Slice 10 — Realtime editor collab (Phase 3 work) | 🟡 IN PROGRESS | 10.1 (realtime editor presence + chat-in-editor + rebase toast) shipped 2026-05-27. 10.2 (concurrent CRDT-based co-editing via Liveblocks Storage) + 10.3 (voice chat via LiveKit) + kick/mute moderation tools planned but not started. |
| Phase 3 — Collaboration (post-Slice 10) | ⬜ NOT STARTED | After Slice 10: live multiplayer in worlds (voice, deeper presence features), worlds-as-events. |
| Phase 4 — Living Worlds | ⬜ NOT STARTED | Interactivity + portals + scripting |
| Phase 5 — Persistent Ecosystem | ⬜ NOT STARTED | Cross-world identity, asset library, full AI gen |
| Phase 6 — Long Horizon | ⬜ NOT STARTED | Federation, XR, scripting language |

## 3. Slices — Detailed Status

Legend: ✅ shipped + verified in prod · 🟢 shipped + deployed, not prod-smoked · 🟡 in-flight · ⬜ not started

### Phase 0 — Foundation

#### Slice 0 — Foundation ✅

| | |
|---|---|
| Status | Shipped + verified |
| What | Next.js 16 + Clerk + Drizzle + Neon + R2 + Vercel + GitHub Actions CI + 6 custom Claude Code subagents |
| Tables touched | (initial setup, no app tables yet) |
| Files | `.claude/agents/*.md`, `drizzle/0000_*.sql`, infra config |
| Smoke test | Verified — auth flow works in prod |

#### Slice 1 — Core upload + view ✅

| | |
|---|---|
| Status | Shipped + verified |
| What | Users table, worlds table, world_media, likes. R2 presigned uploads. WorldViewer (R3F + drei). Upload flow. Profile pages. Feed. |
| Schema | `users` (with `tos_accepted_at`), `worlds` (with `glb_url`, `glb_size_bytes`), `world_media`, `likes` |
| API | `POST /api/uploads/sign`, `POST /api/worlds`, `GET /api/worlds/[id]` |
| Smoke test | ✅ Verified — uploaded "First world", 1 like badge visible |

#### Slice 2 — Rich media gallery 🟢

| | |
|---|---|
| Status | Shipped + deployed, **not prod-smoked yet** |
| What | Optional preview video + up to 4 images per world. Hover-to-play on feed/profile cards. MediaCarousel on world page. |
| Components | `<MediaCarousel>`, `<WorldCardMedia>` (shared, `aspectRatio="video"\|"square"`) |
| Smoke test | ⬜ Pending |

#### Slice 3 — Social baseline ✅

| | |
|---|---|
| Status | Shipped + verified |
| What | Follows table. Likes API (transactional, recount-from-source). LikeButton + FollowButton (optimistic). Recent / Following feed tabs. |
| Schema | `follows` (composite PK, CASCADE, CHECK no self-follow) |
| API | `POST/DELETE /api/worlds/[id]/likes`, `POST/DELETE /api/users/[username]/follow` |
| Smoke test | ✅ Verified |

#### Slice 4 — Engagement 🟢

| | |
|---|---|
| Status | Shipped + deployed, **not prod-smoked yet** |
| What | Comments, reposts, share button. Following feed merges originals + reposts. `formatRelative` helper extracted. |
| Schema | `comments`, `reposts` |
| API | `POST/GET /api/worlds/[id]/comments`, `DELETE /api/comments/[id]`, `POST/DELETE /api/worlds/[id]/repost` |
| Smoke test | ⬜ Pending |

#### Slice 5 — World updates timeline 🟢

| | |
|---|---|
| Status | Shipped + deployed, **not prod-smoked yet** |
| What | Text-only world updates on world pages. Surfaced in Following feed as a third entry type. Owner-only POST. |
| Schema | `world_updates` (text-only v1 — media on updates is parking lot) |
| API | `POST/GET /api/worlds/[id]/updates`, `PATCH/DELETE /api/updates/[id]` |
| Smoke test | ⬜ Pending |

#### Slice 6 — Moderation ✅

| | |
|---|---|
| Status | Shipped + verified in prod (2026-05-24) |
| What | Reports queue. Admin tools. Suspensions. `users.is_admin`, `users.suspended_at`. Suspension guards on 12 write endpoints. Suspension-exempt safety valve for report endpoint. DMCA stub page. |
| Schema | `reports` (unique on (reporter_id, world_id), CHECK enums on reason + status, resolved_by_id ON DELETE SET NULL) |
| API | `POST /api/worlds/[id]/reports`, `GET/PATCH /api/admin/reports`, `POST/DELETE /api/admin/users/[id]/suspend` |
| New helpers | `requireAdmin`, `requireActiveDbUser` in `src/lib/users.ts` |
| Smoke test | ✅ All 5 checks passed — admin link visible, `/admin/reports` loads, report flow works end-to-end, resolve moves row state, safety valve confirmed (suspended user blocked from likes/comments/uploads but can still file reports) |

### Phase 1 — Launch

#### Slice 7 — Discovery polish ✅

| | |
|---|---|
| Status | Shipped + verified in prod 2026-05-25 (all 5 sub-slices smoke-tested; 2 layout hotfixes applied: scrollbar gutter + sticky footer) |
| Goal | Search, tags, view counts, trending, notifications — the discovery layer FORGE needs to launch publicly |
| Schema additions | `tags`, `world_tags`, `world_views`, `notifications`, `worlds.search_vector` (FTS column, DB-managed) |
| Migrations | `0006_slice7_tags.sql`, `0007_slice7_search.sql`, `0008_slice7_views.sql`, `0009_slice7_notifications.sql` |
| New API routes | `POST /api/worlds/[id]/views`, `GET /api/notifications`, `POST /api/notifications/mark-read`, `GET /api/notifications/unread-count` |
| Modified routes | `POST /api/worlds` (tags + new-world fanout notifications), `GET /api/worlds/[id]` (tags in response), `POST /api/worlds/[id]/likes` (notify), `POST /api/worlds/[id]/comments` (notify), `POST /api/users/[username]/follow` (notify) |
| New pages | `/search`, `/notifications` |
| New components | `tag-chip/TagChip`, `view-tracker/ViewTracker`, `notification-bell/NotificationBell`, `notifications/MarkAllReadOnView`, `notifications/NotificationList` |
| New helper | `src/lib/notifications.ts` — `notify()` + `notifyMany()` post-commit best-effort |
| Tests | 311 → 417 (+106 across the 5 sub-slices) |
| Commits | da31b12 (7.1) · 8cc776c (7.2) · a788a77 (7.3) · 610b332 (7.4) · this (7.5) |

**Sub-slices in order:**

| # | Sub-slice | Status |
|---|---|---|
| 7.1 | Tags — free-form, max 5 per world, lowercase, max 32 chars each | ✅ |
| 7.2 | Search — Postgres FTS (`tsvector` on title + description + tags) | ✅ |
| 7.3 | View counts — debounced, 1/user/world/day | ✅ |
| 7.4 | Trending — new feed tab, `likes × decay(age_in_hours)` | ✅ |
| 7.5 | Notifications — bell icon + `/notifications`. Events: like, comment, follow, new-world-from-followee | ✅ |

Schema additions + locked design decisions for Slice 7 are recorded in `PROJECT.md` §7 decision log and in the per-sub-slice table above. Schema details: see `docs/backend.md`.

### Launch Ops (in flight — gates public launch)

| Task | Status |
|---|---|
| Real Terms of Service page (currently 404 stub) | 🟡 Draft shipped (`/legal/terms`) — amber DRAFT banner, 11 sections, ~900 words. Awaiting attorney review + finalized copy before public launch. Governing law + contact email are placeholders. |
| Real Privacy Policy page (none today — legally required) | 🟡 Draft shipped 2026-05-25 (`/legal/privacy`) — amber DRAFT banner, 10 sections, ~1 100 words. Accurately describes Clerk auth data, Neon DB, Vercel IP logging, R2 public storage, behavioral tracking (signed-in only, anonymous views NOT tracked), cookie policy (Clerk session only), GDPR-style user rights. Analytics section explicitly marked "none today" and commits to policy update when analytics lands. Contact email (`privacy@forge.example`) and governing jurisdiction are explicit placeholders. Awaiting attorney review + finalized copy before public launch. Footer updated: Privacy link added alongside DMCA + Terms. Cross-linked from Terms Contact section. When analytics (Plausible/PostHog) ships, Section 4 of this policy must be updated. |
| Real DMCA email (currently `dmca@forge.example` placeholder) | ⬜ |
| Unsuspend button in admin UI | ✅ Shipped — Suspended tab + `UnsuspendButton` on `/admin/reports?view=suspended` |
| Onboarding pass — empty-feed state for new users | ✅ Shipped — `WelcomeCallout` + actionable empty states |
| 30–50 seed worlds — build / source CC-licensed `.glb` | ✅ **30 worlds live in prod 2026-05-26** — 10 Khronos glTF samples (MIT) + 20 Quaternius Space Kit & Nature Pack models (CC0). Curated from 138 downloaded source models. Uploaded via the direct-mode escape hatch script (`db:seed-worlds-direct`) after the Vercel-API path was blocked by an ISP→Vercel routing issue + Clerk session-token quirks. Thumbnails auto-generated headless via Playwright + three.js (`db:seed-thumbs`). |
| Basic analytics — Vercel Web Analytics (free on Hobby) | 🟡 Code wired (Vercel Web Analytics, free on Hobby); founder must toggle Analytics on in the Vercel dashboard to activate |
| Launch plan: r/threejs + r/blenderhelp first, X/Bluesky parallel, HN last after 200+ users | 🟡 Draft copy shipped in `docs/launch-posts.md` (5 posts: r/threejs · r/WebGL · r/blender · X/Bluesky · Show HN) + before-posting checklist + after-launch dashboard. Founder posts when ready. |
| OpenGraph + Twitter Card metadata | ✅ Shipped 2026-05-26 — site-wide defaults in `layout.tsx` (`metadataBase`, `title.template`, OG website + Twitter card); `generateMetadata` on `/world/[id]` (world thumbnail as OG image), `/profile/[username]` (avatar, world count), `/search` (dynamic title per `?q=`/`?tag=`). Static `metadata` on `/upload` + all `/legal/*` pages (clean browser tabs, template applied, no double-suffix). |
| First public launch (mark date when done) | ⬜ |

### Phase 2 — The Architectural Hinge

#### Slice 8.1 — Scene Graph Foundation 🟢

| | |
|---|---|
| Status | Shipped + deployed; prod migration + local smoke (hand-seed) pending |
| What | Storage substrate for the scene-graph era. New `worlds.scene_graph jsonb` (nullable; NULL = legacy GLB-only world) + `worlds.published_version_id uuid` (8.2 will set) + `world_assets` table (per-world reusable `.glb`s under `assets/{userId}/{assetId}/asset.glb` R2 prefix) + `world_versions` table (immutable scene-graph snapshots, draft/published). New `src/lib/scene-graph/schema.ts` Zod v1 schema (`SceneGraphV1`: objects + lights + environment + spawnPoints + camera; Euler rotations; 8 skybox presets). New `SceneGraphRenderer` (R3F; lifts WorldViewer's Canvas + Bounds + OrbitControls + lighting + error boundary + LoadingOverlay scaffolding). `/world/[id]` branches between renderers: `scene_graph` present → new renderer, else → legacy WorldViewer. **No editor, no API mutations, no upload changes yet** — pure substrate. |
| Schema additions | `worlds.scene_graph jsonb`, `worlds.published_version_id uuid`, `world_assets` table, `world_versions` table |
| Migration | `0010_phase2_scene_graph_foundation.sql` (additive only — no existing row touched; all 31 prod worlds keep `glb_url`, `scene_graph` stays NULL) |
| API surface | `GET /api/worlds/[id]` extended response: `sceneGraph: SceneGraphV1 \| null` + `assets: { id, name, glbUrl, sizeBytes }[]`. Defensive parse — malformed jsonb logs + falls through to `null` (legacy renderer takes over). No new routes. |
| New helpers | `parseSceneGraph` + `emptySceneGraph` in `src/lib/scene-graph/schema.ts` |
| New components | `scene-graph-renderer/SceneGraphRenderer.tsx` + `scene-graph-renderer/SceneGraphRendererClient.tsx` (dynamic `ssr: false` wrapper mirroring `WorldViewerClient`) |
| Tests | 417 → 445 (+28: 23 schema/Zod tests + 5 GET-route Phase-2 tests) |
| Smoke checklist | (1) All 31 legacy worlds render identically · (2) `GET /api/worlds/[id]` for legacy returns `sceneGraph: null, assets: []` · (3) Hand-seed a scene-graph world via SQL, visit `/world/[id]` → SceneGraphRenderer fires · (4) Hand-seed 2-object scene-graph world → both render with correct transforms, `useGLTF` cache hit · (5) Hand-seed malformed `scene_graph` → falls through to legacy, no 500 · (6) `npm run db:smoke` confirms `world_assets` + `world_versions` exist · (7) CI passes |

**Sub-slices in order:**

| # | Sub-slice | Status |
|---|---|---|
| 8.1 | Scene Graph Foundation — storage substrate + renderer split | 🟢 |
| 8.2 | Scene Graph API — operations-based REST + permissions + audit log | 🟢 |
| 8.3 | Improved Upload + Convert-to-Scene-Graph button + Version-History UI + Folder-Watcher CLI | 🟢 |
| 8.4 | Browser Editor — first client of the API | 🟢 |
| ~~8.5~~ | ~~Backward Compatibility + Conversion Tool~~ — ABSORBED into 8.3 (convert button shipped early to give founder visible win) | — |
| ~~8.6~~ | ~~AI Editor Assist~~ — PARKED per founder direction, see `DEFERRED.md` | — |

Locked design decisions for Phase 2 are recorded in `PROJECT.md` §7 decision log and the plan file. See `docs/3d.md` "Phase 2 — Scene Graph Rendering" for renderer architecture and `src/lib/scene-graph/schema.ts` for the v1 schema.

#### Slice 8.2 — Scene Graph API 🟢

| | |
|---|---|
| Status | Shipped + deployed; prod migration (0011) pending |
| What | The mutation API on top of 8.1's substrate. Operations-based REST surface every future editing surface (browser editor in 8.4, Blender plugin, desktop shell, any AI tool, future "web native" client) becomes a client of. 7 routes (1 modified + 6 new) on top of 2 new pure library modules. Optimistic concurrency via `baseVersionId` with **full** `currentVersion` body in 409 responses (saves a rebase round-trip). Every save creates an immutable `world_versions` row — doubles as the audit log. Strict referential integrity on asset DELETE (refuses 409 if any past version references the asset). **No frontend changes** — 8.4 is the first client. |
| Schema additions | Two `world_versions` indexes — `(world_id, status)` for "find latest published"; `(parent_version_id)` for version-tree traversal in 8.5 |
| Migration | `0011_phase2_scene_graph_api.sql` (additive — two indexes only; zero downtime) |
| New library modules | `src/lib/scene-graph/operations.ts` (8 op Zod schemas + `applyOps` pure reducer + `OperationError` + `MAX_OPS_PER_BATCH = 100` + `OpsBatchSchema`) · `src/lib/world-permissions.ts` (`requireWorldRole(worldId, dbUser, role)` returns `{ world, role }`; Phase-3-ready — extending to editor/viewer is a single block inside the helper, route handlers don't change) |
| R2 helpers | `buildAssetKey(userId, assetId)` → `assets/{userId}/{assetId}/asset.glb` · `deleteObject({ bucket, objectKey })` best-effort cleanup |
| API surface — modified | `POST /api/uploads/sign` extended with `kind: "asset"` (single upload-signing surface; assets reuse `forge-glb` bucket under the new prefix; 50 MB cap) |
| API surface — 6 new routes | `GET /api/worlds/[id]/scene-graph` (public; resolves "latest draft if newer than published, else latest published") · `POST /api/worlds/[id]/scene-graph/ops` (owner-only; ops batch ≤100; optimistic concurrency 409 with full rebase body) · `GET /api/worlds/[id]/versions` (public; cursor-paged audit log; author hydrated; sceneGraph excluded for size) · `POST /api/worlds/[id]/versions/[v]/publish` (owner-only; idempotent; cross-world id-guard) · `POST/GET /api/worlds/[id]/assets` (owner-only POST after HEAD-verified R2 upload; public GET capped at 100) · `DELETE /api/worlds/[id]/assets/[assetId]` (owner-only; **strict integrity** — 409 with `referencedBy.versionNumber` if any past `world_versions.scene_graph` references the asset; best-effort R2 cleanup post-commit) |
| Other fixes | `src/db/index.ts` — one-line `dbPool` schema wiring (resolves Slice 7 Known Issue #5 — relational `tx.query.*` now works inside transactions, used by the ops route) |
| Documentation | **`docs/scene-graph-api.md` NEW** (1,130 lines / 5,382 words; public-API-quality reference covering operations, endpoints, optimistic concurrency, permission model, versioning model, asset model, limits, example curl flows — quality bar: a competent engineer could write a Blender plugin from this alone). `docs/backend.md` + `docs/infra.md` + `docs/testing.md` updated. |
| Tests | 445 → 518 (+73 across 8 new test files: ops reducer + permissions helper + 6 route test files) |
| Smoke checklist (prod) | (1) `npm run db:smoke` confirms `world_versions` has both new indexes · (2) `GET /scene-graph` for a legacy world → `{ sceneGraph: null, versionId: null, ... }` · (3) `GET /versions` for legacy → `{ versions: [], nextCursor: null }` · (4) `GET /assets` for legacy → `{ assets: [] }` · (5) Manual presign `kind: "asset"` returns presigned URL with `assets/{clerkId}/{assetId}/asset.glb` key · (6) PUT to URL + `POST /assets` returns 201 + row visible · (7) `POST /scene-graph/ops` with `add_object` → 200 + new version; `GET /scene-graph` reflects it · (8) Stale `baseVersionId` → 409 with full rebase body · (9) `POST /versions/[v]/publish` → 200 + subsequent GET shows `status: "published"` · (10) DELETE in-use asset → 409 with `referencedBy.versionNumber` · (11) DELETE unused asset → 200 + R2 object cleaned (best-effort) · (12) All 31 legacy worlds still render identically · (13) CI green |

#### Slice 8.3 — Improved Upload + Convert + Folder-Watcher CLI 🟢

| | |
|---|---|
| Status | Shipped + deployed; prod migration for 0010 + 0011 (from 8.1 + 8.2) still pending. **First visible UI shipping in Phase 2.** |
| What | Pulls 8.5's "Convert to scene graph" tool forward to give the founder a visible button on every legacy world. Adds the `set_object_asset` op (closes an 8.2 gap — folder-watcher CLI couldn't swap an object's asset without it). Adds version-history UI on the world page (owner-only). Ships the folder-watcher CLI (`scripts/forge-watch.ts`) so creators editing `.glb` files in Blender/etc. see changes flow into a FORGE scene-graph world without ever touching the website. **No editor UI** — that's 8.4. |
| New API op | `set_object_asset` (9th op in `SceneGraphOp` discriminated union) — identity-preserving asset replacement on an existing object. Reducer throws `OperationError` if `id` not found. Does NOT validate the new `assetId` against `world_assets` in the reducer (FK violation surfaces at insert time as 503). Use case: folder-watcher CLI + future "replace asset" UI button. |
| New API route | `POST /api/worlds/[id]/convert-to-scene-graph` (owner-only; 409 if already converted; 400 if no glb to convert; reuses existing R2 object — no upload). Inside transaction: insert `world_assets` row pointing at existing `glb_url` → build 1-object scene graph with `obj_base` id + ambient + sun + studio skybox + default spawn → insert `world_versions` row (status=published, versionNumber=1, parentVersionId=null) → update `worlds.scene_graph` + `published_version_id`. Idempotent post-conversion (2nd call returns 409 with the existing scene graph). |
| New components | `convert-to-scene-graph/ConvertToSceneGraphButton.tsx` (owner-only, only renders if `world.sceneGraph === null`; understated card panel — not a big CTA; on success → `router.refresh()`; treats 409 as success) · `version-history/VersionHistorySection.tsx` (owner-only, only renders if `world.sceneGraph !== null`; cursor-paginated list from `GET /versions`; status pills: `Currently published` / `Published` / `Draft`; optimistic publish with revert-on-error; skeleton + error + empty states; "View past versions" deferred to a later sub-slice) |
| Modified API | `GET /api/worlds/[id]` extended response — adds `publishedVersionId` field (needed by version-history UI to highlight the currently-published row) |
| Modified page | `src/app/world/[id]/page.tsx` — wires both new components into the owner-only block below the world viewer |
| Folder-watcher CLI | `scripts/forge-watch.ts` (~415 lines) + `scripts/forge-watch.md`. chokidar v5-based; auth via pasted browser session cookie; `awaitWriteFinish` debounce for partial writes (Blender chunks); serialized op queue (no 409 conflict storms); on file `add` → presign + PUT + finalize + `add_object` at origin; on `change` → fresh `assetId` (preserves history) + `set_object_asset` for each object referencing the old asset; on `unlink` → no auto-delete (manual safety); on 409 → one retry with fresh `baseVersionId` then skip. Plain-text console with `[+] [~] [-] [!] [OK]` glyphs. One-day timebox honored — no unit tests (human smoke + small surface). |
| New dependency | `chokidar ^5.0.0` (devDependency — dev-only tool) |
| Documentation | `docs/scene-graph-api.md` — added §3.3 `set_object_asset` reference (renumbered subsequent sections) + new §10/11 "Example clients" subsection pointing at the CLI as the reference non-browser implementation; replaced the 8.5 forward-reference stub with full shipped-route documentation for `convert-to-scene-graph`. `docs/backend.md` — bumped op count to 9, added `set_object_asset` row, added convert route to API inventory, added `## CLI Scripts` section. `docs/frontend.md` — added both new components + page wiring. |
| Tests | 518 → 542 (+24 across 4 new test files: operations test extended +5 for `set_object_asset`, convert route +8, ConvertToSceneGraphButton +5, VersionHistorySection +7; folder-watcher CLI tests skipped per timebox) |
| Smoke checklist (prod) | (0) Prereq: 0010 + 0011 migrations applied to prod · (1) Visit your own legacy world signed in → see "Convert to editable scene graph" card below comments · (2) Click → page refreshes → world renders identically via SceneGraphRenderer · (3) "Version history" section now appears with "Version 1 · Converted from legacy .glb · Currently published" · (4) Visit converted world signed-out or as non-owner → version history hidden · (5) Hit `POST /convert-to-scene-graph` on already-converted world → 409 with `sceneGraph` echo · (6) `npm run forge:watch -- --world-id=... --folder=./test-glb --session=...` against a converted world → drop a `.glb` → terminal shows `[+] Added` → world page refresh shows new object in viewer · (7) Overwrite the same file → `[~] Updated, N object(s) swapped` → new `world_versions` row in version history · (8) Browser refresh → version history shows new version · (9) All 31 legacy worlds (un-converted) still render identically · (10) CI green |

#### Slice 8.4 — Browser Editor 🟢

| | |
|---|---|
| Status | Shipped + deployed; prod migration for 0010 + 0011 (from 8.1 + 8.2) still pending. **Phase 2 headline feature.** First real client of the 8.2 ops API. |
| What | Full in-browser scene-graph editor at `/world/[id]/edit`, owner-gated. Three-panel layout: assets (left, with in-editor `.glb` upload) · viewport with TransformControls gizmo (center) · properties panel (right, 4 tabs: object / lights / environment / spawn-points). Per-operation in-memory undo/redo. Autosave drafts every 2s · "Save as version" with optional label · "Publish" promotes the latest version. Desktop-first, tablet-supported; phones see a "switch device" notice. Keyboard: T/R/S gizmo mode · Delete/Backspace object · Escape deselect · Ctrl/⌘+Z/Shift+Z undo/redo. |
| New page | `/world/[id]/edit` (server component) — owner gate, legacy-world rejection (must convert first via 8.3 button), inline DB fetch of latest version + asset list, forwards data to client shell |
| New route segment layout | `src/app/world/[id]/edit/layout.tsx` — strips root header/footer for true fullscreen editor chrome |
| State layer | `src/components/editor/editor-store.ts` — Zustand store: `sceneGraph` + `serverSceneGraph` + `baseVersionId` + `pendingOps[]` + `selectedObjectId` + `gizmoMode` + `propertiesTab` + `autosaveStatus` + undo/redo stacks. Actions: `initialize`, `selectObject`, `setGizmoMode`, `setPropertiesTab`, `applyOp`, `addObject` (returns new id), `updateObject`, `deleteSelectedObject`, `setObjectAsset`, `setEnvironment`, `setLights`, `addSpawn`/`updateSpawn`/`deleteSpawn`, `undo`/`redo`/`canUndo`/`canRedo`, save lifecycle (`beginSave`/`completeSave`/`failSave`/`rebaseOnServerVersion`), selectors (`isDirty`, `getSelectedObject`). Undo stack capped at 50; rebase clears both stacks. `beginSave` caps batches at `MAX_OPS_PER_BATCH = 100`. |
| New components | `EditorShell` · `EditorTopBar` (gizmo tabs + undo/redo + Save/Publish buttons + status text) · `EditorStatusBar` (autosave state + ops count + version id) · `PhoneNotice` (< 768px) · `Viewport` (R3F Canvas with TransformControls + OrbitControls + drei `<Outlines>` selection highlight + infinite grid floor + deselect plane) · `EditorAssetMesh` (per-object `<group>` with `useGLTF` clone + ref-registration map for gizmo attach) · `AssetPanel` (asset list with drag-drop upload + XHR progress + 50 MB cap) · `PropertiesPanel` with 4 tabs · `Vec3Input` + `ColorInput` shared inputs |
| Save infrastructure | `save-client.ts` (pure fetch wrappers: `saveOps` + `publishVersion` with discriminated-union results) · `use-autosave.ts` (2s interval; `inFlightRef` re-entry guard; bounded conflict-retry — max 3 consecutive 409s → rebase on each, then `failSave` and stop until next user action) |
| New dependencies | `zustand ^5.0.13` (production) |
| Schema/migration changes | NONE — pure UI on top of 8.2 ops API + 8.3 convert |
| Documentation | `docs/frontend.md` extensively updated (6 Chunk sections + component file structure) · `docs/3d.md` updated (editor viewport architecture: no-Bounds rationale, ref-registration map, one-op-per-drag commit, `<Outlines>` selection, route-segment layout, Delete shortcut) |
| Tests | 542 → 659 (+117 across 9 new test files): editor-store (+32) · EditorTopBar shortcuts (+8) · viewport-delete-shortcut (+8) · AssetPanel (+34) · PropertiesPanel (+32) · save-client (+9) · use-autosave (+6). Viewport Canvas rendering NOT unit-tested (R3F WebGL mock too heavy for v1 — relies on prod smoke). Folder-watcher CLI also unTest unit-tested per 8.3 timebox. |
| Explicitly out of v1 (parking lot) | Multi-select · grouping · per-object material overrides · animations · grid snapping · prefabs · realtime collab (Phase 3) · phone touch gizmos (research project; 8.4.X follow-up if needed) · timeline scrubbing past versions (still-coming-soon note in version-history UI) |
| Smoke checklist (prod) | (0) Prereq: 0010 + 0011 migrations applied to prod · (1) Convert a world (8.3 button) → click "Edit world" or navigate to `/world/[id]/edit` → see 3-panel editor · (2) Click an asset in the left panel → it appears at origin in the center viewport · (3) Click the object → TransformControls gizmo appears + properties panel populates · (4) Drag the gizmo → object moves; release → status bar shows "1 op applied" (or "Saving…" → "Saved") · (5) Press R → gizmo switches to rotate; S → scale · (6) Press Cmd+Z → object snaps back to previous transform (autosave still respects the undo — no orphaned ops sent to server) · (7) Press Delete with object selected → object disappears · (8) Switch to Lights tab → change sun intensity → 3D scene updates · (9) Switch to Environment tab → change skybox preset → environment updates · (10) Click "Save as version" → prompt for label → status bar confirms save · (11) Click "Publish" → confirm dialog → status updates · (12) Refresh page → all changes persist · (13) Visit `/world/[id]` (non-edit) as a visitor → see published version · (14) Resize browser to mobile (<768px) → "Switch to a bigger screen" notice appears · (15) Drag a new `.glb` onto the asset panel → uploads → appears in list · (16) CI green |

### Slice 9 — "Worlds Are Spaces"

Bridge between Phase 2 (architecture done) and Phase 3 (community features). Driven by founder's clarification that a world is an **interactive virtual space** — a city, forest, house — where users walk around, see each other, and chat. Pulls Phase 3's async-collab + visitor-presence pieces forward.

#### Slice 9.1 — Walk mode + collision + copy reframe 🟢

| | |
|---|---|
| Status | Shipped + deployed; **no migration needed** (prod migration for 0010 + 0011 still pending from Phase 2). First sub-slice of Slice 9. |
| What | Replaces the orbit-only visitor renderer with a "preview → Enter world → walk mode" UX. Desktop: PointerLockControls + WASD + Shift-run. Touch: dual virtual joysticks (left=move, right=look). Raycast-based collision: wall-slide + floor-snap to walk up ramps; no jumping/flying/gravity in v1. Spawn from `sceneGraph.spawnPoints` (eye-level Y). ControlsHint banner first-time. ESC exits walk → preview. All user-facing "3D model" copy reframed to "world" / "space" / "Enter" / "Explore". Legacy worlds keep their existing `WorldViewer` renderer. |
| New visitor architecture | `src/components/world-visitor/` directory · `WorldVisitor.tsx` (mode state) · `WorldVisitorClient.tsx` (`dynamic({ ssr: false })`) · `PreviewMode.tsx` (OrbitControls + authored camera) · `WalkMode.tsx` (desktop keyboard + PointerLockControls OR touch joystick ref reads + manual camera rotation) · `EnterWorldOverlay.tsx` · `MobileJoysticks.tsx` (dual joysticks; pointer-event-based; `setPointerCapture`) · `ControlsHint.tsx` (localStorage-dismissed first-time banner) · `use-touch-device.ts` (hydration-safe detection) |
| Pure utilities | `movement.ts` (`computeMovement` — yaw-relative WASD + touch yaw/pitch + diagonal normalization + frame-rate-independent) · `collision.ts` (`applyCollision` — wall-slide via face-normal projection + floor-snap via downward raycast + `userData.collidable` filter + skin-width offset) |
| Refactor | Extracted `SceneGraphScene` (and inner `AssetObject`) from `SceneGraphRenderer.tsx` to its own file `src/components/scene-graph-renderer/SceneGraphScene.tsx` so both renderer paths can compose it. |
| Page wiring | `src/app/world/[id]/page.tsx` — `WorldVisitorClient` replaces `SceneGraphRendererClient`. Legacy `WorldViewerClient` path unchanged. |
| Copy reframe (user-facing) | 9 string changes across `/world/[id]/page.tsx` (OG description) · `/upload/UploadForm.tsx` (Step 1 heading + input label + TOS checkbox + TOS error) · `/upload/page.tsx` (intro + metadata) · `/page.tsx` (feed empty state) · `/search/page.tsx` (OG description). `grep -r "3D model" src/app` returns zero hits. Aria-labels containing "3D world" preserved for screen readers. |
| Schema/migration changes | NONE |
| New dependencies | NONE |
| Documentation | `docs/3d.md` extensively updated (visitor mode architecture, desktop/touch split, pointer-lock pattern, spawn resolution, EYE_HEIGHT, ref-registration map, collision algorithm) · `docs/frontend.md` updated (Chunks 4/6/7 sections + copy reframe table) · `docs/testing.md` updated (Slice 9 testing considerations: jsdom-directive gotcha, two-call raycaster mock pattern, IEEE 754 -0 in toBeCloseTo) |
| Tests | 659 → 711 (+52 across 5 new test files): `movement.test.ts` (+8) · `collision.test.ts` (+7) · `use-touch-device.test.ts` (+4) · `ControlsHint.test.ts` (+7) · `MobileJoysticks.test.ts` (+20) · `EnterWorldOverlay.test.ts` (+6). R3F-Canvas-wrapping components (`WorldVisitor`/`WalkMode`/`PreviewMode`) NOT unit-tested — environment is `node`, no WebGL; pure logic seams covered, full integration via prod smoke. |
| Explicitly out of v1 (parking lot, addressed in 9.2/9.3 or later) | Multi-user presence (9.3) · in-world chat (9.3) · "Invite collaborator" UI + editor-role gating (9.2) · jumping/flying/gravity physics (Phase 4) · trigger zones / portals (Phase 4) · voice chat (Phase 3) · persistent avatar customization (Phase 5) |
| Smoke checklist (prod) | (0) Prereq: 0010 + 0011 migrations applied to prod (✅ applied 2026-05-26) · (1) Visit a scene-graph world → see preview with "Enter world" CTA overlay · (2) Click Enter → pointer locks · WASD moves · mouse looks · Shift runs · ESC exits → returns to preview · (3) Walk into a wall → camera stops + slides along wall · (4) Walk up an inclined surface (a slanted asset) → camera Y snaps to follow the surface · (5) ControlsHint banner appears first time only · "Got it" dismisses + persists via localStorage · (6) Touch device (or DevTools device emulation in Chrome) → two on-screen joysticks instead of pointer-lock prompt · drag left = move · drag right = look · Exit button returns · (7) Legacy unconverted worlds keep working via legacy `WorldViewer` (orbit only) — untouched · (8) All upload + search + feed pages show new "world" / "space" copy; no "3D model" anywhere user-facing · (9) CI green |

#### Slice 9.2 — Collaborators 🟢

| | |
|---|---|
| Status | Shipped + deployed; prod migration for 0012 pending founder action. |
| What | Owners can invite other users as `editor` collaborators; collaborators get full access to the browser editor on that world (scene-graph ops + asset upload + asset delete + reading versions). Owners retain exclusive access to Publish, Convert-to-scene-graph, and Collaborator management. New `world_collaborators` table + extended `requireWorldRole` helper to query it for non-owners. New `getWorldRoleForUser()` exported helper returning a discriminated union for server-component consumers (cleaner than wrapping NextResponse). Notification fanout on invite; new `collaborator_added` notification type renders in the bell + `/notifications` list with a direct link to `/world/[id]/edit`. UI: `CollaboratorsSection` on world page (visible to all; owner sees Invite + Remove buttons; self-collaborator sees Leave button) + `InviteCollaboratorDialog` (native `<dialog>` modal) + `EditableWorldsSection` on profile pages (server-component grid of worlds this user can edit). |
| Schema additions | New `world_collaborators` table: `(world_id, user_id)` composite PK · `role text` (CHECK `'editor'`) · `added_at` · `added_by_id` (FK to users; ON DELETE SET NULL). Plus index on `user_id` for "worlds I can edit" reverse lookup. Plus `notifications.type` CHECK extended with `'collaborator_added'`. |
| Migration | `0012_slice9_world_collaborators.sql` — additive table + index + CHECK constraint swap on `notifications`. Zero-downtime. |
| New API routes | `GET /api/worlds/[id]/collaborators` (public; owner + collaborators list with `addedBy` hydration; cap 50) · `POST /api/worlds/[id]/collaborators` (owner-only; body `{ username }`; 201 + notify post-commit; 404 user not found; 409 dupe with `existing` body; 409 owner-as-collab) · `DELETE /api/worlds/[id]/collaborators/[userId]` (owner-or-self gate; 200 `{ removed: true }`). |
| Relaxed routes (owner → editor) | `POST /scene-graph/ops` · `POST /assets` (POST only; GET stays public) · `DELETE /assets/[assetId]` — collaborators can use the editing surface. |
| Owner-only routes (unchanged) | `POST /versions/[v]/publish` · `POST /convert-to-scene-graph` · both collaborator routes (DELETE has self-remove exception). |
| Permission helper extension | `requireWorldRole(worldId, dbUser, role)` extended via private `getCollaboratorRole()` to query `world_collaborators` for non-owners. New `getWorldRoleForUser()` discriminated-union variant (`"ok" \| "not-found" \| "forbidden" \| "db-error"`) for server components that can't return NextResponse. The Phase-3 comment in the file is now active. |
| Editor page gate | `/world/[id]/edit/page.tsx` now uses `getWorldRoleForUser()` accepting `editor` minimum role. Forbidden copy: "You don't have edit access to this world" with "Back to world" link. |
| New components | `CollaboratorsSection` (client; fetches + renders list + Invite/Remove/Leave with optimistic state) · `InviteCollaboratorDialog` (client; native `<dialog>` modal with username input + 404/409/5xx inline errors; no new deps) · `EditableWorldsSection` (server component; inline `db.query.worldCollaborators.findMany` with `with: { world }`; returns null when empty; reuses `WorldCardMedia` + `TagChip`). |
| Notification renderer | `src/app/notifications/NotificationList.tsx` extended with case `"collaborator_added"` → text `@{actor} added you as a collaborator on **{world.title}**`, href `/world/{worldId}/edit` (direct-to-action). |
| Tests | 711 → 761 (+50 across 5 new test files + 4 extensions): `world-permissions.test.ts` (+6 covering collaborator branch + `getWorldRoleForUser`) · `collaborators/route.test.ts` (+12) · `collaborators/[userId]/route.test.ts` (+6) · ops route extension (+1 editor-can-edit) · assets route extension (+1 editor-can-upload) · asset DELETE extension (+1 editor-can-delete) · `CollaboratorsSection.test.ts` (+20 via logic-extraction pattern) · `InviteCollaboratorDialog.test.ts` (+8 via discriminated-union `runSubmit` helper) · `EditableWorldsSection.test.ts` (+3 server-component query tests with stubbed components). |
| Documentation | `docs/backend.md` heavily updated (new `getWorldRoleForUser` + `WorldRoleResult` exported type; 3 new routes; 3 relaxed routes; `notifications.type` CHECK; `world_collaborators` table section) · `docs/frontend.md` (3 new components + page wiring + notification renderer table) · `docs/infra.md` (0012 migration entry; 16-table count) · `docs/testing.md` (Slice 9.2 considerations section). |
| Smoke checklist (prod) | (0) Prereq: 0012 migration applied to prod · (1) As owner, visit `/world/[id]` → see "Collaborators" section with just yourself · (2) Click "Invite collaborator" → enter another user's username → submit → row appears + dialog closes · (3) Invited user gets a notification "@you added them as a collaborator on **{title}**" in the bell + `/notifications` · (4) Click the notification → lands on `/world/[id]/edit` directly · (5) As the collaborator, visit `/world/[id]/edit` → editor opens (previously 403'd) · (6) Place objects, drag gizmo, hit Save → all work · (7) Click "Publish" button — should fail (403, owner-only); UI may surface error · (8) Visit `/profile/{collaborator-username}` → see "Worlds {name} can edit" section listing this world · (9) As owner, click "Remove" next to a collaborator → confirm → row disappears · (10) The removed collaborator visiting `/edit` again is now blocked · (11) As a collaborator, click "Leave" on own row → confirm → redirected to `/world/[id]` (now read-only for them) · (12) Invite same user twice → second time returns 409 with helpful "already a collaborator" inline error · (13) Invite an unknown username → 404 with "No user @{username}" · (14) Invite yourself (owner) → 409 "you can't invite yourself" · (15) CI green |

#### Slice 9.3 — Multi-user presence + chat via Liveblocks 🟢

| | |
|---|---|
| Status | Shipped + deployed; `LIVEBLOCKS_SECRET_KEY` added to Vercel env by founder. Awaiting two-device prod smoke. |
| What | Visitors in walk mode see other live visitors as named capsule avatars in 3D + can chat with them via an in-world overlay. Anonymous visitors get auto-generated guest names + colors and can fully participate (no sign-in required for early days). Each world = one Liveblocks room. Pulls Phase 3's "Presence" piece forward. Realtime EDITOR presence + voice chat + kick/mute remain as the post-Slice-9 Phase 3 work. |
| Realtime backbone | **Liveblocks v3.19.3** (already named in PROJECT.md stack as the planned choice). Free tier: 100 MAU + 100 concurrent + 7-day chat history. React-hooks-first SDK. Presence + Broadcast events used; Storage not used (scene-graph stays in our Postgres). |
| New deps | `@liveblocks/client ^3.19.3` · `@liveblocks/react ^3.19.3` · `@liveblocks/node ^3.19.3` (all production deps) |
| New env var | `LIVEBLOCKS_SECRET_KEY` — server-only, used by `getLiveblocksClient()` for JWT issuance; never exposed to the client bundle (`import "server-only"` guard in `src/lib/liveblocks/server.ts`) |
| New API route | `POST /api/liveblocks/auth` — public (signed-in OR anonymous guest). Body `{ room: uuid, guestId? }`. Signed-in path: looks up DB user, 403 if suspended, builds `userInfo = { name: "@username", avatarUrl, color: visitorColor(dbUser.id), isGuest: false }`. Guest path: requires `guestId`, builds `userInfo = { name: "Guest_XXXX", avatarUrl: null, color: visitorColor(guestId), isGuest: true }`. Issues Liveblocks JWT via `session.allow(worldRoomId(id), FULL_ACCESS)`. Returns raw JSON token body. 400/403/404/503 errors. |
| New lib modules | `src/lib/liveblocks/server.ts` (lazy singleton `getLiveblocksClient()` with `import "server-only"`) · `src/lib/liveblocks/types.ts` (`VisitorPresence`, `VisitorUserInfo`, `RoomEvent`, `worldRoomId()`) · `src/lib/liveblocks/types.d.ts` (global `Liveblocks` interface augmentation for hook typing) · `src/lib/visitor-color.ts` (djb2 hash → deterministic HSL) · `src/lib/guest-id.ts` (`getOrCreateGuestId` sessionStorage-backed, fallback to non-persistent generator on private browsing) |
| New components | `LiveblocksRoomProvider` (client wrap; `<LiveblocksProvider authEndpoint={...}><RoomProvider id={worldRoomId} initialPresence={...}>`; sends `guestId` in every auth POST — server picks identity path) · `PresenceLayer` (R3F; `useOthers()` → maps to `<VisitorAvatar>`; filters `position: null` + `inWalkMode: false`) · `VisitorAvatar` (R3F; capsule + drei `<Billboard><Text>` name tag in user color; `userData.collidable = false` so others' avatars don't block your walk-mode raycasts) · `ChatPanel` (DOM-only overlay; pure-helper extraction for testability — `submitChat()` + `appendIncoming()`; rate-limit 1 msg/1.5s; 280-char cap; 30-message buffer; T-key focus / ESC-blur; auto-scroll to bottom) |
| WalkMode integration | `useUpdateMyPresence()` on mount → announces `inWalkMode: true`; cleanup on unmount → `inWalkMode: false, position: null`. In `useFrame`: 100ms client-side throttle pushes `{ position, yaw, pitch, inWalkMode: true }` (Liveblocks's own throttle is a second layer of insurance). |
| Identity model | Signed-in: `user_{dbUserId}` (stable across sessions) · Anonymous: `guest_{4-char-id}` (sessionStorage-persisted per browser tab; cleared on close). Visitor color hashed from the identifying id → same color across sessions for signed-in, per-tab for guests. |
| Self-avatar | Not rendered (camera IS you — standard FPS convention) |
| Self-message echo | Liveblocks's `useEventListener` does NOT fire for own broadcasts. `ChatPanel` locally appends sent messages with `isSelf: true` so the sender sees their own line immediately. |
| Suspended user behavior | Auth route 403s at JWT issuance → Liveblocks connection fails → user invisible in `useOthers()` + chat broadcast no-ops. Cleanest moderation hook for v1. |
| Schema / migration changes | NONE — presence is ephemeral in Liveblocks, chat is ephemeral per session (not DB-persisted in v1). |
| Documentation | `docs/3d.md` updated (presence layer architecture + visitor avatar geometry + Liveblocks integration in WalkMode) · `docs/backend.md` (auth route + liveblocks lib directory + `LIVEBLOCKS_SECRET_KEY` gotcha) · `docs/frontend.md` (LiveblocksRoomProvider wrap + ChatPanel architecture + T-key/ESC wiring) · `docs/infra.md` (Liveblocks account setup + free-tier limits + upgrade trigger + env var matrix) · `docs/testing.md` (Slice 9.3 testing considerations: Liveblocks server mock, two-call db.select pattern, `server-only` bypass, IUserInfo cast) |
| Tests | 761 → 799 (+38 across 6 new test files): `visitor-color.test.ts` (+3) · `guest-id.test.ts` (+7) · `liveblocks/types.test.ts` (+2) · `liveblocks/auth/route.test.ts` (+13) · `ChatPanel.test.ts` (+13 via pure-helper `submitChat` + `appendIncoming`). R3F-Canvas-wrapping components (`PresenceLayer`, `VisitorAvatar`, `LiveblocksRoomProvider`) NOT unit-tested — consistent with Phase 2 + 9.1 precedent (env is `node`, no WebGL); integration coverage via prod smoke. |
| Cost trajectory | Free tier: 100 MAU + 100 concurrent + 7-day chat history. Sufficient for current scale (~31 worlds, handful of users). Upgrade trigger documented in `docs/infra.md`: ~1K active users or first MAU-cap notification → Starter plan. R2 egress remains $0; only added cost is Liveblocks subscription (currently $0). |
| Explicitly out of v1 (parking lot) | Realtime EDITOR presence (live collab editing in 3D) · voice chat (LiveKit/WebRTC) · kick/mute moderation tools · DB-persisted chat history · avatar customization · server-side chat rate-limit · skinned avatars · position-lerp smoothing (raw position-set is acceptable with Liveblocks's ~100ms updates) |
| Smoke checklist (prod) | (0) Prereq: 0012 migration applied + `LIVEBLOCKS_SECRET_KEY` in Vercel env · (1) Open two browsers (or normal + incognito) to same `/world/[id]` URL · (2) Both click "Enter world" → see each other's capsule + name tag moving as the other person moves · (3) Movement is fluid (some jitter is OK at ~10/sec presence rate) · (4) Press T → chat input focuses · type a message + Enter → sent · other window receives it · (5) Try rapid-fire 3 messages → second/third are rate-limited until 1.5s elapsed · (6) Sign out in one window → still see avatar (now as Guest_XXXX guest) · (7) Suspended user → auth route 403s → can't enter (avatar doesn't appear in other window) · (8) Refresh one window → other window's `useOthers()` updates (the connection drops + reconnects) · (9) Visit on phone → joysticks work + chat overlay visible (touch friendly?) · (10) CI green |

### Slice 10 — Realtime editor collab (Phase 3 work)

10.1 ships visibility into who else is editing the same world. Concurrent CRDT-based co-editing (10.2) + voice chat (10.3) remain planned but not started.

#### Slice 10.1 — Realtime editor presence 🟢

| | |
|---|---|
| Status | Shipped + deployed; no migration needed. |
| What | When 2+ editors open `/world/[id]/edit` on the same world, they see each other live: cursor positions as colored 3D spheres + name tags · selection outlines on objects the OTHER editor has selected (wireframe box in their user color) · "X other editor(s) here" text in the status bar · avatar stack in the top bar (up to 4 + overflow pill) · in-editor chat panel (same `ChatPanel` from 9.3) · rebase-toast banner when autosave merges another editor's changes on top of yours. Single Liveblocks room per world means visitors + editors overlap in presence (visitors filtered out of editor 3D view by `mode === "editor"` guard; editors filtered out of visitor walk view by `isWalkingVisitor` guard). |
| Realtime backbone | Same Liveblocks v3.19 from 9.3 — single room per world (`world:${worldId}`). No new deps, no new env vars, no new schema. |
| Presence shape | Refactored `VisitorPresence` into a **discriminated union** `UserPresence = VisitorPresence \| EditorPresence` with `mode: "visitor" \| "editor"` discriminant. New `EditorPresence` shape: `{ mode: "editor", cursorWorldPos: [x,y,z] \| null, selectedObjectId: string \| null, gizmoMode }`. (Camera position omitted from v1 — adds when a consumer ships.) Type guards `isWalkingVisitor()` + `isEditor()` exported for both surfaces' filters. |
| Provider refactor | `LiveblocksRoomProvider` now requires `initialPresence: UserPresence` as a prop instead of hardcoding visitor shape. Visitor page passes `INITIAL_VISITOR_PRESENCE`; editor page passes `INITIAL_EDITOR_PRESENCE`. |
| New components | `EditorPresenceLayer` (R3F; `useOthers()` → filter `isEditor` → render `<RemoteEditorCursor>` + `<RemoteEditorSelectionOutline>` per remote editor) · `RemoteEditorCursor` (small sphere + drei Billboard name tag in remote editor's color) · `RemoteEditorSelectionOutline` (scene-traverse by `userData.objectId` → wireframe `<boxGeometry>` at the bounding box, in remote editor's color) · `EditorCollaborators` (top-bar avatar stack; `next/image` avatars with `referrerPolicy="no-referrer"`; initials fallback; max 4 circles + `+N` pill; hidden below `xl` breakpoint to preserve top-bar space) · `RebaseToast` (bottom-center floating pill; "Another editor's changes were merged in — your edits applied on top."; auto-dismisses after 5s) |
| New hook | `useEditorPresence()` — called from inside the editor `<Canvas>` (via tiny `EditorPresenceWiring` zero-render component). Pure helper `computeEditorPresence({ pointer, camera, scene, raycaster, selectedObjectId, gizmoMode })` reads R3F's NDC pointer + raycasts to find cursor world position, filters out non-collidable hits, returns the next presence shape. Throttled to 100ms + dedupes on serialized state. |
| Existing components extended | `EditorAssetMesh` — added `userData={{ objectId }}` to outer group so `RemoteEditorSelectionOutline` can find it via `scene.traverse()` (additive only) · `EditorTopBar` — slot for `<EditorCollaborators />` · `EditorStatusBar` — "Just you editing" / "N other editors here" text + sibling `<RebaseToast />` mount · `EditorShell` — drops `<ChatPanel />` + `<RebaseToast />` as floating siblings · `PresenceLayer` (visitor) — refactored to use `isWalkingVisitor()` guard (now resilient to editor presence in the same room) · `editor-store` — `lastRebaseNotice: RebaseNotice \| null` + `setRebaseNotice()` action; cleared on `initialize()` · `use-autosave` — calls `setRebaseNotice({ authorName: null, at: Date.now() })` on the 409→rebase branch (3rd-bail path does NOT trigger a notice) |
| T-key conflict | Pressing T outside any input simultaneously triggers EditorTopBar's "translate gizmo" handler AND ChatPanel's "focus chat input" handler. Side effect is harmless — gizmo flips to translate, chat input takes focus, user starts typing. Could swap to `/` later if it bothers users. |
| Author attribution in rebase toast | Omitted v1 (would need to extend the 409 response shape to include `author` from the version row's `with: { author: true }` join — small but additional surface). Notice currently says "Another editor's changes were merged in" without naming. Parked in TODO comment for follow-up. |
| Schema / migration changes | NONE — 10.1 is pure presence + UI layered on Slice 9.3's infrastructure. |
| New env vars | NONE — reuses `LIVEBLOCKS_SECRET_KEY` from 9.3. |
| Auth | NONE new — editor page is role-gated (9.2) so only owners + editor collaborators can connect with editor presence. |
| Documentation | `docs/3d.md` (editor presence layer architecture, `userData.objectId` tagging, NDC pointer + raycast pattern) · `docs/frontend.md` (Chunk 1-4 sections: provider refactor, EditorCollaborators, RebaseToast, T-key conflict note) · `docs/testing.md` (10.1 Chunk 5 testing notes, Three.js in node env, `runSaveCycleWithRebaseNotice` DI pattern) · `docs/backend.md` (presence type union + provider prop change) |
| Tests | 799 → 822 (+23 across 1 new test file + 3 extensions): `liveblocks/types.test.ts` (+14 — type guards + initial-presence constants) · `use-editor-presence.test.ts` (+4 — pure helper with real Three.js Scene + Raycaster) · `editor-store.test.ts` (+3 — rebase notice get/set/clear) · `use-autosave.test.ts` (+2 — rebase branch sets notice; bail path does not). R3F-Canvas-wrapping components (`EditorPresenceLayer`, `RemoteEditorCursor`, `RemoteEditorSelectionOutline`) + the effect-heavy `RebaseToast` NOT unit-tested — consistent with the Phase 2 + Slice 9 precedent. |
| Explicitly out of v1 (parking lot) | Concurrent CRDT-based co-editing (Slice 10.2 — Liveblocks Storage with Y.js) · author name in rebase toast (needs `with: { author: true }` join on the 409 path) · camera frustum visualization for remote editors · "Follow this editor" mode · voice chat in editor (Slice 10.3 — LiveKit) · separate visitor/editor chat threads · per-editor selection lock · save-attribution timeline in version history UI · "Someone joined/left" toasts |
| Smoke checklist (prod) | (0) Prereq: 0012 migration applied + `LIVEBLOCKS_SECRET_KEY` in Vercel env · (1) Open `/world/[id]/edit` on a converted world you own · (2) In a second browser (incognito or another device), sign in as a collaborator + open the same edit URL · (3) Both see each other's avatar in the top-bar collaborator stack · (4) Move mouse → your cursor sphere appears in the OTHER editor's viewport in your color, tracking your raycast position over the scene · (5) Click an object → wireframe outline appears in B's viewport in your color (and vice versa) · (6) Press T → chat input opens · type a message + Enter → other editor sees it · (7) Status bar shows "1 other editor here" · (8) Both editors save concurrently → 409 fires → autosave rebases → small blue "Another editor's changes were merged in" toast appears at bottom-center · (9) Open `/world/[id]` (visitor side) in a third window → enter walk mode → walking visitor's capsule appears in editor 3D view? NO — editor's `mode === "editor"` filter excludes visitors (intentional; reduces clutter) · visitor sees no editors in their walk view (no `inWalkMode` field on editor presence — naturally excluded by `isWalkingVisitor` guard) · (10) Chat is shared between editors + visitors (same room) — typing in one surface shows in the other · (11) CI green |

## 4. Known Issues / Follow-ups (Open)

Things that work but should be cleaned up before or shortly after launch.

| # | Issue | Severity | Where |
|---|---|---|---|
| 1 | ~~No "Unsuspend" button in admin UI — currently SQL-only~~ **Resolved** — Suspended tab + `UnsuspendButton` shipped (launch-ops task, this session) | — | `/admin/reports?view=suspended` |
| 2 | `/legal/dmca` placeholder email (`dmca@forge.example`) | **Blocker for public launch** | `src/app/legal/dmca/page.tsx` |
| 3 | `/legal/terms` draft shipped — reviewable starting point exists. Attorney review still required before public launch; governing law + contact email are explicit placeholders in the file. | **Still needs attorney review + final copy before public launch** | `src/app/legal/terms/page.tsx` |
| 4 | Slices 2, 4, 5 deployed but not yet prod-smoke-tested (Slices 6 + 7 verified) | Medium | Production |
| 5 | ~~`dbPool` (WebSocket Drizzle client) doesn't have schema wired — `db.query.*` only works on `db` (HTTP).~~ **Resolved 2026-05-26 (Slice 8.2)** — `src/db/index.ts` one-line fix: `drizzlePool({ client: pool, schema })`. Relational `tx.query.*` now works inside transactions; used by `POST /scene-graph/ops`. | — | `src/db/index.ts` |

## 5. Test Coverage

| Metric | Value |
|---|---|
| **Total** | **57 test files / 822 tests** — all passing on main |
| Per-slice inventory | See `docs/testing.md` "Test Inventory by Slice" — owned + maintained by `test-engineer` |
| 3D / R3F component tests | None (deferred to Phase 2 per `docs/testing.md`) |
| E2E (Playwright/Cypress) | None (unit + integration only) |

> The per-slice breakdown lives in `docs/testing.md` to avoid drift between two tables. forge-lead refreshes the total here after each slice ships.

## 6. Verification Commands

Run anytime to verify state:

```bash
git log --oneline -5            # Recent commits
git status                       # Clean tree expected
npm test                         # 822 tests expected
npm run build                    # Clean build expected
npm run db:smoke                 # All 14 tables present, current row counts
```

## 7. How to Update This Doc

- **After every slice ships:** mark sub-slices ✅, update test count, update commit hash, add any new known issues
- **After every prod smoke test:** flip 🟢 → ✅ (or surface a blocker)
- **When a new slice starts:** add a new section under the current phase
- **When a phase exits:** update the Phase Rollup table

This is the operational doc. PROJECT.md tracks decisions. ROADMAP.md tracks the long arc. TRACKER.md tracks *progress* — what's done, what's pending, what's broken.
