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
│   ├── world/[id]/           # World viewer page + editor
│   │   └── edit/             # In-browser world editor (owner-gated server component + EditorShell)
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
    ├── version-history/
    │   └── VersionHistorySection.tsx      # client component; Phase 2; owner-only; props: worldId, publishedVersionId, isOwner; fetches GET /api/worlds/[id]/versions on mount; lists versions with status pills (Currently published / Published / Draft); owner Publish button → POST /api/worlds/[id]/versions/[v]/publish (optimistic update + revert on failure); "Load more" cursor pagination; skeleton loading + inline error + empty state
    ├── collaborators/
    │   ├── CollaboratorsSection.tsx       # client component; Slice 9.2; visible to all on /world/[id]; props: worldId, isOwner, currentUserId; fetches GET /api/worlds/[id]/collaborators on mount; renders owner row (green Owner badge) + collaborator rows (cyan Editor badge + addedBy meta + relative time); owner sees Remove button per row; collaborator sees Leave button on their own row; "Invite collaborator" button at bottom (owner-only) opens InviteCollaboratorDialog; skeleton loading + inline error + retry; empty state with helper text for owner; window.confirm before remove/leave; on Leave success → router.push back to world page
    │   └── InviteCollaboratorDialog.tsx   # client component; Slice 9.2; props: worldId, open, onClose, onSuccess; native <dialog> element with showModal/close; backdrop click closes; ESC closes (cancel event listener); form with @ prefix input, autofocus on open; POST /api/worlds/[id]/collaborators with { username }; inline error messages per status code (404: no user, 409+existing: already collab, 409 no existing: owner conflict, 5xx: generic); loading spinner in Invite button; aria-modal + aria-labelledby + aria-describedby on error; focus trap via native <dialog>; no new deps
    ├── profile/
    │   └── EditableWorldsSection.tsx      # server component; Slice 9.2; props: username, userId, isSelf; queries worldCollaborators for worlds where userId is a collaborator; renders nothing when empty; heading adapts ("Worlds you can edit" vs "Worlds @username can edit"); thumbnail grid mirroring the owned-worlds grid; reuses WorldCardMedia + TagChip; limit 50, desc(addedAt) order
    └── editor/
        ├── editor-store.ts               # Phase 2 (8.4 Chunk A+D); pure logic — no UI; Zustand v5 store for the in-browser world editor; exports useEditorStore (React-bound) + createEditorStore() (vanilla factory for tests); holds scene graph + selection + gizmo mode + properties tab + pending ops + undo/redo stacks + save lifecycle state; addObject() now returns the new object id (string) — Chunk D change
        ├── EditorShell.tsx               # Phase 2 (8.4 Chunk B+D+E+F); client component; full-viewport 3-panel editor layout (asset panel left, viewport center, properties right) + phone gate; calls useEditorStore.initialize() on mount; calls useAutosave(worldId) to start the 2s autosave interval; renders PhoneNotice + EditorTopBar + panels + EditorStatusBar; hidden below md breakpoint; passes worldId + initialAssets to AssetPanel (Chunk D); imports PropertiesPanel (Chunk E, replaces PropertiesPanelPlaceholder)
        ├── EditorTopBar.tsx              # Phase 2 (8.4 Chunk B+F); client component; top toolbar — breadcrumb + T/R/S gizmo-mode toggle + Undo/Redo + Save version + Publish; keyboard shortcuts (T/R/S/Escape/Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y); pulls state from useEditorStore; handleSaveAsVersion() prompts for label → saveOps() → completeSave/failSave; handlePublish() confirms → flushes pending ops first → publishVersion(); both handlers live on the component, not extracted
        ├── EditorStatusBar.tsx           # Phase 2 (8.4 Chunk B+F); client component; bottom status bar — autosave status text + pending ops count + last-8-chars version id; reads autosaveStatus + pendingOps + lastSaveError + baseVersionId from useEditorStore; no local state (pure store subscription)
        ├── save-client.ts                # Phase 2 (8.4 Chunk F); pure async fetch wrappers for save/publish API calls; exports saveOps() + publishVersion(); both return typed discriminated-union results; no React, no store references — designed for standalone testing; saveOps handles 200/409/400+opIndex/400/5xx branches; publishVersion handles 200 and all non-200 branches
        ├── use-autosave.ts               # Phase 2 (8.4 Chunk F); "use client" hook; setInterval at 2s; guards re-entry with inFlightRef; calls beginSave() → saveOps() → completeSave/rebaseOnServerVersion/failSave; conflict retry capped at MAX_CONFLICT_RETRIES=3; counter resets on success; called once in EditorShell
        ├── PhoneNotice.tsx               # Phase 2 (8.4 Chunk B); client component; props: worldId, worldTitle; shown via flex md:hidden; "Switch to a bigger screen to edit" message + back link
        └── panels/
            ├── AssetPanel.tsx            # Phase 2 (8.4 Chunk D); client component; real asset panel; props: worldId, initialAssets; header with count badge; Upload .glb button + drag-drop; scrollable asset card list; empty state; upload progress bar; inline error; click card → store.addObject(assetId) returns new id → store.selectObject(newId)
            ├── AssetPanelPlaceholder.tsx # Phase 2 (8.4 Chunk B); kept on disk, no longer imported; superseded by AssetPanel
            ├── ViewportPlaceholder.tsx   # Phase 2 (8.4 Chunk B); placeholder for Chunk C; reads sceneGraph objects/lights/spawnPoints counts from useEditorStore; flex-1 center panel
            ├── PropertiesPanelPlaceholder.tsx  # Phase 2 (8.4 Chunk B); kept on disk, no longer imported; superseded by PropertiesPanel (Chunk E)
            ├── PropertiesPanel.tsx       # Phase 2 (8.4 Chunk E); client component; 4-tab right panel (Object/Lights/Environment/Spawn); tab state read/written via propertiesTab + setPropertiesTab on the editor store; 320px wide; tab bar 40px; scrollable content per tab; ARIA role="tablist/tab/tabpanel" with aria-selected + aria-controls
            └── properties/               # Subcomponents for PropertiesPanel tabs (all client components, all in properties/ subdirectory)
                ├── Vec3Input.tsx         # Shared; props: value [x,y,z], onCommit, precision, min, unit; three 72px number inputs side-by-side with x/y/z axis labels; local string state per axis (strategy A: commit on blur/Enter); syncs from props when not focused via focusedRef; clamps to min if set
                ├── ColorInput.tsx        # Shared; props: value (hex #rrggbb), onCommit, label; native <input type="color">; normalises to lowercase; shows hex string beside picker
                ├── ObjectTab.tsx         # No-selection state: muted prompt. Selection state: Name (text input, commit on blur/Enter), Asset ID (read-only truncated), Position Vec3Input, Rotation Vec3Input (degrees in UI, radians stored — convert ×π/180 and ×180/π), Scale Vec3Input (min 0.01), Delete button (window.confirm for v1 → deleteSelectedObject); key=obj.id prevents stale closure on selection change
                ├── LightsTab.tsx         # Per-light cards (Sun amber badge / Ambient purple badge); Intensity number input (0–10 step 0.1); ColorInput; Sun-only: Direction Vec3Input; Remove button (allows removing all lights); "+ Add" with dropdown (Sun/Ambient); defaults: sun {intensity:1,direction:[5,5,5],color:"#ffffff"}, ambient {intensity:0.5,color:"#ffffff"}; always calls setLights(nextArray)
                ├── EnvironmentTab.tsx    # Skybox <select> with 8 presets (studio/sunset/dawn/night/warehouse/park/city/forest); Fog checkbox toggle; when enabled: ColorInput + Near/Far number inputs; default fog {color:"#888888",near:1,far:100}; fog:null when disabled; always calls setEnvironment({...current, ...})
                └── SpawnPointsTab.tsx    # Per-spawn cards; ID read-only (label, truncated); Position Vec3Input; Rotation Vec3Input (degrees); Delete button disabled+title when isLast (only 1 spawn); "+ Add spawn point" → addSpawn({id:"spawn_"+crypto.randomUUID().slice(0,8), position:[0,1.6,0], rotation:[0,0,0]})
