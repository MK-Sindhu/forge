# Frontend

> **Owner subagent:** `frontend-dev`
> **Touches:** Next.js pages (`src/app/`), React components (`src/components/`), forms, Tailwind UI
> **Does NOT touch:** Anything inside `<Canvas>` (that's `r3f-engineer`), API routes (that's `backend-dev`)

## Stack

- **Framework:** Next.js 16 App Router
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Auth:** Clerk v7 (client-side via `<Show>`, `<UserButton>`, etc.)
- **Forms:** Plain controlled React (`useState` per field). No form library. Error messages linked via `aria-describedby`. `UploadForm` is the canonical example.
- **Icons:** No icon library. Inline SVG only (e.g., the heart icon in `WorldCardMedia` is a raw `<svg>` path).
- **3D viewer integration:** import `<WorldViewer>` from `src/components/`. Do not edit it — that's `r3f-engineer`'s territory.

## File Structure

```
src/
├── app/                      # Next.js App Router pages
│   ├── layout.tsx            # Root layout with ClerkProvider + Header + Footer + NotificationBell
│   ├── page.tsx              # Feed (Recent / Following tabs)
│   ├── world/[id]/           # World viewer page
│   ├── profile/[username]/   # Profile page
│   ├── upload/               # Multi-step upload form
│   ├── notifications/        # Notification feed (auth-gated server component)
│   │   ├── page.tsx                  # Server page — first-page DB query + renders NotificationList
│   │   ├── MarkAllReadOnView.tsx     # Client — fires mark-read POST after 1.5s delay
│   │   └── NotificationList.tsx     # Client — holds notification array in state, cursor load-more
│   ├── admin/reports/        # Admin moderation queue
│   ├── legal/dmca/           # DMCA policy page (placeholder email — replace before public launch)
│   ├── legal/terms/          # Draft Terms of Service (amber DRAFT banner; attorney review pending)
│   ├── legal/privacy/        # Draft Privacy Policy (amber DRAFT banner; attorney review pending)
│   ├── sign-in/[[...sign-in]]/   # Clerk catch-all — renders <SignIn />
│   └── sign-up/[[...sign-up]]/   # Clerk catch-all — renders <SignUp />
└── components/               # Shared React components (each in its own kebab-case directory)
    ├── world-viewer/
    │   ├── WorldViewer.tsx               # owned by r3f-engineer
    │   ├── WorldViewerErrorBoundary.tsx  # class-based, renders fallback on Canvas crash
    │   └── WorldViewerFallback.tsx       # static fallback shown on error
    ├── media-carousel/
    │   └── MediaCarousel.tsx      # video + image gallery on world page
    ├── world-card-media/
    │   └── WorldCardMedia.tsx     # shared feed/profile thumbnail (aspectRatio="video"|"square")
    ├── like-button/
    │   └── LikeButton.tsx         # optimistic, signed-out disabled
    ├── follow-button/
    │   └── FollowButton.tsx       # optimistic, "Following" → "Unfollow" on hover
    ├── share-button/
    │   └── ShareButton.tsx        # Web Share API → clipboard fallback
    ├── repost-button/
    │   └── RepostButton.tsx       # emerald active state
    ├── report-button/
    │   └── ReportButton.tsx       # native <dialog>, reason dropdown, optional notes
    ├── comments-section/
    │   └── CommentsSection.tsx    # list + composer + delete + load more
    ├── updates-timeline/
    │   └── UpdatesTimeline.tsx    # owner-only composer + inline edit + delete
    ├── tag-chip/
    │   └── TagChip.tsx            # server component; rounded-pill link to /search?tag=; props: name, size ("default"|"small")
    ├── view-tracker/
    │   └── ViewTracker.tsx        # client component; fires POST /api/worlds/[id]/views once on mount for signed-in users; returns null (no UI)
    ├── notification-bell/
    │   └── NotificationBell.tsx   # server component; bell icon + unread badge; link to /notifications; props: initialUnreadCount
    ├── unsuspend-button/
    │   └── UnsuspendButton.tsx    # client component; confirms via window.confirm, DELETE /api/admin/users/[id]/suspend, router.refresh() on success; props: userId, username
    ├── welcome-callout/
    │   └── WelcomeCallout.tsx     # server component; onboarding callout for fresh signed-in users (no uploads + no follows); headline + 3 action cards (Upload / Trending / Search); no props — always renders the same content; mounts in page.tsx only when isFreshUser === true
    ├── convert-to-scene-graph/
    │   └── ConvertToSceneGraphButton.tsx  # client component; Phase 2; owner-only; props: worldId; POST /api/worlds/[id]/convert-to-scene-graph → router.refresh() on 200 or 409; shows "Converting…" + spinner while in-flight; inline error on failure; understated card panel below the world viewer
    └── version-history/
        └── VersionHistorySection.tsx      # client component; Phase 2; owner-only; props: worldId, publishedVersionId, isOwner; fetches GET /api/worlds/[id]/versions on mount; lists versions with status pills (Currently published / Published / Draft); owner Publish button → POST /api/worlds/[id]/versions/[v]/publish (optimistic update + revert on failure); "Load more" cursor pagination; skeleton loading + inline error + empty state
# Note: Header and Footer are inlined in src/app/layout.tsx, not separate component directories.
# Footer nav links: DMCA · Terms · Privacy (all three live in /legal/)
```

