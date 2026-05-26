# FORGE — Project Tracker

> The "what are we doing this week" doc. For the long arc, see `ROADMAP.md`.

**Last updated:** 2026-05-26 (9.1 close)
**Current phase:** Slice 9 — "Worlds Are Spaces" reframe (bridge between Phase 2 and Phase 3; Phase 1 launch ops deferred per founder; see `DEFERRED.md`)
**Current slice:** Phase 2 (8.1–8.4) feature-complete + Slice 9.1 (walk mode + collision + copy reframe) shipped 2026-05-26 🟢. **9.2 (collaborators) + 9.3 (multi-user presence + chat via Liveblocks) next.**
**Builder:** Solo (student)
**Build tool:** Claude Code

---

## 1. What FORGE Is (Right Now)

A social platform for publishing 3D worlds. Creators upload `.glb` files, viewers browse a feed, the usual social mechanics work (likes, comments, reposts, follows, share). World owners can post text updates that appear on the world page and in followers' feeds. Reports + admin moderation work end-to-end.

**What FORGE will become:** see `ROADMAP.md`. The short version: a network of interconnected, collaborative, interactive user-created virtual worlds. Web-first. Creator-owned. No crypto. No VR rabbit hole.

## 2. Current State Snapshot

| Metric | Value |
|---|---|
| Slices shipped | 0, 1, 2, 3, 4, 5, 6, 7 ✅ · Phase 2 (8.1 + 8.2 + 8.3 + 8.4) 🟢 · Slice 9.1 🟢 |
| Phase 1 launch ops | Deferred per founder — see `DEFERRED.md` |
| Tests passing | 711 across 46 test files |
| Commits on main | Slices 0–7 + Phase 2 + Slice 9.1 closeout (latest commit pending) |
| Latest commit | (this commit — Slice 9.1 Walk mode + collision + copy reframe) |
| Production URL | https://forge-black-eta.vercel.app |
| GitHub | https://github.com/MK-Sindhu/forge |
| DB | Neon Postgres — 14 tables, 11 migrations applied locally (0010 = 8.1 scene-graph substrate: `world_assets` + `world_versions` + 2 columns on `worlds`; 0011 = 8.2 two `world_versions` indexes). **Prod migration for 0010 + 0011 pending founder action.** |
| Storage | Cloudflare R2 — 2 buckets (forge-glb, forge-media), public read. 8.2 adds `assets/{userId}/{assetId}/asset.glb` prefix under `forge-glb`. |
| Branch state | `main` clean, in sync with `origin/main` |
| Slices verified in prod | 1, 3, 6, 7 ✅ — 2, 4, 5, 8.1, 8.2, 8.3, 8.4, 9.1 deployed but not yet prod-smoked |
| In-flight | Awaiting founder prod migration for 0010 + 0011 (Phase 2 schema; 8.3 + 8.4 + 9.1 add no migrations — ONE migration step covers Phase 2 + 9.1); then prod smoke of walk mode + collision + copy reframe (9.1) alongside Phase 2 features. Then 9.2 (collaborators). |

## 3. Stack (Locked)

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS |
| Auth | Clerk v7 |
| ORM | Drizzle |
| Database | Neon Postgres |
| Storage | Cloudflare R2 |
| 3D | React Three Fiber + drei |
| Deploy | Vercel (frontend + API) + Neon (DB) + R2 (storage) |
| CI | GitHub Actions (lint + test + build on PR/push to main) |
| AI (when needed) | Anthropic Claude API |
| Realtime (Phase 3+) | TBD — Liveblocks recommended |

## 4. Slices Shipped (Phase 0 — Foundation ✅)

Brief summary. Full detail in git history and previous handover.