# Note: Header and Footer are inlined in src/app/layout.tsx, not separate component directories.
# Footer nav links: DMCA · Terms · Privacy (all three live in /legal/)
```

## Pages

| Route | File | Server/Client | Purpose | Slice |
|---|---|---|---|---|
| `/` | `src/app/page.tsx` | Server | Feed (3 tabs via `?tab=`: Recent, Trending, Following). Cards show up to 3 tag chips + `+N more` overflow. Trending and Recent are public (no auth gate); Following redirects to sign-in if unauthenticated. **Onboarding:** `<WelcomeCallout />` renders above the tab bar for "fresh" signed-in users (no uploads + no follows). The `isFreshUser` flag is computed via two cheap 1-row DB probes (worlds + follows) immediately after the `currentDbUserId` lookup. Callout disappears automatically once user uploads or follows. `ContextualEmptyState` is now actionable: Following tab has "Browse Trending" + "Search worlds" buttons; Recent tab has "Upload your first world" button (signed-in only). | 1, 3, 4, 5, 7.1, 7.4, launch-ops |
| `/search` | `src/app/search/page.tsx` | Server (public) | Full-text search results. Reads `?q=` and/or `?tag=`. Three branches: empty state (neither), FTS query (`q` only), tag filter (`tag` only), intersection (both). Direct DB query — no API route. Cap 50 results. `search_vector` is Postgres-managed (trigger-populated, not in Drizzle schema). `generateMetadata` produces dynamic title/description for shareable search URLs (e.g. `#mytag · FORGE`, `Search: "robots" · FORGE`). | 7.2, launch-polish |
| `/world/[id]` | `src/app/world/[id]/page.tsx` | Server | World viewer page (3D + metadata + carousel + updates + comments + actions). Tag chips row below title. `generateMetadata` produces per-world OG + Twitter Card tags (title, description, thumbnail image, author). Direct DB query for metadata fetch (lean 3-column query — does not re-call the API route). **Viewer branch (9.1 Chunk 7):** if `world.sceneGraph !== null`, renders `<WorldVisitorClient sceneGraph assets ariaLabel />` (walk-mode visitor experience); otherwise falls back to `<WorldViewerClient glbUrl ariaLabel />` (legacy single-GLB path). All existing worlds have `sceneGraph: null` and continue to render via the legacy path unchanged. **Owner-only Phase 2 tools (8.3 Chunk C):** if owner + legacy world (`sceneGraph === null`) → `<ConvertToSceneGraphButton>`; if owner + scene-graph world → `<VersionHistorySection>`. Non-owners see neither. The `GET /api/worlds/[id]` response now includes `publishedVersionId` (null for legacy worlds). **Slice 9.2:** `<CollaboratorsSection worldId isOwner currentUserId />` rendered below the Phase 2 tools, visible to all (public). | 1, 2, 3, 4, 5, 7.1, 8.1, 8.3, 9.1, 9.2, launch-polish |
| `/world/[id]/edit` | `src/app/world/[id]/edit/page.tsx` | Server (owner OR editor-gated) | In-browser world editor. Auth + role gates (redirect to sign-in if unauthenticated; inline "no edit access" page if not owner or editor collaborator). Uses `getWorldRoleForUser()` from `world-permissions.ts` — returns a discriminated union so no `NextResponse` is needed in a server component. Legacy worlds (sceneGraph=null) get an inline "convert first" page with a link back. Fetches latest `world_versions` row (inline DB query, no API round-trip) + up to 100 `world_assets` rows. Parses `SceneGraphV1` defensively (inline error page if parse fails). Renders `<EditorShell>` with serializable props. `generateMetadata` returns `"Editing: {title}"` title + `robots: noindex`. No OG image. | 8.4 Chunk B, 9.2 C4 |
| `/profile/[username]` | `src/app/profile/[username]/page.tsx` | Server | Profile (avatar, follower/following counts, world grid). Cards show up to 3 tag chips + `+N more` overflow. `generateMetadata` produces per-profile OG + Twitter Card tags (username, world count, avatar image). **Slice 9.2:** `<EditableWorldsSection username userId isSelf />` rendered below the owned-worlds grid; renders nothing when the user has no collab worlds. | 1, 3, 7.1, 9.2, launch-polish |
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