## Pages

| Route | File | Server/Client | Purpose | Slice |
|---|---|---|---|---|
| `/` | `src/app/page.tsx` | Server | Feed (3 tabs via `?tab=`: Recent, Trending, Following). Cards show up to 3 tag chips + `+N more` overflow. Trending and Recent are public (no auth gate); Following redirects to sign-in if unauthenticated. **Onboarding:** `<WelcomeCallout />` renders above the tab bar for "fresh" signed-in users (no uploads + no follows). The `isFreshUser` flag is computed via two cheap 1-row DB probes (worlds + follows) immediately after the `currentDbUserId` lookup. Callout disappears automatically once user uploads or follows. `ContextualEmptyState` is now actionable: Following tab has "Browse Trending" + "Search worlds" buttons; Recent tab has "Upload your first world" button (signed-in only). | 1, 3, 4, 5, 7.1, 7.4, launch-ops |
| `/search` | `src/app/search/page.tsx` | Server (public) | Full-text search results. Reads `?q=` and/or `?tag=`. Three branches: empty state (neither), FTS query (`q` only), tag filter (`tag` only), intersection (both). Direct DB query — no API route. Cap 50 results. `search_vector` is Postgres-managed (trigger-populated, not in Drizzle schema). `generateMetadata` produces dynamic title/description for shareable search URLs (e.g. `#mytag · FORGE`, `Search: "robots" · FORGE`). | 7.2, launch-polish |
| `/world/[id]` | `src/app/world/[id]/page.tsx` | Server | World viewer page (3D + metadata + carousel + updates + comments + actions). Tag chips row below title. `generateMetadata` produces per-world OG + Twitter Card tags (title, description, thumbnail image, author). Direct DB query for metadata fetch (lean 3-column query — does not re-call the API route). **Viewer branch (8.1):** if `world.sceneGraph !== null`, renders `<SceneGraphRendererClient sceneGraph assets ariaLabel />` (multi-asset scene graph path); otherwise falls back to `<WorldViewerClient glbUrl ariaLabel />` (legacy single-GLB path). All existing worlds have `sceneGraph: null` and continue to render via the legacy path unchanged. **Owner-only Phase 2 tools (8.3 Chunk C):** if owner + legacy world (`sceneGraph === null`) → `<ConvertToSceneGraphButton>`; if owner + scene-graph world → `<VersionHistorySection>`. Non-owners see neither. The `GET /api/worlds/[id]` response now includes `publishedVersionId` (null for legacy worlds). | 1, 2, 3, 4, 5, 7.1, 8.1, 8.3, launch-polish |
| `/profile/[username]` | `src/app/profile/[username]/page.tsx` | Server | Profile (avatar, follower/following counts, world grid). Cards show up to 3 tag chips + `+N more` overflow. `generateMetadata` produces per-profile OG + Twitter Card tags (username, world count, avatar image). | 1, 3, 7.1, launch-polish |
| `/upload` | `src/app/upload/page.tsx` + `UploadForm.tsx` | Client (`UploadForm`) | Multi-step upload form. Static `metadata` for browser tab clarity (`Upload a world · FORGE`). | 1, 2, launch-polish |
| `/sign-in/[[...sign-in]]` | `src/app/sign-in/[[...sign-in]]/page.tsx` | Server (Clerk drop-in) | Clerk sign-in | 0 |
| `/sign-up/[[...sign-up]]` | `src/app/sign-up/[[...sign-up]]/page.tsx` | Server (Clerk drop-in) | Clerk sign-up | 0 |
| `/admin/reports` | `src/app/admin/reports/page.tsx` | Server (admin gate) | Moderation queue. Four tabs: Open (`?status=open` or default) / Resolved (`?status=resolved`) / Dismissed (`?status=dismissed`) / Suspended (`?view=suspended`). The Suspended view queries `users WHERE suspended_at IS NOT NULL ORDER BY suspended_at DESC` and renders avatar + username + "Suspended {relative time}" + `UnsuspendButton` per row. Status tabs use `?status=...`; the Suspended tab uses a separate `?view=suspended` param to distinguish the shape difference. | 6, launch-ops |
| `/legal/dmca` | `src/app/legal/dmca/page.tsx` | Static | DMCA placeholder | 6 |
| `/legal/terms` | `src/app/legal/terms/page.tsx` | Static (server component) | Draft Terms of Service — 11 numbered sections covering acceptance, eligibility, account rules, creator ownership + license grant, content standards, reporting, DMCA cross-link, termination, no-crypto policy, disclaimers, and changes. Includes amber DRAFT banner. Links to Privacy Policy in Contact section. Pending attorney review + final copy before public launch. | launch-ops |
| `/legal/privacy` | `src/app/legal/privacy/page.tsx` | Static (server component) | Draft Privacy Policy — 10 numbered sections covering: what is collected (account info via Clerk, device/IP data via Vercel, behavioral data for signed-in users only), how data is used, third-party providers (Clerk, Vercel, Neon, Cloudflare R2; analytics placeholder), public content, cookies (Clerk session only — no tracking cookies), data retention + deletion, user rights (GDPR-style), children's privacy (under-13 prohibition), policy changes. Includes amber DRAFT banner. All contact emails are `privacy@forge.example` placeholder. Analytics section explicitly notes "none today" and promises update when added. Cross-links to Terms. Pending attorney review + final copy before public launch. | launch-ops |
| `/notifications` | `src/app/notifications/page.tsx` | Server (auth-gated) | Notification feed. First page fetched via direct DB query. Cursor pagination via `NotificationList` client component. `MarkAllReadOnView` fires mark-read POST after 1.5s. Redirects to `/sign-in?redirect_url=/notifications` when signed out. | 7.5 |

