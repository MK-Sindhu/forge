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
│   ├── layout.tsx            # Root layout with ClerkProvider + Header + Footer
│   ├── page.tsx              # Feed (Recent / Following tabs)
│   ├── world/[id]/           # World viewer page
│   ├── profile/[username]/   # Profile page
│   ├── upload/               # Multi-step upload form
│   ├── notifications/        # (Slice 7 — to be added)
│   ├── admin/reports/        # Admin moderation queue
│   ├── legal/dmca/           # DMCA stub (replace before public launch)
│   ├── legal/terms/          # 404 stub (build real page before public launch)
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
    └── tag-chip/
        └── TagChip.tsx            # server component; rounded-pill link to /search?tag=; props: name, size ("default"|"small")
# Note: Header and Footer are inlined in src/app/layout.tsx, not separate component directories.
```

## Pages

| Route | File | Server/Client | Purpose | Slice |
|---|---|---|---|---|
| `/` | `src/app/page.tsx` | Server | Feed (Recent / Following tabs via `?tab=`). Cards show up to 3 tag chips + `+N more` overflow. | 1, 3, 4, 5, 7.1 |
| `/world/[id]` | `src/app/world/[id]/page.tsx` | Server | World viewer page (3D + metadata + carousel + updates + comments + actions). Tag chips row below title. | 1, 2, 3, 4, 5, 7.1 |
| `/profile/[username]` | `src/app/profile/[username]/page.tsx` | Server | Profile (avatar, follower/following counts, world grid). Cards show up to 3 tag chips + `+N more` overflow. | 1, 3, 7.1 |
| `/upload` | `src/app/upload/page.tsx` + `UploadForm.tsx` | Client (`UploadForm`) | Multi-step upload form | 1, 2 |
| `/sign-in/[[...sign-in]]` | `src/app/sign-in/[[...sign-in]]/page.tsx` | Server (Clerk drop-in) | Clerk sign-in | 0 |
| `/sign-up/[[...sign-up]]` | `src/app/sign-up/[[...sign-up]]/page.tsx` | Server (Clerk drop-in) | Clerk sign-up | 0 |
| `/admin/reports` | `src/app/admin/reports/page.tsx` | Server (admin gate) | Moderation queue | 6 |
| `/legal/dmca` | `src/app/legal/dmca/page.tsx` | Static | DMCA placeholder | 6 |
| `/legal/terms` | — (404 stub, file missing) | — | Terms placeholder (build before public launch) | 6 |
| `/notifications` | — (not yet built) | Server | (Slice 7) | 7 |

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

Still to come:
- Search bar in `Header` → `/search?q=` page (7.2)
- "Trending" tab on `/` (third tab alongside Recent / Following) (7.4)
- View count display on world cards + world page (7.3)
- Bell icon in `Header` with unread count badge (7.5)
- `/notifications` page (paginated list, mark-as-read on view) (7.5)

## Phase 2 Frontend Additions (Future, Not Now)

- `/world/[id]/edit` route — the in-browser editor (owned by `r3f-engineer` for the 3D parts, but the page chrome + panels are frontend territory)
- Touch-friendly controls (tablets day-one, phones graceful-degradation)
- See `ROADMAP.md` Phase 2 for details