### Notification rendering (5 type shapes)

Each notification type maps to a message string and a destination `href`. Logic lives in `NotificationList.tsx` `renderNotification()` helper:

| Type | Message | `href` |
|---|---|---|
| `like` | `@actor liked your world Title` | `/world/{worldId}` |
| `comment` | `@actor commented on Title: <snippet up to 80 chars>` | `/world/{worldId}#comments` |
| `follow` | `@actor started following you` | `/profile/{actor.username}` |
| `new_world` | `@actor published a new world: Title` | `/world/{worldId}` |
| `collaborator_added` | `@actor added you as a collaborator on Title` | `/world/{worldId}/edit` |

Note: `collaborator_added` links directly to `/world/{worldId}/edit` (not `/world/{worldId}`) — the recipient is a collaborator and can act immediately in the editor.

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

### Sub-slice 8.4 Chunk A — Editor State Layer (shipped 2026-05-26)

Pure logic layer for the in-browser world editor. No React components, no UI. Later chunks layer the editor page on top of this.

**`useEditorStore` / `createEditorStore`** (`src/components/editor/editor-store.ts`)
- Zustand v5 store. `createEditorStore()` returns a vanilla `StoreApi<EditorStore>` (used in tests — one fresh instance per test). `useEditorStore` is the React-bound export for editor UI components.
- Dependency: `zustand ^5.0.13` added to `dependencies` in `package.json`.
- Exported types: `GizmoMode`, `PropertiesTab`, `AutosaveStatus`, `EditorState`, `EditorActions`, `EditorStore`.
- **State held:** `worldId`, `sceneGraph` (local working copy), `baseVersionId`, `serverSceneGraph` (server-truth baseline), `selectedObjectId`, `gizmoMode`, `propertiesTab`, `pendingOps`, `autosaveStatus`, `lastSaveError`, `lastSaveOpCount`, `undoStack`, `redoStack`.
- **`initialize()`**: call once when the editor page mounts, passing `worldId + sceneGraph + baseVersionId` from the server. Resets all mutable state (pendingOps, undo/redo stacks, autosaveStatus → idle).
- **`applyOp(op)`**: core mutation. Snapshots current state → runs `applyOps()` reducer → on `OperationError` logs + returns without mutation. On success: pushes undo entry (capped at 50), clears redoStack, appends to pendingOps, sets autosaveStatus → pending.
- **Convenience wrappers** (all delegate to `applyOp`): `updateObject`, `addObject` (generates `obj_<8hex>` id), `deleteSelectedObject` (clears selection post-delete), `setObjectAsset`, `setEnvironment`, `setLights`, `addSpawn`, `updateSpawn`, `deleteSpawn`.
- **Undo/redo:** snapshot-pair design — each undo entry stores `{ before, after, op, pendingOpsLengthBefore }`. `undo()` restores `before`, truncates `pendingOps` to `pendingOpsLengthBefore`, pushes entry to `redoStack`. `redo()` restores `after`, appends `op` to `pendingOps`, pushes entry back to `undoStack`. Undo stack capped at 50.
- **Save lifecycle:** `beginSave()` — sets status → saving, returns `{ ops, baseVersionId }` (capped at `MAX_OPS_PER_BATCH = 100`). `completeSave({ versionId, sceneGraph })` — advances `baseVersionId`, replaces `serverSceneGraph`, slices `pendingOps` by `lastSaveOpCount`. `failSave(message)` — sets status → error, stores message, leaves `pendingOps` intact for retry. `rebaseOnServerVersion({ versionId, sceneGraph })` — replays all pending ops on the server's fresh graph one-by-one, skipping any that throw `OperationError`; clears undo/redo stacks.
- **Selectors:** `isDirty()` (pendingOps.length > 0), `getSelectedObject()`, `canUndo()`, `canRedo()`.
- Test file: `src/components/editor/editor-store.test.ts` (32 tests — covers initialization, basic setters, applyOp happy path + OperationError path, undo/redo stack semantics, cap enforcement, convenience methods, full save cycle, rebase with compatible + incompatible ops).