- **Slice 0 — Foundation.** Next.js + Clerk + Drizzle + Neon + R2 + Vercel + GitHub Actions CI + 6 custom Claude Code subagents.
- **Slice 1 — Core upload + view.** Users table, worlds table, world_media, likes. R2 presigned uploads. World viewer (R3F + drei). Upload flow. Profile pages. Feed.
- **Slice 2 — Rich media gallery.** Optional preview video + up to 4 images per world. Hover-to-play on feed/profile cards. Media carousel on world page.
- **Slice 3 — Social baseline.** Follows table. Likes API. Like + Follow buttons (optimistic). Recent / Following feed tabs.
- **Slice 4 — Engagement.** Comments. Reposts. Share button (Web Share API → clipboard fallback). Following feed merges originals + reposts.
- **Slice 5 — World updates timeline.** Text-only world updates on the world page, surfaced in Following feed as a third entry type.
- **Slice 6 — Moderation.** Reports table. Admin reports queue. Suspensions. Admin role. Suspension guards on 12 write endpoints. Suspension-exempt safety valve for the report endpoint. DMCA stub page.
- **Slice 7 — Discovery polish.** Tags (free-form, max 5 per world). Postgres FTS search (title + description + tag names). Per-user-per-day view tracking. Trending feed tab (likes × decay). In-app notifications (bell + `/notifications`) for like / comment / follow / new-world-from-followee.
- **Slice 8.1 — Scene Graph Foundation (Phase 2).** Storage substrate for the scene-graph era. `worlds.scene_graph jsonb` + `worlds.published_version_id uuid` + `world_assets` + `world_versions` tables. `SceneGraphV1` Zod schema (objects + lights + environment + spawnPoints + camera; Euler rotations; 8 skybox presets). `SceneGraphRenderer` (R3F; lifts WorldViewer's Canvas + Bounds + OrbitControls + lighting + error boundary). `/world/[id]` branches between renderers. All 31 legacy worlds unaffected.
- **Slice 8.2 — Scene Graph API (Phase 2).** Operations-based REST surface on top of 8.1's substrate. 7 routes (1 modified + 6 new): GET `/scene-graph` · POST `/scene-graph/ops` (ops batch ≤100; optimistic concurrency 409 with full rebase body) · GET `/versions` (cursor-paged audit log; author hydrated) · POST `/versions/[v]/publish` · POST/GET `/assets` · DELETE `/assets/[assetId]` (strict integrity — refuses 409 if any past version references the asset). POST `/api/uploads/sign` extended with `kind: "asset"`. New library modules: `src/lib/scene-graph/operations.ts` (8 op Zod schemas + `applyOps` reducer + `OperationError`) + `src/lib/world-permissions.ts` (`requireWorldRole` returning `{ world, role }`; Phase-3-ready). `dbPool` schema wiring (resolves Slice 7 gotcha). Public-API-quality `docs/scene-graph-api.md` (1,130 lines). **No frontend changes — 8.4 will be the first client.**
- **Slice 8.3 — Improved Upload + Convert + Folder-Watcher CLI (Phase 2).** First visible UI in Phase 2. Adds `set_object_asset` op (9th op; closes 8.2 gap so the CLI can swap assets in-place). New route `POST /api/worlds/[id]/convert-to-scene-graph` (owner-only; reuses existing R2 object; inserts `world_asset` + initial published `world_version` + flips `worlds.scene_graph` in a transaction). New components on world page: `ConvertToSceneGraphButton` (owner-only, only renders on legacy worlds) + `VersionHistorySection` (owner-only, only renders on scene-graph worlds; cursor-paginated list with publish actions). Folder-watcher CLI `scripts/forge-watch.ts` (chokidar-based, session-cookie auth, presign+upload+ops on file change; `set_object_asset` swap on file modify; one-day timebox honored). 8.5 absorbed.
- **Slice 8.4 — Browser Editor (Phase 2 headline).** Full in-browser scene-graph editor at `/world/[id]/edit`. Three-panel layout: assets (with drag-drop `.glb` upload, 50 MB cap, XHR progress) · viewport (R3F Canvas, TransformControls gizmo, OrbitControls, drei `<Outlines>` selection highlight, infinite grid floor) · properties panel (4 tabs: object transform/name/delete · lights add/remove with intensity/color/sun-direction · environment skybox/fog · spawn-points). Zustand store (`editor-store.ts`) holds the editing state with per-op undo/redo (cap 50). Autosave hook flushes pending ops every 2s via `POST /scene-graph/ops` with optimistic-concurrency rebase on 409 (max 3 consecutive retries before `failSave`). Manual "Save as version" (optional label) + "Publish" wired to the API. Keyboard: T/R/S gizmo mode · Delete/Backspace · Escape · Cmd+Z/Shift+Z. Desktop-first, tablet-supported, phones see a "switch device" notice. No phone touch gizmos in v1 (research project parked). No multi-select / grouping / per-object materials / grid snap / prefabs in v1 (parking lot). Added `zustand ^5.0.13` to dependencies.
- **Slice 9.1 — Walk mode + collision + copy reframe (Slice 9, first sub-slice).** Replaces the orbit-only visitor experience with "preview → Enter world → walk around." Desktop: PointerLockControls + WASD + Shift-run. Touch: dual virtual joysticks (left=move, right=look). Raycast-based collision: wall-slide + floor-snap to walk up ramps; no jumping/flying/gravity in v1. Spawn from `sceneGraph.spawnPoints` at eye-level. ControlsHint first-time banner. ESC exits walk → preview. Extracted `SceneGraphScene` to its own file (composable across both renderer paths). Copy reframe across upload form, feed empty state, search description, world page OG description, world-card CTAs — "3D model" / "View" → "world" / "Enter" / "Explore" / "Visit". Legacy `WorldViewer` path unchanged. No schema or migration changes.

## 5. Current Slice — Slice 7 (Discovery Polish) — SHIPPED 2026-05-24

**Goal:** ship the discovery layer FORGE needs to launch publicly. Search, tags, view counts, trending, notifications.

### Sub-slices (in build order)

1. **Tags** — creators pick 1–5 tags per upload. Free-form (hashtag style) — decided.
2. **Search** — Postgres full-text search (`tsvector` on title + description + tags).
3. **View counts** — debounced, 1 view per user per world per day.
4. **Trending** — new feed tab, `likes × time-decay` ranking. Recent tab stays purely chronological.
5. **Notifications** — bell icon in nav + `/notifications` page. Events: like, comment, follow, new world from followee. In-app only — email/push parked.

### Schema additions Slice 7 will need

- `tags` (id, name unique)
- `world_tags` (world_id + tag_id, composite PK)
- `notifications` (id, user_id, type enum, actor_id, world_id nullable, comment_id nullable, created_at, read_at nullable)
- `world_views` or denormalized counter on `worlds` — TBD during planning

### Slice 7 design decisions (locked)

- **Tags format:** free-form, lowercase, max 32 chars each, max 5 per world
- **Notification triggers:** like, comment, follow, new-world-from-followee. Nothing else (no "X liked your comment", no "X reposted you" — too noisy for v1)
- **Trending algorithm:** simple `likes × decay(age_in_hours)`. Tune after launch.
- **Email / push notifications:** parked for now. In-app feed only.

### Launch ops (in parallel with Slice 7)

These ship before public launch, not after Slice 7:

- Real Terms of Service page (currently 404 stub)
- Real DMCA contact email (currently `dmca@forge.example` placeholder)
- Unsuspend button in admin UI (currently SQL-only)
- Onboarding pass — what does a brand-new signed-in user see on an empty feed?
- 30–50 seed worlds before public launch
- Basic analytics — Plausible or PostHog
- Launch order: r/threejs + r/blenderhelp first, X/Bluesky in parallel, HN Show HN last after 200+ users and zero showstoppers

## 6. Slice 6 Smoke Test (Verified 2026-05-24)

All 5 production checks passed:

1. ✅ Admin link appeared in nav after hard refresh
2. ✅ `/admin/reports` accessible to admin user
3. ✅ Report-a-world flow works — submitted reports land in the Open tab
4. ✅ Resolve action moves the row from Open → Resolved
5. ✅ Safety-valve confirmed — suspended user blocked from likes/comments/uploads (403) but can still file reports (200)

Slice 6 is now considered fully shipped + verified. No further action required.

## 7. Decision Log

Format: date — decision — reasoning.

- **2026-05-23** — Name is FORGE. Locked.
- **2026-05-23** — Web-first. No VR/AR in MVP. Reason: solo student, foundation focus.
- **2026-05-23** — Original MVP definition shipped through Slice 6. Phase 0 complete.
- **2026-05-23** — AI text-to-world generation **not** the core product. Repositioned as: small assistive feature in Phase 2 editor, headline feature in Phase 5.
- **2026-05-23** — Worlds in MVP = uploaded `.glb` files, not AI-generated. Decision validated by ship-through-Slice-6.
- **2026-05-23** — Slice 7 (discovery polish) before Slice 8 (architectural pivot). Reasons in `ROADMAP.md`.
- **2026-05-23** — Phase 2 scope: universal scene graph API + multiple editing surfaces, all equal. Browser editor ships as the first client. No tier system between casual/pro creators.
- **2026-05-23** — Native desktop app, Blender/Unity plugins, full real-time bidirectional sync: parked, architecturally enabled by the scene graph API.
- **2026-05-23** — Folder-watcher CLI: in Phase 2, one-day time box, ships last so it can be cut cleanly if scope pressure hits.
- **2026-05-23** — Tags free-form (not curated taxonomy). Trending uses simple `likes × decay`. Notifications scoped to like / comment / follow / new-world-from-followee.
- **2026-05-24** — Slice 7 plan-time decisions: (a) view-count storage = `world_views` table with `UNIQUE(viewer_id, world_id, day)` + recount of `worlds.views` (matches likes recount-from-source pattern), NOT app-cache. (b) Notification timing = AFTER the action's transaction commits, in a try/catch best-effort call (notification failure must NEVER break a like/comment/follow/upload). (c) Anonymous views ignored — only signed-in views increment `worlds.views` (no IP-hash, no session cookie, predictable + no PII). (d) Migration strategy = one file per sub-slice (0006–0009) NOT one big 0006 — migrations are immutable once applied, per-sub-slice files enable incremental ship + smoke. (e) Tab order = Recent → Trending → Following (Trending public, Following auth-gated). (f) Search via Postgres FTS + GIN index on a DB-managed `worlds.search_vector` column NOT in the Drizzle schema — populated by 2 triggers (BEFORE on worlds for title/desc changes; AFTER on world_tags for tag-list changes).
- **2026-05-26** — **Strategic pivot: skip remaining Phase 1 launch ops (DMCA email, attorney review of Terms/Privacy, public launch posts) and start Phase 2 immediately.** Defies ROADMAP's "wait for Phase 1 exit before Phase 2" guidance. Founder rationale: the launch was for personal validation; move to the real product (scene graph + editor). Trade accepted: Phase 2 ships against the 31-world prod platform with no public traffic to break — actually safer for an architectural hinge. Public launch happens post-Phase-2. Deferred items tracked in `DEFERRED.md` (new file; loaded by forge-lead at session start but not proactively raised).
- **2026-05-26** — Phase 2 plan-time decisions (sub-slice 8.1): (a) Scene-graph format = roll-your-own minimal versioned JSON (NOT USD, NOT full glTF extensions); `{ schemaVersion: 1, ... }` from day one for future-proof migrations. (b) Storage = new `worlds.scene_graph jsonb` column, nullable — NULL means legacy GLB-only world (renderer branches on this). (c) Asset model = new `world_assets` table; world-scoped only in Phase 2 (cross-world asset library is Phase 5). R2 keys at `assets/{userId}/{assetId}/asset.glb` (reuse `forge-glb` bucket, new prefix). (d) Versioning = drafts + published; `world_versions` rows are immutable snapshots; autosave drafts (every ~2s) + manual "Save as version" + manual "Publish" (8.4 ships this UX). (e) Rotation encoding = Euler vec3 in v1 (editor simplicity, document precision trade); switch to quaternion in v2 when an animation system needs it. (f) v1 scene-graph stays truly minimal — no per-object material override, no per-object lighting, no bounding-volume metadata. (g) Folder-watcher CLI in 8.3 = **SHIP IT** (one-day timebox; cut cleanly if it overruns). (h) AI editor assist (8.6) + all AI integration = **PARKED ENTIRELY** until founder asks (added to `DEFERRED.md`). (i) "Web native" future option (PWA / WebGPU / deeper web-platform APIs) = architecturally preserved via API-first design; no decision yet (flagged in `DEFERRED.md`).
- **2026-05-26** — **Founder conceptual reframe + Slice 9 scope expansion.** Founder clarified that a "world" in FORGE is meant to be an **interactive virtual space** (city, forest, house, etc.) that users **enter and walk around in**, with **multi-user presence + chat** for the "community" feel, and **collaboration** so multiple users can build a world with the owner's permission. This is the product identity Phase 2's scene-graph + editor was building toward, but the visitor frontend was still Sketchfab-style (orbit around a static model). Founder said "we have a lot of time — bold changes welcome," authorizing the pull-forward of Phase 3's async-collab + presence pieces. **Slice 9** ("Worlds Are Spaces") was scoped as 3 sub-slices: 9.1 walk mode + collision + copy reframe · 9.2 collaborators (world_collaborators table + Invite UI + editor-role gate) · 9.3 multi-user presence + in-world chat via Liveblocks. What remains for true Phase 3 after Slice 9: realtime EDITOR presence (live collaborative editing in 3D), voice chat, kick/mute moderation tools. Plan locked at `/Users/mk_sindhu/.claude/plans/plan-slice-7-hazy-crystal.md`.
- **2026-05-26** — Slice 9.1 plan-time decisions (Walk mode + collision + copy reframe): (a) Visit default = "Enter world" CTA over orbit preview (satisfies browser PointerLock user-gesture requirement; matches Mozilla Hubs / VRChat convention). (b) Walk on desktop = drei `<PointerLockControls>` + WASD + Shift-run; touch = custom dual virtual joysticks (~150 LOC, no library); both ship together since founder picked "gameplay combo." (c) Movement = 4 units/sec walk + 8 units/sec run, frame-rate-independent (delta * speed). (d) Look = yaw + pitch only, no roll. (e) Spawn at first `spawnPoints[]` entry (prefer `id == "default"`); eye-height 1.6 above the spawn Y. (f) Collision = raycast-based — wall-slide via face-normal projection, floor-snap via downward raycast — NO physics engine. Filter via `userData.collidable !== false` (default opt-in). No gravity, no jumping, no flying in v1. (g) Anonymous-friendly = "for some time we can allow with less options" per founder; signed-out visitors will get auto-generated guest names in 9.3 (no sign-in required for walk + chat in early days). (h) Copy reframe = "world" / "space" / "Enter" / "Explore" / "Visit"; eliminate "3D model" / "View" from user-facing strings. (i) Refactored `SceneGraphScene` to its own file so both the visitor `WorldVisitor` and the existing `SceneGraphRenderer` can compose it without duplication. (j) R3F-Canvas-wrapping components NOT unit-tested (consistent with Phase 2 — environment is `node`, no WebGL); pure logic seams (movement, collision, joystick handlers, hint dismissal) ARE tested. (k) Phone walk-mode = full joystick experience (NOT a "switch device" notice like the editor) — visitor experience should work on phones for casual browsing.
- **2026-05-26** — Phase 2 plan-time decisions (sub-slice 8.4 — Browser Editor): (a) **Zustand** chosen over React reducer or Redux for the editor store — cleaner selectors, no Provider boilerplate, ~3KB; production dependency. (b) **Undo/redo = per-op snapshot pairs** (before/after) rather than command pattern — cap 50, rebase clears stacks. Pending-ops are truncated on undo so unsaved progress stays consistent with the visible state. (c) **Autosave = 2s interval** flushing `pendingOps` to `POST /scene-graph/ops`; silent (no save spinner — status bar only); `inFlightRef` re-entry guard. Max **3 consecutive 409 retries** with rebase between each, then `failSave` and stop until user manually saves (prevents infinite rebase loops). (d) **One op per gizmo drag** — TransformControls `onMouseDown`/`onMouseUp` brackets the drag; final position/rotation/scale read on release and dispatched as a single `update_object`. Avoids 60 ops/sec spam. (e) **No `<Bounds>` in editor** — would auto-fit on every change. Manual OrbitControls + initial camera from `sceneGraph.camera` (camera is NOT persisted on viewport pan — only the v1 default view). (f) **drei `<Outlines>` for selection highlight** — cheaper + cleaner than postprocessing outline pass. (g) **TransformControls attachment via ref map** (Map<id, Group> in viewport); per-mesh refs registered on mount/unmount. Simpler than scene-traversal-by-name. (h) **Properties number inputs debounce by blur** (not by debounce timer) — local state per input, commit on blur or Enter; force-sync when not focused. Matches Blender/Unity feel. (i) **Rotation displayed in degrees**, stored in radians per the v1 schema lock — conversion at input boundary. (j) **Editor route uses a route-segment layout** that strips root header/footer (`src/app/world/[id]/edit/layout.tsx`) — true fullscreen editor chrome without touching the shared root layout. (k) **Phone fallback = "switch device" notice** below `md` breakpoint (768px); no touch gizmo support in v1 (research project parked). (l) **Legacy worlds must be converted before editing** — editor refuses with a "convert first" message; cleaner than carrying a `null sceneGraph` special-case through the editor. (m) **In-editor `.glb` upload** via XHR (for progress events); drag-drop onto the asset panel + click-to-upload button; 50 MB cap; non-`.glb` files rejected client-side before any network call. (n) **`addObject` returns the new object id** (small store API change) — lets the asset panel auto-select the new object after place (deferred to taste — currently uses default no-auto-select). (o) **R3F Canvas tests intentionally skipped** — WebGL mock too heavy for v1; rely on prod smoke for viewport rendering. State-layer + non-canvas component tests carry the load (659 total, +117 in 8.4).
- **2026-05-26** — Phase 2 plan-time decisions (sub-slice 8.3): (a) **8.5 absorbed into 8.3** — pulled the "Convert to scene graph" tool forward to give founder a visible button immediately (otherwise 8.3 would have shipped no visible UI before 8.4). (b) `set_object_asset` op added as a **separate, single-purpose op** (NOT by allowing `assetId` in `update_object`'s patch) — keeps the API surface clean: `update_object` for transform/cosmetic changes, `set_object_asset` for identity-preserving asset swap (folder-watcher CLI's primary use case). (c) Convert tool **reuses the existing R2 `.glb` object** rather than copying — instant, free, no upload required; `glb_url` stays on the row as a safety net (the legacy renderer is never invoked once `scene_graph` is non-null, but the URL remains as a reference). (d) Initial post-convert scene graph is **published immediately** (not draft) — visitors see the converted world without an extra publish step; matches the "renders identically to before" UX promise. (e) Initial converted object has a **stable hardcoded id `obj_base`** — future ops can target it predictably (useful for the folder-watcher's "swap the asset on the base object" flow when a `.glb` is overwritten). (f) Version-history UI deliberately **omits "view past version" action** in v1 — only publish + read. Browsing arbitrary historical versions requires a parameterized renderer mode that's not yet built; "(coming soon)" note in the subhead. (g) Publish action uses **optimistic UI** with revert-on-error — matches the like/follow button pattern; feels instant. (h) Folder-watcher CLI auth = **paste session cookie** (Clerk JWT from browser DevTools) — simplest v1; API tokens are a post-MVP concern. (i) On file change, CLI **always creates a fresh `assetId`** (never overwrites the R2 object) — preserves history integrity (past `world_versions` keep pointing at the old asset). Old `world_assets` rows are NOT auto-deleted (strict-integrity 409 from 8.2 would block; manual cleanup in editor 8.4 or future cron). (j) `unlink` event in CLI = **no auto-delete from world** — a typo'd folder rename should never nuke a world. (k) CLI tests **skipped** for one-day timebox enforcement (~25 originally planned; surface is small; human smoke is more valuable for v1).
- **2026-05-26** — Phase 2 plan-time decisions (sub-slice 8.2 — API): (a) API style = REST with documented operations + WebSocket upgrade path open (operations-based mutations from day one buys cheap Phase 3 realtime later). (b) Mutation shape = discriminated-union ops (`add_object`/`update_object`/`delete_object`/`set_environment`/`set_lights`/`add_spawn`/`update_spawn`/`delete_spawn`); NOT document replacement — required for Phase 3 CRDT realtime without API rewrite. (c) Ops batch cap = **100 per request** (editor batches ~10–20 per save; protects server from runaway autosaves; easy to relax). (d) Optimistic concurrency = `baseVersionId` in body + 409 on stale **with full `currentVersion` body** so frontend rebases without an extra GET (saves a round-trip; body ~1–50 KB depending on graph size; acceptable). (e) Versions retention = **retained forever in v1**, no pruning, no GC; ~2.5 MB DB growth per heavy editing session is tolerable; pruning is a Phase 5 concern. (f) Permission model = owner-only writes in Phase 2; `requireWorldRole(worldId, dbUser, role)` returns `{ world, role }` from day one — Phase 3 extends the helper with a `world_collaborators` lookup, route handlers don't change. (g) `worlds.scene_graph` semantics = latest draft if newer than published, else latest published (renderer reads this; matches what GET routes return). (h) Asset upload signing = **extend** `POST /api/uploads/sign` with `kind: "asset"` (NOT a forked sibling route — DRY, single upload-signing surface; new `buildAssetKey` helper for the R2 prefix). (i) Asset DELETE referential integrity = **STRICT** — refuses 409 if any past `world_versions.scene_graph` references the assetId (prevents broken-asset rendering on version restore; UX: "this asset is in use; remove from past versions first"). (j) Asset DELETE R2 cleanup = best-effort fire-and-forget after DB commit (try/catch around `deleteObject`; orphans tolerated; asset GC stays a Phase 2-deferred operational concern). (k) `POST /assets` idempotency = none — PK collision returns 503 (editor generates fresh `assetId` per upload; retries shouldn't reuse; documented in API ref). (l) GET routes anon access = `/scene-graph`, `/versions`, `/assets` are PUBLIC (matches existing `GET /api/worlds/[id]` — worlds are public by design; their internals are too). (m) `dbPool` schema fix = one-line addition in `src/db/index.ts` (resolves Slice 7 deferred gotcha — used immediately by `POST /scene-graph/ops` for relational `tx.query.*` inside transactions). (n) **Public-API-quality `docs/scene-graph-api.md` deliverable** — quality bar: a competent engineer could write a Blender plugin from this alone (1,130 lines / 5,382 words shipped).

## 8. Parking Lot (with Phase Tags)

Each parking-lot item has the phase it will likely be addressed in. Items without a phase tag are intentionally indefinite.

### Phase 2 (after Slice 7 + launch)

- Scene graph schema + scene graph API
- In-browser world editor
- Mixed-mode worlds (uploaded `.glb` + browser-placed objects in one scene graph)
- Touch-friendly editor controls (tablets first, phones graceful-degradation)
- Better upload flow — version history, "replace asset" without recreating the world
- Folder-watcher CLI (one-day time box, ships last in Phase 2)
- Small AI assist features inside the editor (if Phase 2 core ships smoothly)
- Convert-legacy-`.glb`-to-scene-graph migration tool

### Phase 3 (after Phase 2)

- Async collaboration — multiple editors on one world, last-write-wins, version snapshots
- Shared presence — capsule avatars, position sync, text chat in worlds
- Realtime collaborative editing — CRDT-based scene graph, see other editors in 3D
- Kick-from-session and per-world mute (session-level moderation)
- Realtime backbone integration (Liveblocks recommended)
- Voice chat in worlds (parked within Phase 3 — LiveKit when ready)

### Phase 4 (after Phase 3)

- Trigger zones, doors, teleporters
- Portals between worlds — the network forms here
- Interactive props
- Per-world and per-visitor state
- Scripting layer (declarative behaviors first; visual scripting and JS sandbox much later)

### Phase 5 (after Phase 4)

- Persistent cross-world avatar
- Cross-world asset library with explicit licensing (CC, paid, free)
- Full AI text-to-world generation
- LLM-driven NPCs
- Economy primitives (tipping, optional entry fees — no crypto)
- World governance (per-world mods, roles, rules)
- Editorial layer — curated collections, featured creators

### Phase 6 (long horizon, 3-5 years)

- Federation — worlds hosted on other servers, accessible via FORGE protocol
- XR support — VR headsets, AR mode
- Custom scripting language with developer tooling
- Native desktop app and Blender/Unity plugins (if real user signal exists)
- Worlds as APIs

### Operational / cross-phase items

- Email notifications (Phase 1.5 or Phase 3)
- Mobile native app — indefinite. Responsive web is enough.
- TOS update + re-acceptance flow (when TOS changes materially)
- Admin-grants-admin UI (currently SQL-only)
- DMCA counter-notice flow (operational, build when first counter-notice arrives)
- Suspension appeals (operational)
- Media on world updates (currently text-only)
- Unsuspend button in admin UI — actually part of launch ops, ship before public launch

## 9. Critical Files to Know

| Path | What it is |
|---|---|
| `PROJECT.md` | This doc. Operational source of truth. Update BEFORE coding when something changes. |
| `ROADMAP.md` | Strategic companion. Phase-by-phase arc, vision, architectural philosophy. |
| `.claude/agents/*.md` | 6 subagent definitions: forge-lead (scope cop), frontend-dev, backend-dev, r3f-engineer, deploy-ops, test-engineer. |
| `src/db/schema.ts` | Drizzle schema. 9 tables. Reference for every backend task. |
| `src/lib/users.ts` | Three auth helpers: `getOrCreateDbUser`, `requireAdmin`, `requireActiveDbUser`. |
| `src/lib/r2.ts` | R2 client (lazy-init), presigned URLs, `headObject`. |
| `src/lib/format-relative.ts` | "5m ago" timestamps. |
| `drizzle/000*.sql` | Hand-written migrations 0–5. Next is `0006_slice7_*.sql`. |
| `scripts/migrate.ts`, `scripts/smoke.ts` | DB tooling. `npm run db:migrate`, `npm run db:smoke`. |
| `.env.local` | Real secrets (gitignored). Mirrored in Vercel env. |
| `.github/workflows/ci.yml` | Lint + test + build on PR and push to main. |

## 10. Known Gotchas

Architectural and ecosystem quirks you've already hit. Document them so future-you doesn't relearn.

- **`r2.ts` is lazy-init** — CI doesn't strictly need R2 env vars but placeholders are set defensively.
- **Drizzle migrations are hand-written**, not generated. Same pattern continues.
- ~~**`dbPool`** (WebSocket Drizzle client) doesn't have schema wired — `db.query.*` only works on `db` (HTTP).~~ **Resolved 2026-05-26 (Slice 8.2)** — `src/db/index.ts` now does `drizzlePool({ client: pool, schema })`. Relational `tx.query.*` works inside transactions; used by `POST /api/worlds/[id]/scene-graph/ops`.
- **Clerk v7 quirks**: `<Show when="signed-in">` not `<SignedIn>`. `UserButton` dropped `afterSignOutUrl`. `auth()` and `currentUser()` are async. Use `unstable_retry` (not `reset`) in error boundaries.
- **`.env.local` not `.env`** — explicit `dotenv.config({ path: ".env.local" })` in any tsx script.
- **`r2.ts` env mismatch** — note placeholder strategy in `r2.ts` if env vars are missing in CI.

## 11. Commands to Verify State

```bash
git log --oneline -5            # Recent commits
git status                       # Clean tree expected
npm test                         # 711 tests expected
npm run build                    # Clean build expected
npm run db:smoke                 # All 14 tables present, current row counts
```

Production dashboards:

- Vercel: https://vercel.com/mk-sindhu-projects/forge
- Neon: https://console.neon.tech (your forge project)
- Cloudflare R2: dash.cloudflare.com → R2 (forge-glb + forge-media buckets)
- GitHub Actions: https://github.com/MK-Sindhu/forge/actions

## 12. How to Resume Next Session

1. Memory files auto-load. Agents see persistent state.
2. Read this doc (`PROJECT.md`) first.
3. Read `ROADMAP.md` for strategic context. Read `DEFERRED.md` for the "tell-you-later" registry.
4. Phase 2 (8.1 + 8.2 + 8.3 + 8.4) + Slice 9.1 are shipped 🟢. Next:
   - **Founder action:** prod migrations for 0010 + 0011 (`DATABASE_URL=... npm run db:migrate` against the Neon prod URL). 8.3 + 8.4 + 9.1 add NO new migrations — one step covers everything through Slice 9.1.
   - **Then:** prod smoke the full stack — convert a world (8.3 button) → open in editor (8.4) → place + edit → publish → visit `/world/[id]` as a visitor → see "Enter world" CTA → click → walk around with collision (9.1). Flip 🟢 → ✅ once green.
   - **Then:** Slice 9.2 (collaborators — world_collaborators table + Invite UI + editor-role gate). Adds one migration (0012). ~2-3 days.
   - **Then:** Slice 9.3 (multi-user presence + chat via Liveblocks). Founder will need to create a Liveblocks account + add `LIVEBLOCKS_SECRET_KEY` to Vercel env when 9.3 starts. ~5-7 days.
   - The full Slice 9 plan is at `/Users/mk_sindhu/.claude/plans/plan-slice-7-hazy-crystal.md`.

---

_This doc and `ROADMAP.md` are the persistent brain across sessions. Update them BEFORE you code, not after._
