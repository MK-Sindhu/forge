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
| 15 | Admin moderation tools | 6 | ✅ Verified |
| 16 | Suspensions + safety-valve report endpoint | 6 | ✅ Verified |
| 17 | DMCA + Footer | 6 | 🟢 Stub — needs real content before public launch |

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

**Slice 6** · Admin-only queue + actions.

| Layer | Where |
|---|---|
| Frontend | `/admin/reports` — server-component page (silent redirect for non-admins), status tabs (Open / Resolved / Dismissed), Resolve / Dismiss / Suspend-creator inline actions; conditional "Admin" link in header |
| Backend | `GET /api/admin/reports` (paginated, status filter); `PATCH /api/admin/reports/[id]` (resolve/dismiss); `POST/DELETE /api/admin/users/[id]/suspend` |
| DB | `reports`, `users.is_admin`, `users.suspended_at` |
| Helpers | `requireAdmin()` in `src/lib/users.ts` |

## 15. Suspensions

**Slice 6** · Suspended users can't perform write actions (12 endpoints guarded). EXCEPT reports — that's the safety valve.

| Layer | Where |
|---|---|
| Backend | `requireActiveDbUser()` on 12 write endpoints; `requireAdmin()` for the suspend/unsuspend actions; suspend self-action blocked |
| DB | `users.suspended_at` (nullable timestamp — null means active) |

⚠️ No "Unsuspend" button in admin UI yet — currently SQL-only or direct API call. Add the button before public launch.

## 16. DMCA / Footer

**Slice 6** · Footer block on root layout with DMCA + Terms links.

| Layer | Where |
|---|---|
| Frontend | Footer in root layout; `/legal/dmca` (placeholder content); `/legal/terms` is a 404 stub |

**Both need real content before public launch.** Placeholders today.

---

## Slice 7 Features (Coming)

| # | Feature | Slice |
|---|---|---|
| 17 | Tags on worlds | 7 |
| 18 | Search | 7 |
| 19 | View counts | 7 |
| 20 | Trending feed tab | 7 |
| 21 | Notifications | 7 |

## Parking Lot Features (Future Phases)

See `ROADMAP.md` for the full list mapped to phases. Highlights:

- Phase 2: Scene graph + in-browser editor + mixed-mode worlds + folder-watcher CLI
- Phase 3: Async collab → shared presence → realtime co-edit
- Phase 4: Trigger zones, portals, interactive props, scripting
- Phase 5: Cross-world avatar, asset library, full AI generation, NPCs, economy
- Phase 6: Federation, XR, scripting language, native desktop, plugins