### Sub-slice 8.4 Chunk B — Editor Page Skeleton (shipped 2026-05-26)

**`/world/[id]/edit`** — the in-browser editor page. Server component with owner gate. Renders `EditorShell` which holds the 3-panel layout.

**Auth + gate chain:**
1. Not signed in → redirect to `/sign-in?redirect_url=/world/[id]/edit`
2. Suspended account → redirect to `/world/[id]`
3. World not found → `notFound()`
4. Not owner → inline "You can only edit worlds you own" page with back link
5. Legacy world (`sceneGraph === null`) → inline "Convert this world before editing" page with link to `/world/[id]`
6. No version rows (defensive) → inline error page
7. Parse error → inline error page

**Data fetching (inline DB, no API round-trip):**
- Latest `world_versions` row by `versionNumber DESC LIMIT 1` → supplies `sceneGraph` + `baseVersionId` for the store
- Up to 100 `world_assets` rows ordered by `createdAt DESC` → asset panel list

**`EditorShell`** (`src/components/editor/EditorShell.tsx`)
- Client component. Props: `worldId`, `worldTitle`, `sceneGraph`, `baseVersionId`, `assets`.
- Calls `useEditorStore.getState().initialize(...)` in a `useEffect` on mount.
- Renders `<PhoneNotice>` (visible below md) + full 3-panel layout (`hidden md:flex h-screen flex-col`).
- Three-panel row: `AssetPanelPlaceholder` (w-64) → `ViewportPlaceholder` (flex-1) → `PropertiesPanelPlaceholder` (w-80).

**`EditorTopBar`** (`src/components/editor/EditorTopBar.tsx`)
- Client component. Props: `worldId`, `worldTitle`.
- Keyboard shortcuts via `window.addEventListener("keydown", ...)` in `useEffect`. Skipped when target is `input`/`textarea`/contenteditable.
  - `T` → translate, `R` → rotate, `S` → scale (no modifier key required; no `preventDefault`)
  - `Ctrl/Cmd+Z` → undo, `Ctrl/Cmd+Shift+Z` → redo, `Ctrl/Cmd+Y` → redo (Windows)
  - `Escape` → `selectObject(null)`
- Gizmo mode buttons: `aria-pressed` reflects active mode; uses `bg-zinc-700` when active.
- Undo/Redo: `disabled` when `canUndo()`/`canRedo()` returns false.
- Save version + Publish: real buttons wired in Chunk F — see below.
- Dirty pip: amber dot + "Unsaved" text shown when `isDirty()`.

**`EditorStatusBar`** (`src/components/editor/EditorStatusBar.tsx`)
- Client component. h-8 bottom bar.
- Left: autosave status text (`All saved` / `· Unsaved changes` / `Saving…` / `Saved` / `Save failed: <message>`). `aria-live="polite"` on status container.
- Right: `Version {last-8-chars-of-baseVersionId}`. `aria-live` is absent on right side (cosmetic).

**`PhoneNotice`** (`src/components/editor/PhoneNotice.tsx`)
- Client component. Props: `worldId`, `worldTitle`. `flex md:hidden`.
- Centered card: heading + explanation + back link.

**Panel placeholders (Chunks C/E will replace the remaining):**
- `AssetPanelPlaceholder` — kept on disk; no longer imported. Replaced by `AssetPanel` in Chunk D.
- `ViewportPlaceholder` — reads `sceneGraph.objects/lights/spawnPoints` from store. Chunk C replaced with `Viewport`.
- `PropertiesPanelPlaceholder` — shows `selectedObjectId` from store. Chunk E replaces.

**Test file:** `src/components/editor/EditorTopBar.test.ts` (+8 tests — gizmo shortcuts T/R/S, input-field guard, Ctrl+Z undo, Ctrl+Z no-op on empty stack, Ctrl+Shift+Z redo, Escape deselect). Total: 574 → 582.

### Sub-slice 8.4 Chunk D — Real Asset Panel (shipped 2026-05-26)

