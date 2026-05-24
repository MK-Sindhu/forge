# FORGE — Progress Tracker

> The "what is done, what is left, what is in-flight" doc. Updated after every slice ships and after every prod smoke test.

**Last updated:** 2026-05-24

---

## 1. At-a-Glance State

| | |
|---|---|
| Current phase | Phase 1 — Launch |
| Current slice | Slice 7 — Discovery polish (planned, not started) |
| In-flight | — (Slice 7 planning next) |
| Tests | 311 across 16 test files |
| Commits on main | 16 |
| Latest commit | `de71b5a` — docs: restructure into role-specific reference docs + maintenance protocol |
| Branch state | `main` clean, in sync with `origin/main` |
| Production | https://forge-black-eta.vercel.app |
| DB | Neon Postgres — 9 tables, 5 migrations applied |
| Storage | Cloudflare R2 — 2 buckets (forge-glb, forge-media) |

## 2. Phase Rollup

| Phase | Status | Notes |
|---|---|---|
| Phase 0 — Foundation | ✅ COMPLETE | Slices 0–6 shipped |
| Phase 1 — Launch | 🟡 IN PROGRESS | Slice 7 pending + launch ops |
| Phase 2 — Architectural Pivot | ⬜ NOT STARTED | Scene graph API + multi-surface editing |
| Phase 3 — Collaboration | ⬜ NOT STARTED | Async → Presence → Realtime edit |
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

#### Slice 7 — Discovery polish ⬜

| | |
|---|---|
| Status | Planned, not started |
| Goal | Search, tags, view counts, trending, notifications — the discovery layer FORGE needs to launch publicly |
| Estimated tasks | 12–16 (similar shape to Slice 6) |

**Sub-slices in order:**

| # | Sub-slice | Status |
|---|---|---|
| 7.1 | Tags — free-form, max 5 per world, lowercase, max 32 chars each | 🟢 |
| 7.2 | Search — Postgres FTS (`tsvector` on title + description + tags) | 🟢 |
| 7.3 | View counts — debounced, 1/user/world/day | 🟢 |
| 7.4 | Trending — new feed tab, `likes × decay(age_in_hours)` | ⬜ |
| 7.5 | Notifications — bell icon + `/notifications`. Events: like, comment, follow, new-world-from-followee | ⬜ |

**Schema additions for Slice 7:**

- `tags` (id, name unique)
- `world_tags` (world_id + tag_id, composite PK)
- `notifications` (id, user_id, type enum, actor_id, world_id nullable, comment_id nullable, created_at, read_at nullable)
- `worlds.view_count` denormalized counter OR `world_views` table — TBD in planning

**Locked design decisions** (no need to re-ask):

- Tags format: free-form hashtag style, not curated
- Notification scope: like, comment, follow, new-world-from-followee only
- Trending algorithm: simple `likes × decay`
- Email / push: parked

### Launch Ops (parallel with / after Slice 7, before public launch)

| Task | Status |
|---|---|
| Real Terms of Service page (currently 404 stub) | ⬜ |
| Real DMCA email (currently `dmca@forge.example` placeholder) | ⬜ |
| Unsuspend button in admin UI (currently SQL-only) | ⬜ |
| Onboarding pass — empty-feed state for new users | ⬜ |
| 30–50 seed worlds — build / source CC-licensed `.glb` | ⬜ |
| Basic analytics — Plausible or PostHog | ⬜ |
| Launch plan: r/threejs + r/blenderhelp first, X/Bluesky parallel, HN last after 200+ users | ⬜ |
| First public launch (mark date when done) | ⬜ |

## 4. Known Issues / Follow-ups (Open)

Things that work but should be cleaned up before or shortly after launch.

| # | Issue | Severity | Where |
|---|---|---|---|
| 1 | No "Unsuspend" button in admin UI — currently SQL-only | Low | `/admin/reports` (admin tools) |
| 2 | `/legal/dmca` placeholder email (`dmca@forge.example`) | **Blocker for public launch** | `src/app/legal/dmca/page.tsx` |
| 3 | `/legal/terms` is a 404 stub | **Blocker for public launch** | `src/app/legal/terms/page.tsx` |
| 4 | Slices 2, 4, 5 deployed but not yet prod-smoke-tested (Slice 6 verified 2026-05-24) | Medium | Production |
| 5 | `dbPool` (WebSocket Drizzle client) doesn't have schema wired — `db.query.*` only works on `db` (HTTP). If a route needs transactions AND relational queries, fix this. | Low | `src/db/*.ts` |

## 5. Test Coverage by Slice

| Slice | Test files added | Notes |
|---|---|---|
| 0 | (infra only) | — |
| 1 | <!-- TODO: fill in after audit --> | — |
| 2 | <!-- TODO --> | — |
| 3 | <!-- TODO --> | — |
| 4 | <!-- TODO --> | — |
| 5 | <!-- TODO --> | — |
| 6 | <!-- TODO --> | — |
| **Total** | **16 test files / 311 tests** | All passing on main |

> Have test-engineer fill the per-slice rows during the Slice 7 planning session.

## 6. Verification Commands

Run anytime to verify state:

```bash
git log --oneline -5            # Recent commits
git status                       # Clean tree expected
npm test                         # 311 tests expected
npm run build                    # Clean build expected
npm run db:smoke                 # All 9 tables present, current row counts
```

## 7. How to Update This Doc

- **After every slice ships:** mark sub-slices ✅, update test count, update commit hash, add any new known issues
- **After every prod smoke test:** flip 🟢 → ✅ (or surface a blocker)
- **When a new slice starts:** add a new section under the current phase
- **When a phase exits:** update the Phase Rollup table

This is the operational doc. PROJECT.md tracks decisions. ROADMAP.md tracks the long arc. TRACKER.md tracks *progress* — what's done, what's pending, what's broken.
