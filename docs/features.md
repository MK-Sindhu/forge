# Features

> The platform tour. Every shipped feature, what it does, where it lives.
>
> Cross-cutting reference — useful when scoping new work ("does this overlap with something existing?"), onboarding a new session, or doing a launch readiness review.

## Quick Index

| # | Feature | Slice | Status |
|---|---|---|---|
| 1 | Authentication | 0 | ✅ Verified |
| 2 | World upload | 1 | ✅ Verified |
| 3 | World view (3D + page) | 1 | ✅ Verified |
| 4 | Profile pages | 1 | ✅ Verified |
| 5 | Feed (Recent) | 1 | ✅ Verified |
| 6 | Rich media gallery (preview video + images) | 2 | 🟢 Deployed, not prod-smoked |
| 7 | Likes | 3 | ✅ Verified |
| 8 | Follows | 3 | ✅ Verified |
| 9 | Feed — Following tab | 3 | ✅ Verified |
| 10 | Comments | 4 | 🟢 Deployed, not prod-smoked |
| 11 | Reposts | 4 | 🟢 Deployed, not prod-smoked |
| 12 | Share button | 4 | 🟢 Deployed, not prod-smoked |
| 13 | World updates timeline | 5 | 🟢 Deployed, not prod-smoked |
| 14 | Reports / flagging | 6 | ✅ Verified |
| 15 | Admin moderation tools (+ Suspended tab + Unsuspend button) | 6 + launch-ops | ✅ Verified |
| 16 | Suspensions + safety-valve report endpoint + Unsuspend UI | 6 + launch-ops | ✅ Verified |
| 17 | DMCA + Footer + Terms (draft) | 6 + launch-ops | 🟡 DMCA page live (placeholder email); Terms page live as reviewable draft (amber DRAFT banner, pending attorney review). Both need final copy before public launch. |
| 18 | Tags on worlds | 7 | ✅ Verified |
| 19 | Search (Postgres FTS) | 7 | ✅ Verified |
| 20 | View counts | 7 | ✅ Verified |
| 21 | Trending feed tab | 7 | ✅ Verified |
| 22 | Notifications | 7 | ✅ Verified |
| 23 | Onboarding callout for fresh users | launch-ops | ✅ Shipped |

---

## 1. Authentication

**Slice 0** · Sign up, sign in, sign out, persistent identity.

| Layer | Where |
|---|---|
| Provider | Clerk v7 |
| Frontend | `<ClerkProvider>` in root layout; `<Show when="signed-in/out">` in header; `<UserButton>` |
| Backend | `getOrCreateDbUser()` in `src/lib/users.ts` — creates a DB user on first authenticated request |
| DB | `users` table |

## 2. World Upload

**Slice 1** · Multi-step form, presigned R2 upload, transactional DB insert with retry-on-failure.

| Layer | Where |
|---|---|
| Frontend | `/upload` page — 5 steps: GLB → thumbnail → metadata → TOS → publish |
| Backend | `POST /api/uploads/sign` (presigned URL), `POST /api/worlds` (creates rows after HEAD-verifying R2 keys) |
| DB | `worlds`, `world_media` |
| Storage | R2 buckets `forge-glb`, `forge-media` |

## 3. World View

**Slice 1** · The world page — 3D viewer + metadata + actions + comments + updates.

| Layer | Where |
|---|---|
| Frontend | `/world/[id]` page; `<WorldViewer>` (lazy-loaded R3F canvas); `<MediaCarousel>`; `<LikeButton>`, `<RepostButton>`, `<ShareButton>`, `<ReportButton>`; `<UpdatesTimeline>`; `<CommentsSection>` |
| Backend | `GET /api/worlds/[id]` — returns world + media + author + `isLikedByCurrentUser` |
| DB | `worlds`, `world_media`, `users`, `likes` (for liked-state check) |

## 4. Profile Pages