**`AssetPanel`** (`src/components/editor/panels/AssetPanel.tsx`)
- Client component. Props: `{ worldId: string; initialAssets: Asset[] }`.
- Left panel, `w-64`. Vertical layout: header with count badge → Upload button → progress/error area → scrollable asset card list → empty state.
- **Asset list:** `initialAssets` from server props seeded into `useState<Asset[]>`. New uploads appended locally after success (no server refetch). Count badge reflects live list length.
- **Asset card (`AssetCard`):** 64px-tall row; inline GLB icon; asset name (truncated with `title`); file size formatted as `X.X MB / KB / B`; cursor-pointer; hover highlight; "Added" flash text on click for 600ms feedback. Click or Enter/Space key → `store.addObject(asset.id)` (returns new id) + `store.selectObject(newId)` for immediate gizmo activation.
- **Upload button:** `<label htmlFor="asset-upload-input">` over a `sr-only` `<input type="file" accept=".glb,model/gltf-binary">`. Click or drag. Disabled while upload in-flight.
- **Upload flow (inside `startUpload(file)`):**
  1. Validate: ext must be `.glb`; size ≤ 50 MB. Show inline error on failure (no network call).
  2. `POST /api/uploads/sign` with `{ kind:"asset", worldId, assetId, contentType, sizeBytes }`.
  3. `PUT uploadUrl` via `XMLHttpRequest` — `onprogress` drives a progress bar (0-100%).
  4. `POST /api/worlds/[id]/assets` with `{ assetId, name, sizeBytes }`. On success appends new asset to list; resets file input.
  5. Errors shown inline (red card, dismiss button). No modals or toasts.
- **Drag-drop:** `onDragEnter/Over/Leave/Drop` on the `<aside>` root. Counter-based drag state (handles nested elements). Dashed blue border + tinted background while dragging. Drops first file; passes to same `startUpload()` path. `onDragOver` must call `preventDefault()` (browser requirement for drop to fire).
- **`editor-store.ts` change (Chunk D):** `addObject()` now returns the new object's id (`string`) instead of `void`. This is required for `AssetPanel` to call `selectObject(newId)` immediately. The change is backward-compatible: existing callers that don't use the return value are unaffected. Chunk A tests updated: test 13 (`addObject generates an id`) implicitly tested the return via the scene graph; no assertions on void return existed.
- **`EditorShell.tsx` change:** imports `AssetPanel` instead of `AssetPanelPlaceholder`; passes `worldId` + `initialAssets`.
- **Test file:** `src/components/editor/panels/AssetPanel.test.ts` (34 tests — initial list logic, empty state, place-asset calls `addObject` + returns id, `selectObject` called with returned id, upload validation, mock-fetch upload flow for happy path + presign error + PUT error + finalize error).

### Sub-slice 8.4 Chunk E — Real Properties Panel (shipped 2026-05-26)

**`PropertiesPanel`** (`src/components/editor/panels/PropertiesPanel.tsx`)
- Client component. No props (reads everything from `useEditorStore`).
- 4-tab right column (`w-80`): Object | Lights | Environment | Spawn.
- Tab bar uses ARIA `role="tablist/tab/tabpanel"` with `aria-selected` and `aria-controls`.
- Active tab highlighted with `border-b-2 border-blue-500` + `bg-zinc-800`.
- Tab state (`propertiesTab` / `setPropertiesTab`) lives in the editor store.
- `EditorShell` now imports `PropertiesPanel` (replaces `PropertiesPanelPlaceholder`).

**Shared subcomponents** (`src/components/editor/panels/properties/`)

- **`Vec3Input`** — three 72px number inputs side-by-side with axis labels. Local string state per axis. Commits on blur or Enter via `onCommit([x,y,z])`. Syncs from props when not focused using `focusedRef` + `useEffect`. Optional `min` clamp. Optional `unit` label (e.g. "°").
- **`ColorInput`** — native `<input type="color">`. Normalises to lowercase `#rrggbb`. Emits via `onCommit`. Shows hex string beside picker.

**Tab components** (all client components):

- **`ObjectTab`** — no-selection state (muted prompt) vs. selection state (Name / Asset ID / Position / Rotation / Scale / Delete). Rotation is stored in radians; displayed in degrees — convert via `×π/180` on commit and `×180/π` for display. Scale min 0.01. Delete uses `window.confirm` for v1. `key={obj.id}` on the inner `ObjectForm` forces remount on selection change.
- **`LightsTab`** — per-light cards with Sun (amber) / Ambient (purple) type badges. Intensity input. ColorInput. Sun-only: Direction Vec3Input. Remove any light. "+ Add" with Sun/Ambient dropdown. Default sun: `{intensity:1, direction:[5,5,5], color:"#ffffff"}`; default ambient: `{intensity:0.5, color:"#ffffff"}`.
- **`EnvironmentTab`** — Skybox `<select>` (8 presets: studio/sunset/dawn/night/warehouse/park/city/forest). Fog enable/disable checkbox. When enabled: fog ColorInput + Near/Far number inputs. Default fog: `{color:"#888888", near:1, far:100}`. Fog null when unchecked.
- **`SpawnPointsTab`** — per-spawn cards. ID read-only. Position + Rotation Vec3Inputs (degrees). Delete disabled + tooltip "At least 1 spawn point required." when `isLast`. "+ Add spawn point" generates `spawn_<8hexchars>` id.

