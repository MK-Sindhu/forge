# FORGE — Project Tracker

> A social platform for 3D world creators. Upload your `.glb` world, share it in a feed, others enter and explore it in the browser.

**Last updated:** 2026-05-24
**Current phase:** Slices 1–5 shipped. Slice 6 (moderation — reports + admin queue + account suspension + DMCA page) starting. First admin granted manually via SQL; admin-grants-admin UI is parking lot.
**Builder:** Solo (student)
**Build tool:** Claude Code

---

## 1. One-Line Pitch

FORGE is YouTube for 3D worlds — creators publish `.glb` files they made in Blender / Unity / Spline, and viewers scroll a feed and step into them in the browser.

## 2. Positioning

- **Not** Roblox (games platform with scripting)
- **Not** VRChat (VR-only social space)
- **Not** Sketchfab (3D model search engine — we're feed-first social)
- **Not** Minecraft (sandbox game)
- **Is** a feed-first social network where the posts are 3D worlds made in real tools, viewed in the browser, with IG-style multi-media previews

## 3. Product Definition

FORGE is **complete enough to launch** when slices 1–6 ship. Slice 7 is polish. Each slice must be production-grade before the next begins.

The product is **not** time-boxed to 8 weeks. The product is shipped when it's right — but we ship one coherent slice at a time, not all at once.

## 4. Stack Decisions (locked)

| Layer       | Choice                                            | Why |
|-------------|---------------------------------------------------|-----|
| Frontend    | Next.js 16 (App Router) + Tailwind + TypeScript   | One repo, one deploy, App Router for streaming |
| 3D viewer   | React Three Fiber 9 + drei (`useGLTF`)            | Industry-standard GLB loading, lazy-loadable, React 19 compatible |
| Backend     | Next.js API routes                                | Monolith — solo-friendly |
| Database    | PostgreSQL on Neon                                | Free tier, scales to zero, branching per preview |
| ORM         | Drizzle                                           | Plain SQL migrations, TS-native schema, no codegen |
| Auth        | Clerk                                             | Drop-in components, 10k MAU free |
| Storage     | Cloudflare R2                                     | Critical path — GLBs + thumbnails + media. No egress fees. |
| Uploads     | Presigned PUT URLs to R2                          | Bypass Vercel's ~4.5 MB serverless body limit; client uploads direct to R2 |
| Deploy      | Vercel                                            | Free hobby tier; preview deploys per branch |
| Tests       | Vitest                                            | Fast; runs in CI |
| CI          | GitHub Actions                                    | Lint + test + build on every PR and main push |

## 5. Core Abstractions

### Worlds = real `.glb` files

A world is a `.glb` (or `.gltf`) file the creator built externally in Blender, Unity, Spline, Maya, etc. We don't generate worlds; we host and present them. The file lives in R2; Postgres stores a row pointing at it.

### Media gallery = `world_media` table

Each world has a media gallery (1+ items): a primary thumbnail, additional images, preview videos. Stored in a separate `world_media` table, ordered, typed. Slice 1 ships with one row per world (the thumbnail). Slice 2 expands the UI to use the full gallery.

### Upload flow = signed PUT

The client never POSTs files through Next.js. Instead:

1. Client → `POST /api/uploads/sign` with `{kind, contentType, sizeBytes}`. Server validates and returns a **presigned PUT URL** for R2.
2. Client → `PUT <presigned-url>` with the file body, directly to R2. The bytes never touch our server.
3. Client → `POST /api/worlds` with the resulting R2 object keys + metadata. Server HEADs the keys to confirm upload happened, then inserts `worlds` + `world_media` rows in a transaction.

This dodges Vercel's serverless body limit AND uses zero server bandwidth.

## 6. Slices (the roadmap)

No weekly deadlines. Each slice ships when production-grade: tests, error handling, accessibility, performance. Then we move to the next.

| # | Slice                                                | Status |
|---|------------------------------------------------------|--------|
| 0 | Auth + DB scaffolding + project tracker + CI         | ✅ Done |
| 1 | Core upload + view (single GLB, single thumbnail)    | ✅ Done |
| 2 | Rich media gallery (multi-image + video carousel)    | ✅ Done |
| 3 | Social baseline (profiles, likes, follow)            | ✅ Done |
| 4 | Engagement (comments, share/promote)                 | ✅ Done |
| 5 | World updates timeline (text-only v1; media follow-up later) | ✅ Done |
| 6 | Moderation (reports, TOS, basic admin)               | ✅ Done |
| 7 | Discovery polish (better feed sorting, notifications)| ⬜ |

### Slice 1 — Core upload + view (what's about to happen)

End state: a signed-in creator can upload a `.glb` + a thumbnail image, the world appears on their profile, and a public URL renders it in a browser-based 3D viewer.

Sub-tasks:
1. DB migration: drop `scene_json`; add `glb_url`, `glb_size_bytes`; make `thumbnail_url` mandatory; add `world_media` table; add `tos_accepted_at` to `users`
2. R2 setup: two buckets (`forge-glb`, `forge-media`), CORS configured, S3 SDK wired
3. Backend: `POST /api/uploads/sign` (presigned PUT URL), `POST /api/worlds` (record + verify), `GET /api/worlds/[id]` (public read)
4. R3F: `<WorldViewer glbUrl="..." />` with Suspense + error boundary + OrbitControls + auto-fit camera
5. UI: `/upload` multi-step form (file → thumbnail → metadata → publish), `/world/[id]` page wrapping the viewer
6. Tests at every layer

## 7. Decision Log

_Format: date — decision — reasoning._

- **2026-05-23** — Name is FORGE. Locked.
- **2026-05-23** — Web-first. No VR/AR in MVP. Solo student, can't afford device fragmentation.
- **2026-05-23** — ~~Scene JSON is the single source of truth for a world.~~ **REVERSED 2026-05-23** — pivoted to user-uploaded `.glb` files.
- **2026-05-23** — Backend: Next.js API routes (monolith).
- **2026-05-23** — Database hosting: Neon.
- **2026-05-23** — Auth: Clerk.
- **2026-05-23** — ORM: Drizzle.
- **2026-05-23** — Added `test-engineer` subagent for independent QA.
- **2026-05-23** — **PIVOT** — Cut AI text-to-world generation from MVP. World creation = user uploads `.glb` files made in Blender/Unity/etc. Reason: simpler tech, real creator content from day one, social platform > tech demo. AI generation moves to post-launch parking lot.
- **2026-05-23** — Multi-media gallery + world updates + follow/promote ARE in the product, in their own slices. Quality > timeline ("no time pressure, make sure product is ok" — founder direction).
- **2026-05-23** — Cloudflare R2 elevated from Week 6 to immediate (Slice 1) — files are now the core asset.
- **2026-05-23** — Removed `ai-scene-architect` subagent. No AI in MVP.
- **2026-05-23** — Removed `ANTHROPIC_API_KEY` from env config.
- **2026-05-23** — Deleted `src/lib/scene/schema.ts` + tests (60 tests → 6 tests). Custom JSON schema no longer relevant; GLB is the format.
- **2026-05-23** — File-upload-only for MVP (no Sketchfab URL imports). Reason: licensing/CORS landmines.
- **2026-05-23** — Schema-ready for multi-media from Slice 1: `world_media` table exists from day one, Slice 1 only inserts a single thumbnail row, Slice 2 expands without migration.

## 8. Open Questions

1. **GLB file size cap** — proposed 100 MB → leaning **50 MB**. Tradeoff: artistic ambition vs page load time vs R2 ingress cost.
2. **Thumbnail size cap** — proposed 2 MB. Probably fine.
3. **Preview video** (Slice 2) — proposed 15 MB / 30 sec.
4. **R2 region** — pick once. Leaning **WNAM (US East)** for global average latency.
5. **Upload UX** — single-page form vs multi-step wizard? Lean: **multi-step wizard** (clearer state, easier validation per step).

## 9. Risks (active watch)

- **Empty platform** → seed 10–20 worlds yourself + invite 3D-creator friends before public launch
- **GLB file weight** → cap size, lazy-load viewer, show loading state, surface load failures clearly
- **Moderation / IP** → TOS checkbox at upload + report mechanism + manual triage; legal review before paid features
- **Mobile WebGL perf** → acceptable for viewing; no mobile upload flow in MVP (responsive web only)
- **R2 cost overrun** → R2 has no egress fees; only ingress + storage. Free tier 10 GB. Monitor monthly. Worst case: cap free uploads at 10 GB per user.

## 10. Parking Lot (post-launch)

Good ideas. Not in slices 1–7.

- **AI text-to-world generation** — repositioned as a post-launch viral hook
- **In-browser world builder** (drag-drop primitives, save as GLB)
- **VR / AR rendering** (the viewer is the easiest place to add this — Phase 2)
- **Mobile native app** (responsive web is enough for MVP)
- **Creator monetization** (tips, paid worlds, asset marketplace)
- **Multiplayer presence** (see other people in a world)
- **Voice chat / DMs**
- **Search + tags** (Slice 7 may add lightweight tags; full search is post-launch)
- **Auto-generated thumbnails from GLB** (manual upload is fine for MVP)
- **World embedding** (iframe on external sites)
- **Live-stream a creator building**
- **NPC behavior / scripting**

---

_This doc updates every session. When something changes, we change it here first, then we code._