**Slice 1, expanded in Slice 3** · User profile with avatar, bio, follower/following counts, world grid.

| Layer | Where |
|---|---|
| Frontend | `/profile/[username]` — server component with world grid (`<WorldCardMedia aspectRatio="square">`); `<FollowButton>` (hidden on own profile) |
| Backend | Direct DB query in the server component (no dedicated `/api/users/[username]` route — `getOrCreateDbUser` + Drizzle reads run in the page itself) |
| DB | `users`, `worlds`, `follows` |

## 5. Feed (Recent + Following)

**Slice 1 (Recent), Slice 3 (Following tab), Slice 4 (reposts merged), Slice 5 (updates merged)**

The most complex single feature in the platform. Three entry types in the Following tab: original posts, reposts, world updates. Discriminated union, JS-side dedupe, most-recent-activity-wins.

| Layer | Where |
|---|---|
| Frontend | `/` page; `?tab=following` for Following; tabs in header; `<WorldCardMedia>` hovers play preview video; reposts show "Reposted by @user" attribution |
| Backend | `GET /api/feed` (or direct DB call in server component); Recent = sorted by `created_at DESC`; Following uses `follows` join + merges reposts + updates |
| DB | `worlds`, `follows`, `reposts`, `world_updates` |

Signed-out users hitting `?tab=following` → redirect to sign-in.

## 6. Rich Media Gallery

**Slice 2** · Optional preview video (≤15 MB, ≤30 sec MP4) + up to 4 extra images per world.

| Layer | Where |
|---|---|
| Frontend | Upload form supports optional video + images; client-side duration check via `HTMLVideoElement.duration`; `<MediaCarousel>` on world page (prev/next, dots, swipe, keyboard arrows, play overlay); `<WorldCardMedia>` plays video on hover (`preload="none"`) in feed + profile |
| Backend | Same `POST /api/uploads/sign` — extended file kinds (`video`, `image`); `POST /api/worlds` accepts optional media array |
| DB | `world_media` rows linked to the world |

## 7. Likes

**Slice 3** · Optimistic UI, transactional, recount-from-source.

| Layer | Where |
|---|---|
| Frontend | `<LikeButton>` (optimistic, signed-out disabled with tooltip, red active state); like-count badge on feed/profile cards |
| Backend | `POST/DELETE /api/worlds/[id]/likes` — transactional, recount on every change |
| DB | `likes` (composite PK on `user_id + world_id`); `worlds.like_count` denormalized |

## 8. Follows

**Slice 3** · Optimistic, idempotent, no self-follow.

| Layer | Where |
|---|---|
| Frontend | `<FollowButton>` (optimistic via `router.refresh()`, "Following" → "Unfollow" on hover) |
| Backend | `POST/DELETE /api/users/[username]/follow` — idempotent, self-follow rejected at API |
| DB | `follows` (composite PK, CASCADE, CHECK constraint rejects self-follow at DB level too) |

## 9. Comments

**Slice 4** · Public read, paginated.

| Layer | Where |
|---|---|
| Frontend | `<CommentsSection>` on world page — list + composer + delete-with-confirm + load more |
| Backend | `POST/GET /api/worlds/[id]/comments` (cursor pagination); `DELETE /api/comments/[id]` (author OR world-owner) |
| DB | `comments` |

## 10. Reposts

**Slice 4** · Idempotent, self-repost allowed.

| Layer | Where |
|---|---|
| Frontend | `<RepostButton>` (emerald active state) |
| Backend | `POST/DELETE /api/worlds/[id]/repost` |
| DB | `reposts` (composite PK on `user_id + world_id`); `worlds.repost_count` denormalized |

Reposts surface in the Following feed (Slice 4 work to merge originals + reposts).

## 11. Share Button

**Slice 4** · Web Share API → clipboard fallback.

| Layer | Where |
|---|---|
| Frontend | `<ShareButton>` — tries `navigator.share()` first, falls back to clipboard copy with "Copied!" 2s feedback |
| Backend | (None — pure client) |