**Debounce strategy:** approach A (local state + commit on blur). Vec3Input holds local strings; only calls `onCommit` on blur/Enter — no per-keystroke ops. "Focused vs not focused" sync: `focusedRef` guards the `useEffect` that syncs from store props, so in-progress edits are never clobbered by viewport-driven position updates.

**Test file:** `src/components/editor/panels/PropertiesPanel.test.ts` (32 tests). Topics: tab switching (4), no-selection state (3), selection values (1), position update (2), radians/degrees (3), delete button with `window.confirm` mocks (4), lights rendering (2), intensity change (2), add sun light (2), skybox change (2), fog enable/disable (2), spawn delete disabled (2), add spawn (3). Total: 542 → 644.

### Sub-slice 8.4 Chunk F — Save Lifecycle Wired to API (shipped 2026-05-26)

**`save-client.ts`** (`src/components/editor/save-client.ts`)
- Pure async functions — no React, no store. Designed for easy testing.
- `saveOps({ worldId, ops, baseVersionId, label? })` → `SaveOpsResult` (discriminated union):
  - `ok:true` → `{ versionId, versionNumber, sceneGraph }` on HTTP 200
  - `ok:false, kind:"conflict"` → `{ currentVersion }` on HTTP 409
  - `ok:false, kind:"operation-error"` → `{ message, opIndex }` on HTTP 400 with `opIndex`
  - `ok:false, kind:"other"` → `{ message }` on any other error
- `publishVersion({ worldId, versionId })` → `PublishResult`: `ok:true` or `ok:false, message`.

**`use-autosave.ts`** (`src/components/editor/use-autosave.ts`)
- `"use client"` hook. Called once in `EditorShell` with `worldId`.
- `setInterval` at `AUTOSAVE_INTERVAL_MS = 2000ms`.
- `inFlightRef` (boolean ref) guards re-entry on slow networks — if a save is still in-flight when the next tick fires, the tick is skipped.
- `conflictRetriesRef` (number ref) caps consecutive conflict loops at `MAX_CONFLICT_RETRIES = 3`. After 3 conflicts → `failSave("Couldn't reconcile...")` + counter reset.
- On success: `completeSave()` + reset conflict counter to 0.
- On conflict (below cap): `rebaseOnServerVersion()` — surviving pending ops are re-queued and will flush next tick.
- On operation-error / other: `failSave(message)`.
- Test file: `src/components/editor/use-autosave.test.ts` (6 tests — nothing-pending, 200 success, first-409 rebase, 3-consecutive-409s bail, conflict-then-success resets counter, in-flight guard).

**`EditorShell.tsx`** — imports `useAutosave` and calls `useAutosave(worldId)` immediately after the `initialize` useEffect.

**`EditorTopBar.tsx`** — stubs replaced with real async handlers:
- `handleSaveAsVersion()`: `window.prompt()` for optional label (null = cancelled) → `beginSave()` → `saveOps()` with label → `completeSave()` or `failSave()` or `rebaseOnServerVersion()` + `failSave()` on conflict. Uses `window.prompt` for simplicity (no modal component).
- `handlePublish()`: `window.confirm()` for deliberate publish gate → flush any pending ops first (pre-publish save with label "Pre-publish save") → `publishVersion()` on `baseVersionId`. Fails fast if pre-publish save fails. Uses `window.confirm` (no custom dialog).

**`EditorStatusBar.tsx`** — unchanged from Chunk B surface. Reads `autosaveStatus` from store. The spec called for a 2-second "Saved → blank" fade, but the strict `react-hooks/set-state-in-effect` lint rule in this codebase blocks synchronous `setState` in effect bodies. Since the fade is cosmetic polish, it is deferred; the status bar shows "Saved" until the next autosave cycle begins.

**Test files:**
- `src/components/editor/save-client.test.ts` — 9 tests. Covers: saveOps 200 happy path + URL check; 409 conflict body; 400 + opIndex (operation-error); 400 without opIndex (other); 500; publishVersion 200 + URL check; publishVersion 403.
- `src/components/editor/use-autosave.test.ts` — 6 tests. Exercises the `runSaveCycle` logic extracted from the hook (node env, no React runtime). Covers: nothing pending, 200 success + counter reset, first 409 rebase, 3× 409 bail + counter reset, conflict-then-success counter reset, inFlightRef guard.

**Test count delta:** 644 → 659 (+15 new tests).

### Sub-slice 9.1 Chunk 4 — Touch UI Components (shipped 2026-05-26)

Pure DOM components (no R3F) that are wired into `WalkMode` in Chunk 5.

