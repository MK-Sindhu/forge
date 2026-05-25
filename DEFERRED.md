# Deferred — awaiting founder direction

Items the founder has explicitly said to park until they ask. `forge-lead` loads this file at session start (alongside `PROJECT.md` + `TRACKER.md`) and does **NOT** bring these up unless asked.

**Last updated:** 2026-05-26

---

## Phase 1 launch ops (deferred 2026-05-26)

- **DMCA email replacement** — `dmca@forge.example` placeholder lives in `/legal/dmca`, Terms Contact (`src/app/legal/terms/page.tsx`), Privacy §8 + Contact (`src/app/legal/privacy/page.tsx`). Founder will provide a real address (recommendation: `you+dmca@gmail.com` subaddress for filtering) when ready. One commit swaps it in all 3 files.
- **Attorney review of Terms + Privacy** — drafts at `/legal/terms` and `/legal/privacy` ship with amber DRAFT banners. Founder engages attorney when ready. `[Jurisdiction TBD]` placeholder + governing-law clause resolve in the same pass.
- **Public launch posts** — copy ready at `docs/launch-posts.md` (r/threejs · r/WebGL · r/blender · X/Bluesky · Show HN). Founder posts when ready. Pre-posting checklist in the same file.

## AI integration (deferred 2026-05-26)

- **Sub-slice 8.6 (AI editor assist)** — removed from Phase 2 scope. Will revisit when founder asks. Architecture stays AI-ready: any future AI tool is just another client of `/scene-graph/ops` (Phase 2.2).
- **Full AI text-to-world generation** — still parked to Phase 5 per ROADMAP. No change.

## "Web native" option (flagged 2026-05-26, no decision yet)

Founder note at Phase 2 plan time: *"in future there can be an option for web native (don't know when)."* Open-ended — could mean PWA install, WebGPU-accelerated editor, deeper web-platform APIs (Web USB / Bluetooth / filesystem), or an installable offline editor.

**Status:** no decision, no timeline. Architecturally preserved by Phase 2's API-first design (`/scene-graph/ops` accepts any client). When founder is ready to pick a direction, plan it as a new client of the existing API — no Phase 2 work needs to change to accommodate it.

---

## How this list works

- Founder says "defer X" or "tell-you-later" → I add it here + remove from any active todo list.
- Founder says "ok let's do X" → I remove the entry here + plan the execution.
- `forge-lead` reads this file at session start but does NOT proactively raise these items.
- Updates to this file are part of the doc-maintenance protocol in `docs/MAINTENANCE.md`.
