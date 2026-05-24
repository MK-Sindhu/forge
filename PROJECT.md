# FORGE — Project Tracker

> The "what are we doing this week" doc. For the long arc, see `ROADMAP.md`.

**Last updated:** 2026-05-24
**Current phase:** Phase 1 — Launch
**Current slice:** None — Slice 7 shipped 2026-05-24; awaiting prod migrations + smoke + launch ops
**Builder:** Solo (student)
**Build tool:** Claude Code

---

## 1. What FORGE Is (Right Now)

A social platform for publishing 3D worlds. Creators upload `.glb` files, viewers browse a feed, the usual social mechanics work (likes, comments, reposts, follows, share). World owners can post text updates that appear on the world page and in followers' feeds. Reports + admin moderation work end-to-end.

**What FORGE will become:** see `ROADMAP.md`. The short version: a network of interconnected, collaborative, interactive user-created virtual worlds. Web-first. Creator-owned. No crypto. No VR rabbit hole.

## 2. Current State Snapshot

| Metric | Value |
|---|---|
| Slices shipped | 0, 1, 2, 3, 4, 5, 6, 7 ✅ |
| Slices remaining in Phase 1 | 0 — only launch ops remain before public launch |
| Tests passing | 417 across 21 test files |
| Commits on main | 21 (5 Slice 7 commits + this closeout) |
| Latest commit | (this commit — Slice 7.5 notifications + cross-cutting closeout) |
| Production URL | https://forge-black-eta.vercel.app |
| GitHub | https://github.com/MK-Sindhu/forge |
| DB | Neon Postgres — 12 tables, 9 migrations applied (Slice 7 added tags, world_tags, world_views, notifications + worlds.search_vector tsvector column) |
| Storage | Cloudflare R2 — 2 buckets (forge-glb, forge-media), public read |
| Branch state | `main` clean, in sync with `origin/main` |
| Slices verified in prod | 1, 3, 6, 7 ✅ — 2, 4, 5 deployed but not yet smoke-tested |
| In-flight | Launch ops (real Terms page, real DMCA email, unsuspend button, onboarding, seed worlds, analytics) |

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
- **`dbPool`** (WebSocket Drizzle client) doesn't have schema wired — `db.query.*` only works on `db` (HTTP). If a route needs transactions AND relational queries, fix this.
- **Clerk v7 quirks**: `<Show when="signed-in">` not `<SignedIn>`. `UserButton` dropped `afterSignOutUrl`. `auth()` and `currentUser()` are async. Use `unstable_retry` (not `reset`) in error boundaries.
- **`.env.local` not `.env`** — explicit `dotenv.config({ path: ".env.local" })` in any tsx script.
- **`r2.ts` env mismatch** — note placeholder strategy in `r2.ts` if env vars are missing in CI.

## 11. Commands to Verify State

```bash
git log --oneline -5            # Recent commits
git status                       # Clean tree expected
npm test                         # 311 tests expected
npm run build                    # Clean build expected
npm run db:smoke                 # All 9 tables present, current row counts
```

Production dashboards:

- Vercel: https://vercel.com/mk-sindhu-projects/forge
- Neon: https://console.neon.tech (your forge project)
- Cloudflare R2: dash.cloudflare.com → R2 (forge-glb + forge-media buckets)
- GitHub Actions: https://github.com/MK-Sindhu/forge/actions

## 12. How to Resume Next Session

1. Memory files auto-load. Agents see persistent state.
2. Read this doc (`PROJECT.md`) first.
3. Read `ROADMAP.md` for strategic context.
4. Slice 7 is shipped. Next: prod migrations (run `DATABASE_URL=... npm run db:migrate` against the Vercel/Neon prod URL), smoke-test all 5 sub-slices in production, then launch ops (Terms page, DMCA email, unsuspend button, onboarding pass, seed worlds, analytics). Public launch is unblocked once those are done.

---

_This doc and `ROADMAP.md` are the persistent brain across sessions. Update them BEFORE you code, not after._