## 12. World Updates Timeline

**Slice 5** · Owner-only text updates on a world. Surfaced as third entry type in Following feed.

| Layer | Where |
|---|---|
| Frontend | `<UpdatesTimeline>` on world page (above `<CommentsSection>`) — list + owner-only composer + inline edit + delete + "(edited)" badge |
| Backend | `POST/GET /api/worlds/[id]/updates`; `PATCH/DELETE /api/updates/[id]` (owner-only, PATCH sets `edited_at`) |
| DB | `world_updates` (text-only v1 — media on updates is parking lot) |

## 13. Reports / Flagging

**Slice 6** · Users flag worlds for moderation. Suspension-EXEMPT (safety valve).

| Layer | Where |
|---|---|
| Frontend | `<ReportButton>` on world page — native `<dialog>`, reason dropdown, optional notes |
| Backend | `POST /api/worlds/[id]/reports` — suspension-exempt: suspended users CAN still flag (this is the only write endpoint that exempts them) |
| DB | `reports` (unique on `(reporter_id, world_id)`, CHECK enums on `reason` + `status`) |

## 14. Admin Moderation Tools

**Slice 6 + launch-ops** · Admin-only queue + actions.

| Layer | Where |
|---|---|
| Frontend | `/admin/reports` — server-component page (silent redirect for non-admins); four tabs: Open / Resolved / Dismissed / Suspended; Resolve / Dismiss / Suspend-creator inline actions on report rows; Suspended tab lists suspended users with `UnsuspendButton` per row; conditional "Admin" link in header |
| Backend | `GET /api/admin/reports` (paginated, status filter); `PATCH /api/admin/reports/[id]` (resolve/dismiss); `POST/DELETE /api/admin/users/[id]/suspend` |
| DB | `reports`, `users.is_admin`, `users.suspended_at` |
| Helpers | `requireAdmin()` in `src/lib/users.ts` |

Tab routing: `?status=open|resolved|dismissed` for report-status views; `?view=suspended` for the suspended-users view (separate param because the shape is different — user rows, not report rows).

## 15. Suspensions

**Slice 6 + launch-ops** · Suspended users can't perform write actions (12 endpoints guarded). EXCEPT reports — that's the safety valve.