**`use-touch-device.ts`** (`src/components/world-visitor/use-touch-device.ts`)
- `"use client"` hook. Returns `boolean` — true if the device supports touch.
- Hydration-safe pattern: `useState(false)` ensures first render always returns `false` (matching SSR output). Actual value is detected in `useEffect` via `"ontouchstart" in window || navigator.maxTouchPoints > 0` and written with `setIsTouch`.
- `// eslint-disable-next-line react-hooks/set-state-in-effect` is required because the rule fires on any synchronous `setState` in an effect body, but this is intentional (hydration-safe mount-time detection — a canonical Next.js pattern).
- Used by Chunk 5 (`WalkMode`) to gate which controls to render.
- Test file: `src/components/world-visitor/use-touch-device.test.ts` (4 tests covering: false when no touch API present, true with `ontouchstart`, true with `maxTouchPoints > 0`, and hydration-safe initial-false convention).

**`MobileJoysticks.tsx`** (`src/components/world-visitor/MobileJoysticks.tsx`)
- `"use client"` component. Props: `{ onLeftStick, onRightStick }` — both are `(vec: { x: number; y: number }) => void`.
- Renders two 120px virtual joystick circles anchored to the bottom-left and bottom-right screen corners.
- Outer container: `position: fixed; inset: 0; z-index: 50; pointer-events: none` — leaves the canvas fully interactive between the two sticks.
- Each stick: `pointer-events: auto; touch-action: none` — `touch-action: none` prevents browser pan/zoom when touching the joystick area.
- Each stick has a 50px inner "handle" that follows the touch (via `transform: translate(deltaX, deltaY)` in the handle's inline style, capped to the stick radius).
- **Pointer event strategy:** `pointerdown` stores `pointerId` + touch position as the center; `setPointerCapture()` ensures `pointermove` fires even if the finger drifts outside the element. `pointermove` computes delta from center, clamps to 60px radius, normalizes to `[-1, 1]`, calls the prop. `pointerup` / `pointercancel` releases and calls with `{x:0, y:0}`.
- **Coordinate convention (important for Chunk 5 wiring):** `x` = rightward, `y` = downward (standard DOM Y-axis, NOT inverted). Chunk 5 will invert Y for both sticks: left-stick `y` positive → move backward; right-stick `y` positive → look down. Documented in a code comment in the file.
- **iOS safe-area:** bottom margin uses `calc(1.5rem + env(safe-area-inset-bottom))` via inline style (Tailwind doesn't expose this token by default).
- `setPointerCapture` is wrapped in try/catch — it can throw if the pointer is already gone.
- MobileJoysticks interaction tests deferred to Chunk 6 (combined with WorldVisitor integration tests — pointer-event simulation is heavyweight).

**`ControlsHint.tsx`** (`src/components/world-visitor/ControlsHint.tsx`)
- `"use client"` component. Props: `{ isTouchDevice: boolean }`.
- Renders a centered bottom banner (max 600px, 80% width, `rgba(0,0,0,0.7)` background) explaining walk controls. Disappears once dismissed or after 12 seconds.
- Content: desktop → WASD/mouse/Shift/ESC instructions; touch → left-stick/right-stick/tap-exit instructions.
- `role="status" aria-live="polite"` on the banner — announces to screen readers without interrupting.
- On mount: `localStorage.getItem("forge-walk-hint-dismissed") === "true"` → renders nothing (the `useState` initializer calls `readDismissed()` directly so there is no visible flash for returning users).
- On dismiss ("Got it" button): writes `localStorage.setItem("forge-walk-hint-dismissed", "true")` + clears the auto-dismiss timer + sets dismissed state.
- Auto-dismiss: `setTimeout(12_000)` in `useEffect`; also writes localStorage so refresh won't re-show.
- All `localStorage` calls are wrapped in try/catch (private browsing / `SecurityError`).
- z-index: 60 (above joysticks at 50, below future modal overlays).
- Outer container: `pointer-events: none`; banner itself: `pointer-events: auto` (so the dismiss button is clickable).
- Test file: `src/components/world-visitor/ControlsHint.test.ts` (7 tests covering: readDismissed false when unset, false on unexpected values, true on "true", writeDismissed sets key, subsequent read returns true, auto-dismiss timer fires after 12s, timer cleanup prevents duplicate write on early dismiss).

### Sub-slice 9.1 Chunk 7 — WorldVisitor wiring + Copy reframe (shipped 2026-05-26)

**Renderer swap:** `/world/[id]/page.tsx` now imports `WorldVisitorClient` (from `@/components/world-visitor/WorldVisitorClient`) instead of `SceneGraphRendererClient`. Scene-graph worlds (`world.sceneGraph !== null`) render through the walk-mode visitor experience. Legacy worlds (`sceneGraph === null`) still use `WorldViewerClient` unchanged. Import of `SceneGraphRendererClient` removed from the page.

**Copy: world vs model** — all user-facing strings have been shifted from "3D model" / "View" framing to "world" / "Enter" / "Explore" / "space":

| File | Change |
|---|---|
| `src/app/world/[id]/page.tsx` | OG/Twitter fallback description: `"A 3D world on FORGE by @{user}"` → `"Visit {title} — a world by @{user} on FORGE."` |
| `src/app/upload/UploadForm.tsx` | Step 1 heading: `"Step 1 of 5 — Select your 3D model"` → `"Step 1 of 5 — Pick your world file (.glb)"` |
| `src/app/upload/UploadForm.tsx` | Step 1 input label: `"3D model file"` → `"World file (.glb)"` |
| `src/app/upload/UploadForm.tsx` | TOS checkbox: `"I confirm I own the rights to this 3D model..."` → `"I confirm I own the rights to the contents of this world..."` |
| `src/app/upload/UploadForm.tsx` | TOS error message: `"...rights to share this model"` → `"...rights to share this world"` |
| `src/app/upload/page.tsx` | `metadata.description`: `"Upload your .glb file and publish a new 3D world to FORGE."` → `"Upload a .glb to publish your world — a space others can enter and explore."` |
| `src/app/upload/page.tsx` | Page intro text: `"Share a 3D world you've made..."` → `"Upload a .glb to publish your world — a space others can enter and explore."` |
| `src/app/page.tsx` | Recent-tab empty state body: `"Upload a .glb world you've made."` → `"Upload your first world — a space others can enter and explore."` |
| `src/app/search/page.tsx` | Default OG description: `"Search 3D worlds on FORGE..."` → `"Search worlds on FORGE..."` |

Accessibility-critical `ariaLabel="3D world: {title}"` strings on the viewer containers were deliberately left unchanged — the "3D" qualifier is clarity for screen readers, not marketing copy.

### Slice 9.2 Chunk 6 — Collaborators UI (shipped 2026-05-26)

Three new components wired into `/world/[id]` and `/profile/[username]`.

**`CollaboratorsSection`** (`src/components/collaborators/CollaboratorsSection.tsx`)
- Client component. Props: `{ worldId: string; isOwner: boolean; currentUserId: string | null }`.
- Fetches `GET /api/worlds/[id]/collaborators` on mount → `{ owner, collaborators }` state.
- Renders owner row first (green "Owner" badge, no actions). Then each collaborator row: avatar + `@username` + cyan "Editor" badge + "added by @{addedBy} · {relative}" meta.
- Action buttons (right side per collaborator row): owner → "Remove" button; collaborator on own row → "Leave" button; others → nothing.
- On Remove: `window.confirm` → `DELETE /api/worlds/[id]/collaborators/{id}` → splice from local state.
- On Leave: `window.confirm` → `DELETE` → `router.push(/world/{id})`.
- "Invite collaborator" button at bottom (owner-only) → opens `<InviteCollaboratorDialog>`.
- On invite success: `onSuccess(newRow)` appends to local collaborators state.
- Skeleton loading (2 animated rows), inline error + Retry, empty state + owner helper text, action error display.

**`InviteCollaboratorDialog`** (`src/components/collaborators/InviteCollaboratorDialog.tsx`)
- Client component. Exports `CollaboratorRow` interface (shared with CollaboratorsSection).
- Props: `{ worldId, open, onClose, onSuccess }`.
- **Modal pattern:** native `<dialog>` element. `showModal()` / `close()` called imperatively via ref, keyed off `open` prop transitions tracked with `prevOpenRef`. No `setState` in effects (the custom lint rule requires this); form state reset via `resetForm()` called at action sites (`handleClose`, `onSuccess`).
- Backdrop click closes (compares click coords to dialog's bounding rect). ESC closes via `cancel` event listener + `preventDefault` + `onClose()` call. Focus trapped automatically by the browser's `<dialog>` focus management.
- `aria-modal="true"`, `aria-labelledby="invite-dialog-heading"`, `aria-describedby` on error.
- Input: `@` prefix prefix label, autofocus via `requestAnimationFrame` on open, strips leading `@` before sending.
- Error messages: 404 → "No user @{x}. Check the spelling." · 409+existing → "@{x} is already a collaborator." · 409 no existing → "You can't invite yourself — you're the owner." · 5xx → "Couldn't invite right now. Try again."
- Submit button shows spinner + "Inviting…" while in-flight. Both buttons disabled during submit.

**`EditableWorldsSection`** (`src/components/profile/EditableWorldsSection.tsx`)
- **Server component** (no `"use client"`). Props: `{ username: string; userId: string; isSelf: boolean }`.
- Queries `worldCollaborators` joined to `world` (inline DB query, no API round-trip). `limit: 50`, `desc(addedAt)`.
- Returns `null` when there are no collab worlds — keeps profiles clean for non-collaborators.
- Heading adapts: `isSelf` → "Worlds you can edit"; otherwise → "Worlds @{username} can edit".
- Grid mirrors the owned-worlds grid: `WorldCardMedia` + `TagChip` chips + likes/views footer. `<h3>` (not `<h2>`) for world titles since the section has its own `<h2>` with `aria-labelledby`.

**Page wiring:**
- `/world/[id]/page.tsx` — `<CollaboratorsSection>` added below the Phase 2 owner tools (below `VersionHistorySection` / `ConvertToSceneGraphButton`). Visible to all viewers (public), not gated on `isOwner`.
- `/profile/[username]/page.tsx` — `<EditableWorldsSection>` added below the owned-worlds grid. `isOwnProfile` passed as `isSelf`.

### Still to come (Phase 2 / Slice 9)

- Touch-friendly editor controls (tablets day-one, phones graceful-degradation)
- See `ROADMAP.md` Phase 2 for details