### Root layout metadata (`src/app/layout.tsx`)

The root layout exports `metadata: Metadata` with site-wide OG defaults:

- `metadataBase: new URL("https://forge-black-eta.vercel.app")` — required for relative image URLs in per-page `generateMetadata` to resolve correctly in OG tags.
- `title.template: "%s · FORGE"` — every per-page title (from `generateMetadata` or per-page `export const metadata`) gets `· FORGE` appended automatically. The `title.default` is used for pages that don't export a title.
- `openGraph` and `twitter` blocks set site-wide defaults. Per-page `generateMetadata` overrides specific fields; anything not overridden falls back to the root values.
- `robots: { index: true, follow: true }` — allows public crawling.

## Clerk v7 Quirks (Critical)

These have all bitten us. Memorize them.

| Don't | Do |
|---|---|
| `<SignedIn>`, `<SignedOut>` | `<Show when="signed-in">`, `<Show when="signed-out">` |
| `<UserButton afterSignOutUrl="/">` | `<UserButton>` (the prop was dropped — handle redirect differently) |
| `const user = auth()` | `const user = await auth()` (it's async in v7) |
| `const user = currentUser()` | `const user = await currentUser()` |
| `errorBoundary.reset()` | `errorBoundary.unstable_retry()` (the API was renamed) |

## Patterns

### Optimistic updates

Pattern used by `LikeButton`, `FollowButton`, etc.:

1. User clicks
2. Update local state immediately (assume success)
3. Fire the API call
4. On error, revert + show a toast

`FollowButton` uses `router.refresh()` after the API call to ensure server-rendered counts elsewhere on the page stay in sync.

### Server components vs client components

- Default to server components. Use `"use client"` only when you need state, effects, or browser APIs.
- API calls in server components: import the helper functions directly, don't `fetch` your own API.
- Auth in server components: `await auth()` from `@clerk/nextjs/server`.

### Forms

Multi-step upload flow at `/upload` is the canonical example:

1. GLB upload (with size check + presigned URL)
2. Thumbnail upload
3. Metadata (title, description, tags, TOS)
4. Publish (calls `POST /api/worlds`)

**Tag input (in metadata step):** Two state vars — `tags: string[]` (committed) and `tagsInput: string` (current text). Tokenizes on `,` or Enter: normalizes (`trim().toLowerCase().slice(0,32)`), validates against `/^[a-z0-9][a-z0-9_-]*$/`, rejects if >5 tags or already present, shows inline error via `aria-describedby`. Chip preview row with `×` remove buttons. Backspace in empty input removes last chip. `tags` is sent in the `POST /api/worlds` body (omitted when empty).

Plain controlled React — no form library. Each field has its own `useState` error string. On submit, fields validate synchronously and errors are set before any async work starts. The upload state machine runs via `runUpload(startFrom)`, which resumes from the failed sub-step on retry (signed URLs cached in `useRef` to avoid re-signing).

### StrictMode-safe fire-once effect

When a `useEffect` must run exactly once (e.g., `ViewTracker` POSTing a view count), use a `useRef<boolean>` flag set **before** the async call — not in `.then()` or `.finally()`:

```tsx
const firedRef = useRef(false);
useEffect(() => {
  if (firedRef.current) return;
  firedRef.current = true;  // synchronous — before the fetch
  fetch(...).catch(() => {});
}, [dep]);
```

React 19 StrictMode intentionally unmounts + remounts components in dev. Because both the guard-check and the guard-set happen in the same synchronous tick before `fetch()` is awaited, the second mount sees `firedRef.current === true` and returns early. Setting the flag in `.then()` would leave a window where the second mount fires another fetch before the first resolves.

### Notification rendering (4 type shapes)

Each notification type maps to a message string and a destination `href`. Logic lives in `NotificationList.tsx` `renderNotification()` helper:

| Type | Message | `href` |
|---|---|---|
| `like` | `@actor liked your world Title` | `/world/{worldId}` |
| `comment` | `@actor commented on Title: <snippet up to 80 chars>` | `/world/{worldId}#comments` |
| `follow` | `@actor started following you` | `/profile/{actor.username}` |
| `new_world` | `@actor published a new world: Title` | `/world/{worldId}` |

Fallback for any unexpected type: `"New notification"` → `/`. Missing actor/world falls back gracefully (actor shown as `"Someone"`, world title as `"a world"`).

### Auto mark-read on view

`MarkAllReadOnView` mounts on the `/notifications` page and fires `POST /api/notifications/mark-read` with `{ all: true }` after a 1.5-second delay. The delay lets the user see the unread visual state before it clears. Implementation uses `useRef<boolean>` + `useEffect` + `setTimeout`. The ref is set to `true` synchronously **before** the `setTimeout` call (not in the callback) — this is the same StrictMode-safety pattern as `ViewTracker`. The timer is cleaned up in the effect return to prevent the POST firing if the user navigates away in under 1.5s.

**Locked v1 decision:** no polling for the bell badge. The unread count is fetched server-side once per page load (layout re-render on navigation). Real-time updates are a future concern.

### Trending algorithm

Feed page `?tab=trending` branch in `src/app/page.tsx`:

- **Formula:** `likes_count × pow(0.5, age_hours / 24)` — half-life of 24 hours.
- **Window:** only worlds created within the last 30 days are candidates (`where gt(worlds.createdAt, thirtyDaysAgo)`), bounding scan cost as the corpus grows.
- **Public:** no auth gate (unlike Following, no redirect). Trending tab always renders in the tab bar, regardless of sign-in state.
- **Tie-breaker:** `createdAt DESC` secondary sort so newer worlds win when decay scores tie.
- **Empty state:** "No trending worlds yet — like some to seed the algorithm."
- **Locked decision:** algorithm, half-life, and 30-day cap are locked in `PROJECT.md` decision log.

### Stateless onboarding via DB-derived flag

The `WelcomeCallout` uses no cookie, no localStorage, no dismissal state. Instead, the server component (`src/app/page.tsx`) derives `isFreshUser` by running two cheap DB probes after the `currentDbUserId` lookup:

1. `SELECT id FROM worlds WHERE user_id = $1 LIMIT 1` — has the user uploaded?
2. `SELECT followee_id FROM follows WHERE follower_id = $1 LIMIT 1` — does the user follow anyone?

`isFreshUser = !uploadedRow && !followsRow`. The callout mounts only when both are false and disappears permanently the moment either condition changes — no explicit dismiss action needed. This pattern is appropriate for low-cost one-time checks where the natural user action (uploading or following) already solves the condition the callout targets.

### Social card metadata (OG / Twitter Cards)

Pattern used by `/world/[id]`, `/profile/[username]`, `/search`.

**How it works:**

1. `src/app/layout.tsx` exports `metadata: Metadata` with site-wide defaults including `metadataBase`, `title.template`, `openGraph`, `twitter`, and `robots`.
2. Each public page that benefits from social preview exports `async function generateMetadata({ params, searchParams }): Promise<Metadata>`. Next.js merges the returned object with the root defaults — per-page fields win.
3. The `title.template: "%s · FORGE"` in the root layout means any page returning `{ title: "My World" }` gets rendered as `"My World · FORGE"` in `<title>` and OG tags automatically.
4. `metadataBase` is mandatory — without it, relative URLs in `openGraph.images` would not resolve correctly when scrapers fetch them.

**Fetch strategy for per-world metadata:**

`generateMetadata` on `/world/[id]/page.tsx` uses a lean direct DB query (`db.query.worlds.findFirst`) rather than re-calling `GET /api/worlds/[id]`. Reasons:

- The page render already uses `fetch(${baseUrl}/api/worlds/${id})` for historical reasons (no refactor needed for the page body).
- `generateMetadata` and the page render execute in separate phases; Next.js does NOT dedupe a `fetch()` across them unless both calls happen in the same phase with identical arguments.
- The direct DB approach pulls only 3 columns (title, description, thumbnail URL, author username) — cheaper than the full API response.
- Does not require `headers()` to reconstruct the absolute URL.

**Pages with OG metadata:**

| Page | Type | Tags produced |
|---|---|---|
| `layout.tsx` (site-wide) | Static `metadata` | OG website + Twitter summary_large_image defaults |
| `/world/[id]` | `generateMetadata` | OG article + thumbnail image + author; Twitter summary_large_image |
| `/profile/[username]` | `generateMetadata` | OG profile + avatar image; Twitter summary |
| `/search` | `generateMetadata` | Dynamic title/description for `?q=` and `?tag=` params; Twitter summary |
| `/upload` | Static `metadata` | Title only (`Upload a world · FORGE`) |
| `/legal/dmca`, `/legal/terms`, `/legal/privacy` | Static `metadata` | Title only (clean browser tab, template applied) |

**Auth-gated pages** (`/notifications`, `/admin/*`) intentionally have no OG metadata — they are never publicly shareable.

### Error boundaries

Use `unstable_retry` (Clerk v7 renamed `reset`). Wrap risky chunks (3D viewer, async pages).

### Loading states

No `loading.tsx` files exist. Strategies used:

- **3D viewer:** `next/dynamic` with `ssr: false` and a `loading` prop that renders a centered "Loading 3D viewer…" text in a `bg-neutral-100` container. This is in `WorldViewerClient.tsx`.
- **Upload form:** inline progress rows with `<progress>` elements and status strings ("Working...", percentage, "Done", "Failed"). `aria-live="polite"` on the progress container.
- **Error states:** `src/app/error.tsx` provides a root error boundary with a "Try again" button wired to `unstable_retry` and a "Back to feed" link. `WorldViewerErrorBoundary` catches 3D Canvas crashes and renders `WorldViewerFallback`.
- **Empty states:** feed and profile pages render descriptive empty-state UI (dashed border, message, optional CTA link) rather than blank or loading states.

## Styling Conventions

- Tailwind CSS v4 utility-first. No `tailwind.config.*` — config is in `src/app/globals.css` via `@theme inline`.
- **Dark mode:** `prefers-color-scheme: dark` media query in `globals.css`. No class-based toggle. Tailwind's `dark:` variants work automatically.
- **Color palette:** Two CSS custom properties: `--background` (`#ffffff` light / `#0a0a0a` dark) and `--foreground` (`#171717` light / `#ededed` dark), exposed as `bg-background` and `text-foreground` Tailwind tokens. All other color use comes from Tailwind's `neutral-*` scale. No additional custom brand colors defined.
- **Fonts:** Geist Sans + Geist Mono (Google Fonts, loaded in `layout.tsx` via `next/font/google`, exposed as CSS vars `--font-geist-sans` / `--font-geist-mono`).
- **Spacing scale:** default Tailwind.
- **Active states:** like = `text-red-*`, repost = `text-emerald-*`, follow = filled neutral button.

## Component API Conventions

- **Prop-heavy, no children pattern.** Shared components receive explicit typed props. None use `children` for their primary content.
- **Closed-set unions for variants:** `aspectRatio?: "video" | "square"` on `WorldCardMedia`. Follow the same pattern for any new variant prop — a TypeScript union, not a string.
- **Optimistic state props follow a consistent shape:** `initial*` prefix for server-fetched values passed down to client components. Example: `LikeButton` receives `initialLiked`, `initialLikesCount`; `FollowButton` receives `initialFollowing`, `followerCount`.
- **Auth prop:** interactive components that behave differently when signed out receive `signedIn: boolean` as a prop (passed from the server component parent). No client-side auth re-check.
- **`sizes` on image-bearing components:** `WorldCardMedia` requires a `sizes` prop (Next.js `<Image>` responsive hint). The consumer specifies it because only the consumer knows the grid layout.
- Named exports (`export function Foo`) throughout — no default exports in `src/components/`.

## Performance Notes

- Feed cards play preview video on hover with `preload="none"` so a 50-card feed doesn't blow bandwidth.
- 3D viewers (`<WorldViewer>`) are lazy-loaded on the world page. Don't load them in the feed.
- Thumbnails use Next.js `<Image fill>` with no explicit `loading` prop, which defaults to `"lazy"` (Next.js default for non-priority images). Confirmed in `WorldCardMedia.tsx`.

## Slice 7 Frontend Additions

Shipped in 7.1:
- `TagChip` server component (`src/components/tag-chip/TagChip.tsx`) — `<Link>` to `/search?tag=`, rounded-pill, two sizes.
- Tags input in UploadForm metadata step — tokenize on comma/Enter, chip preview with remove buttons.
- Tag chips on world page (all tags, below title), feed cards (≤3 + overflow), profile cards (≤3 + overflow).

Shipped in 7.2:
- Public search `<form action="/search" method="get">` in the root `layout.tsx` header. Placed between the FORGE wordmark and the right-side auth actions. `hidden md:block` keeps it off mobile. NOT inside a `<Show>` block — publicly visible.
- `/search/page.tsx` — server component (no `"use client"`). Three behavior branches: (1) neither `q` nor `tag` → empty state; (2) `q` only → Postgres FTS via `search_vector @@ websearch_to_tsquery('english', ${q})`, ranked by `ts_rank` then `createdAt`; (3) `tag` only → `inArray` on tag subquery; (4) both → `and()` intersection of FTS + tag filter. Cap 50 results. Cards duplicate `FeedCard` markup (extract deferred until a third caller). `search_vector` is Postgres-managed and not in Drizzle schema — raw `sql\`\`` template tags used for FTS clauses.

Shipped in 7.3:
- `ViewTracker` client component (`src/components/view-tracker/ViewTracker.tsx`) — fires `POST /api/worlds/[id]/views` once on mount for signed-in users. Returns `null`. StrictMode-safe: `firedRef.current = true` is set synchronously **before** the `fetch()` call (not in `.then()`) so React 19 StrictMode's intentional double-mount cannot fire two requests.
- Mounted at the top of `<main>` in `src/app/world/[id]/page.tsx`.
- Feed cards now show view count alongside likes count: `{likes} likes · {views} views`.
- Profile cards already showed view count (no change needed).

Shipped in 7.4:
- Trending tab on `/` — third tab in order Recent → Trending → Following. `?tab=trending` branch queries with `likes_count × pow(0.5, age_hours/24)` decay ordering, 30-day window cap, public (no auth gate). Empty state: "No trending worlds yet — like some to seed the algorithm." See "Trending algorithm" in Patterns.

Shipped in 7.5:
- `NotificationBell` server component (`src/components/notification-bell/NotificationBell.tsx`) — bell SVG icon + red badge (capped at "99+" for ≥100 unread). Pure server component (no `"use client"`). Props: `initialUnreadCount: number`. Mounted in `layout.tsx` inside `<Show when="signed-in">` between the Admin link and Upload link. No polling in v1 — badge refreshes on navigation (layout re-renders server-side).
- Layout change: `layout.tsx` now selects `users.id` (needed for the notifications count join) and runs a second DB query for `count(*) WHERE read_at IS NULL`. Both queries happen in the same `if (userId)` block — net cost is one extra cheap partial-index query per signed-in request.
- `/notifications/page.tsx` — server component. Auth-gate via `await auth()`; redirects if not signed in. Fetches first page via direct DB query (20 items + 1 to detect next page). Renders `<MarkAllReadOnView />` (client) and `<NotificationList initial={...} initialCursor={...} />` (client).
- `MarkAllReadOnView` (`src/app/notifications/MarkAllReadOnView.tsx`) — client component, returns `null`. Uses `useRef<boolean>` + `useEffect` + `setTimeout(1500)` to POST `{ all: true }` to `/api/notifications/mark-read` once after 1.5s. StrictMode-safe (ref set before timer, not in callback).
- `NotificationList` (`src/app/notifications/NotificationList.tsx`) — client component. Holds notification array in `useState`. Per-type message rendering (4 types; see Patterns). "Load more" button fetches next page via `GET /api/notifications?cursor=...` and appends to state. Error state via `role="alert"`. Empty state when 0 items.

## Phase 2 Frontend Additions

### Sub-slice 8.3 Chunk C — Scene Graph Conversion + Version History UI (shipped 2026-05-26)

Two new owner-only components on `/world/[id]`, wired after the comments section.

**`ConvertToSceneGraphButton`** (`src/components/convert-to-scene-graph/ConvertToSceneGraphButton.tsx`)
- Client component. Props: `{ worldId: string }`.
- Shown to world owner only when `world.sceneGraph === null` (legacy world).
- POSTs to `/api/worlds/[id]/convert-to-scene-graph`. On 200 or 409 (already done) → `router.refresh()`. On other errors → inline error message, button re-enabled.
- `aria-busy` while in-flight. Understated card panel (border + neutral background) — not a prominent CTA.
- Test file: `src/components/convert-to-scene-graph/ConvertToSceneGraphButton.test.ts` (5 tests covering URL/method, 200 success, 409 idempotency, 500 error, network error).

**`VersionHistorySection`** (`src/components/version-history/VersionHistorySection.tsx`)
- Client component. Props: `{ worldId: string; publishedVersionId: string | null; isOwner: boolean }`.
- Shown to world owner only when `world.sceneGraph !== null` (scene-graph world).
- Fetches `GET /api/worlds/[id]/versions` on mount. Cursor pagination via "Load more" button.
- Each version row: `Version N` + optional label + status pill (Currently published / Published / Draft) + relative timestamp + `@author`.
- Optimistic publish: on Publish click, immediately swaps published pill; POST `/api/worlds/[id]/versions/[v]/publish` → `router.refresh()` on success; reverts + shows inline error on failure.
- Skeleton loading (3 animated rows), inline error + Retry button, empty state text.
- Test file: `src/components/version-history/VersionHistorySection.test.ts` (7 tests covering initial load, published-version identification, owner vs non-owner visibility, load-more, publish success, publish failure revert).

**`GET /api/worlds/[id]` change**: now returns `publishedVersionId: string | null` alongside `sceneGraph`. `VersionHistorySection` uses this for the initial "currently published" pill state. The `route.test.ts` key-snapshot test was updated to include this field.

### Still to come (Phase 2)

- `/world/[id]/edit` route — the in-browser editor (owned by `r3f-engineer` for the 3D parts, but the page chrome + panels are frontend territory)
- Touch-friendly controls (tablets day-one, phones graceful-degradation)
- See `ROADMAP.md` Phase 2 for details