| Layer | Where |
|---|---|
| Frontend | `UnsuspendButton` client component (`src/components/unsuspend-button/UnsuspendButton.tsx`) — `window.confirm` dialog, `DELETE /api/admin/users/[id]/suspend`, `router.refresh()` on success, alert + re-enable on error, "Unsuspending…" loading state. Rendered in the Suspended tab of `/admin/reports`. Admin rows skip the button (defensive — admins shouldn't be suspended, but guarded). |
| Backend | `requireActiveDbUser()` on 12 write endpoints; `requireAdmin()` for the suspend/unsuspend actions; suspend self-action blocked |
| DB | `users.suspended_at` (nullable timestamp — null means active) |

## 16. DMCA / Footer / Terms (draft)

**Slice 6 + launch-ops** · Footer block on root layout with DMCA + Terms links.

| Layer | Where |
|---|---|
| Frontend | Footer in root layout; `/legal/dmca` (placeholder email — `dmca@forge.example`); `/legal/terms` (draft — amber DRAFT banner, 11 sections, pending attorney review) |

**DMCA page** needs real contact email before public launch (`dmca@forge.example` is a placeholder).

**Terms page** ships as a reviewable draft. Amber DRAFT banner is prominent. Governing law and contact email (`legal@forge.example`) are marked placeholders. Attorney review required before public launch. The DMCA page now links back to Terms.

---

## 18. Tags on worlds

**Slice 7.1** · Creators tag worlds with 1–5 free-form lowercase labels. Tags surface as clickable chips on world pages and feed/profile cards. Click → `/search?tag=<name>`.

| Layer | Where |
|---|---|
| Frontend | `UploadForm` metadata step gets a tag input (tokenize on comma/Enter, validate `[a-z0-9][a-z0-9_-]*` 1–32 chars, max 5, dedupe); `<TagChip>` server component renders the pill UI; world page + feed cards + profile cards all show chip rows (cards cap at 3 + "+N more" overflow) |
| Backend | `POST /api/worlds` extended (zod `tags: z.array(z.string()).max(5).optional()`, server normalizes + validates regex, transactional insert into `tags` with `ON CONFLICT DO NOTHING` + re-select + bulk `world_tags` insert); `GET /api/worlds/[id]` returns `tags: { name: string }[]` |
| DB | `tags` (uuid PK, `name text UNIQUE NOT NULL` with CHECK on length + lowercase), `world_tags` (composite PK on `(world_id, tag_id)`, both FKs CASCADE) |
| Migration | `0006_slice7_tags.sql` |

## 19. Search (Postgres FTS)

**Slice 7.2** · Public full-text search across world title + description + tag names. Header form (public, no auth) submits `?q=` to `/search`. Tag chips link to `/search?tag=`.

| Layer | Where |
|---|---|
| Frontend | Search `<form action="/search" method="get">` in `layout.tsx` header (hidden md:block); `/search/page.tsx` server component handles 4 branches (none/q/tag/both); reuses the feed card layout |
| Backend | No new API route — direct `db.query.worlds.findMany({ where: sql\`search_vector @@ websearch_to_tsquery('english', ${q})\`, orderBy: sql\`ts_rank(search_vector, websearch_to_tsquery('english', ${q})) DESC, created_at DESC\`, limit: 50, with: { ... } })` |
| DB | `worlds.search_vector` tsvector column (DB-managed, NOT in Drizzle schema); helper function `worlds_search_vector_build(world_id)` assembles weighted vector from title (A) + description (B) + tag names (A); BEFORE INSERT/UPDATE trigger on `worlds`; AFTER INSERT/DELETE trigger on `world_tags` keeps the vector fresh on tag changes; GIN index `worlds_search_vector_gin` |
| Migration | `0007_slice7_search.sql` |

⚠️ v1 cap: 50 results, no pagination. Revisit if launch traffic outgrows it.

## 20. View counts

**Slice 7.3** · Per-user-per-day-deduped view tracking. Counts shown on world page + cards. Anonymous views ignored (locked decision).

| Layer | Where |
|---|---|
| Frontend | `<ViewTracker>` client component fires `POST /api/worlds/[id]/views` once on world-page mount; `useRef` flag set BEFORE fetch prevents React 19 StrictMode double-fire; silent failure (best-effort); feed cards now show view count alongside likes |
| Backend | `POST /api/worlds/[id]/views` — auth + active, uuid param validation, 404 if world missing; transactional insert into `world_views` with `onConflictDoNothing()` + recount of `worlds.views` from the table (mirror of likes recount-from-source pattern); 503 on DB error |
| DB | `world_views` (composite PK on `(viewer_id, world_id, day::date)`, both FKs CASCADE; index on `world_id`); reuses existing `worlds.views integer NOT NULL DEFAULT 0` column |
| Migration | `0008_slice7_views.sql` |

## 21. Trending feed tab

**Slice 7.4** · Third feed tab between Recent and Following. Public (no auth gate). Ranking = `likes_count × pow(0.5, age_in_hours / 24)` — 24h half-life.

| Layer | Where |
|---|---|
| Frontend | `/?tab=trending` branch in `src/app/page.tsx`. Tab bar order: Recent → Trending → Following (Following remains auth-gated). 30-day window cap on candidate worlds to bound scan cost. Recent stays purely chronological. |
| Backend | No new schema, no migration, no API — pure server-component query. Raw SQL in the `orderBy`: `${worlds.likesCount} * pow(0.5, extract(epoch from (now() - ${worlds.createdAt})) / 3600 / 24) DESC, ${worlds.createdAt} DESC`. |
| Empty state | "No trending worlds yet — like some to seed the algorithm." |

## 22. Notifications

**Slice 7.5** · In-app bell + `/notifications` page. Events: like, comment, follow, new-world-from-followee. Email/push parked (v1 in-app only).

| Layer | Where |
|---|---|
| Frontend | `<NotificationBell>` server component in `layout.tsx` header (inside `<Show when="signed-in">`, between Admin and Upload links); badge shows unread count up to "99+"; no polling (badge refreshes on next nav); `/notifications` server page (auth-gated, redirects to sign-in); `<NotificationList>` client component holds the array in state + cursor "Load more"; `<MarkAllReadOnView>` client wrapper POSTs mark-read after 1.5s delay (gives user time to see unread state) |
| Backend | 3 new routes — `GET /api/notifications` (cursor pagination, mirrors comments shape, joins actor + world + comment), `POST /api/notifications/mark-read` (body `{ ids?: string[], all?: boolean }`, always scoped to `user_id = $dbUser`), `GET /api/notifications/unread-count` (count via partial index). `notify()` + `notifyMany()` helpers in `src/lib/notifications.ts` — best-effort, self-actor suppressed, all DB errors swallowed (locked: notification failure must NEVER break the parent action). Integrated into `POST /api/worlds/[id]/likes`, `POST /api/worlds/[id]/comments`, `POST /api/users/[username]/follow`, and `POST /api/worlds` (fanout to followers via `notifyMany`) — all post-commit, double-wrapped in try/catch. |
| DB | `notifications` (id PK, user_id + actor_id + world_id + comment_id FKs CASCADE, type CHECK enum, created_at, read_at nullable). Two indexes: `(user_id, created_at DESC)` for the feed; partial `(user_id) WHERE read_at IS NULL` for cheap unread-count queries. |
| Migration | `0009_slice7_notifications.sql` |

⚠️ No-polling design means the bell badge updates on the next page navigation, not in real-time. Acceptable for v1; revisit if engagement patterns reveal heavy notification activity.

## 23. Onboarding Callout for Fresh Users

**Launch-ops** · First-visit welcome banner + actionable empty states. No routes added, no new DB tables, no dismissal state.

| Layer | Where |
|---|---|
| Frontend | `<WelcomeCallout>` server component (`src/components/welcome-callout/WelcomeCallout.tsx`) — headline ("Welcome to FORGE 👋"), subhead, 3 action cards: Upload your first world (`/upload`, primary style), Browse what's trending (`/?tab=trending`, secondary), Search for tags or worlds (`/search`, secondary). Mounted in `src/app/page.tsx` above the tab bar when `isFreshUser === true`. `ContextualEmptyState` updated: Following tab now has "Browse Trending" + "Search worlds" buttons; Recent tab has "Upload your first world" button (signed-in only). |
| Backend | No new API routes. Two cheap 1-row DB probes in `src/app/page.tsx` after the `currentDbUserId` lookup: one against `worlds` (has uploaded?), one against `follows` (follows anyone?). |
| DB | No schema changes. Reads from existing `worlds` and `follows` tables. |

**Stateless design:** `isFreshUser = !uploadedRow && !followsRow`. The callout disappears automatically the moment the user uploads their first world OR follows their first creator — no explicit dismiss, no cookie, no localStorage. This is intentional: the natural user action already solves the condition the callout targets.

## Parking Lot Features (Future Phases)

See `ROADMAP.md` for the full list mapped to phases. Highlights:

- Phase 2: Scene graph + in-browser editor + mixed-mode worlds + folder-watcher CLI
- Phase 3: Async collab → shared presence → realtime co-edit
- Phase 4: Trigger zones, portals, interactive props, scripting
- Phase 5: Cross-world avatar, asset library, full AI generation, NPCs, economy
- Phase 6: Federation, XR, scripting language, native desktop, plugins