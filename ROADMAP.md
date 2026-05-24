# FORGE — The Full Roadmap

> The strategic companion to `PROJECT.md`. PROJECT.md tracks the current slice. This document tracks the arc.

**Status:** Phase 0 complete. Phase 1 in progress (Slice 7).
**Last updated:** 2026-05-23

---

## Where We Are (Today)

FORGE is, right now, a **feature-complete social platform for publishing 3D worlds**. You upload a `.glb`, it shows up on a feed, people can like / comment / repost / follow, you can flag bad content, an admin can resolve flags and suspend bad actors. There are 311 tests, the whole thing is deployed, and the foundations a real platform actually needs — identity, social graph, publishing, moderation — are all built and working.

What FORGE is **not** yet:
- A place where worlds are built (worlds are uploaded as finished files)
- A place where people meet each other inside worlds (worlds are single-player)
- A place where worlds can do anything (worlds are static scenes)
- A place where worlds reference each other (every world is an island)

This is the right starting position. Almost every "metaverse" startup tries to build the inside-the-world experience first and dies before they have anyone to share it with. You did the boring half first. That's worth more than it feels like.

## Where We're Heading (The Destination)

Concretely, in 3–5 years if everything works, FORGE is:

**An open network of user-created virtual worlds, accessible from any browser, where the worlds themselves are interactive, persistent, and interconnected — and creators can use any tool, any combination of tools, to build them.**

A creator can build a world in the browser, or in Blender, or in Unity, or by uploading and then continuing in the browser, or by collaborating with someone who uses a different tool than they do. They can invite people to help, publish it, and visitors can walk into it, meet each other there, do things, leave through a portal into another creator's world, and come back tomorrow to find it changed. The creator owns it. The platform is infrastructure, not the world. The tools are choices, not categories.

This is the Ready Player One vision with two important inversions: **users own the worlds**, and **users own the workflow**. The platform doesn't dictate how you create — it just makes whatever you create part of the same network.

Explicit non-goals — things FORGE will **never** be:
- A VR-first platform (web-first forever; XR is a render target, not the product)
- A game (people make games on FORGE; FORGE is not a game)
- A crypto / token platform (no NFTs, no tokens, no wallet-based identity)
- A closed walled garden (federation and openness are long-term goals)
- A tool that privileges one creation method over another (browser, desktop, plugin — all first-class)
- Unity / Unreal competing on the inside-world engineering depth (we win on the outside — social, distribution, discovery, openness)

## The Architectural Hinge

Everything past Phase 1 depends on one decision: **a world stops being a `.glb` file and becomes a scene graph, and the scene graph is exposed through an API that any editing surface can use.**

Today: `worlds.glb_url` points to one immutable binary file. There is exactly one way to create a world — upload a `.glb`.

Tomorrow: a world is a versioned JSON document that *composes* `.glb` assets in 3D space, with lighting, spawn points, eventually triggers, behaviors, scripts. It is mutated through a documented API. Many editing surfaces are clients of that API — the browser editor first, eventually plugins for Blender/Unity, a native desktop app, a mobile editor, AI agents. All of them read and write the same canonical scene graph. None of them are privileged over the others.

The principle: **one destination (the scene graph), many editing surfaces (all equal).** A creator picks the surface that fits the moment — browser on a train, Blender for heavy sculpting, browser again to add an interactive prop. No category change. No "upgrading." Just open the world, edit, save.

Without this shift, you cannot collaboratively edit a world, you cannot meaningfully add interactivity, you cannot have portals between worlds, you cannot have AI generate or modify worlds, you cannot support mixed-tool workflows where different collaborators use different tools on the same world. With it, all of those become engineering problems instead of architecture problems.

This shift is Phase 2. Everything after it depends on getting it right. Everything before it is buying time and learning what to build.

---

## Phase 0 — Foundation ✅ DONE

**Goal:** ship a feature-complete social platform for sharing 3D worlds.

**What was built:** Slices 0–6. Auth, DB, R2 storage, upload flow, 3D viewer, media gallery, social graph (follows + likes), engagement (comments, reposts, share), world updates timeline, moderation (reports, admin tools, suspensions).

**Why it matters strategically:** the social and operational layers are the parts that take longest to build and are most often skipped by competitors. Hyperfy has the engine, no social layer. Spatial is curated rather than open. Mozilla Hubs was social but had no real publishing/discovery story. FORGE has both halves of the loop.

**What it unlocks:** literally everything that follows. You cannot build a network of worlds without users, identity, publishing, and moderation. Those are now permanent.

---

## Phase 1 — Launch

**Goal:** take FORGE from "feature-complete" to "real users using it daily."

This phase is not about engineering depth. It's about going from a working product to a product *in the world*. Slice 7 is the technical half; launch ops is the other half. Both happen here.

### Deliverables

**Slice 7 — Discovery polish** (already drafted in the handover):
- Tags — free-form hashtag style, creators pick 1–5 per upload
- Search — Postgres full-text search (`tsvector` on title + description + tags)
- View counts — debounced, 1 view per user per world per day
- Trending — new feed tab with `likes × time-decay` ranking
- Notifications — in-app bell + `/notifications` page. Events: like, comment, follow, new world from followee. Email and push are explicitly parked.

**Launch ops** (small but mandatory):
- Real Terms of Service page (replace the 404 stub)
- Real DMCA contact (replace `dmca@forge.example`)
- Unsuspend button in admin UI (currently SQL-only)
- Onboarding pass — what does a brand-new signed-in user see on the empty feed?
- Seed worlds — 30–50 high-quality worlds before public launch. You build some, you source CC-licensed `.glb` files from Sketchfab / Poly Pizza / Quaternius, you ask 3D-savvy friends to upload, you offer a "founding creator" badge.
- Basic analytics — Plausible or PostHog. You need to see what people actually do, not guess.
- Launch plan — HN Show HN, r/threejs, r/blenderhelp, r/WebGL, X/Twitter 3D community, Bluesky. Order matters: HN last, after smaller communities have stress-tested.

### Hard decisions to make in this phase

| Decision | Recommendation |
|---|---|
| Tags: free-form vs curated taxonomy | **Free-form.** Lower friction, curate emergent ones into official tags later. |
| Notification scope | **Likes, comments, follows, new-world-from-followee.** Skip secondary notifications (likes on your comments) — too noisy. |
| Trending algorithm | **Simple `likes × decay(age)`.** Don't over-engineer. Tune after launch. |
| Launch order | **Small communities first.** r/threejs and r/blenderhelp are forgiving and 3D-literate. HN after at least 200 real users and zero showstopper bugs. |
| Email notifications | **Parking lot for Phase 1.** Adds infrastructure (Resend/Postmark, templates, unsubscribe). Push from in-app first. |

### Risks

- **Empty platform.** Mitigated by seed worlds. Don't launch with <30 worlds visible.
- **Bad first impression.** Mitigated by an onboarding pass — if the first thing a new user sees is broken, you've lost them.
- **Moderation load.** The report queue is now your job. Build a habit of checking it daily from day one.
- **Performance under real load.** Production has been you and a few test accounts. Have a plan for "what if we get 10,000 visits in a day" — mostly: trust Vercel + Neon's autoscaling, monitor R2 bandwidth, cache aggressively.

### Exit criteria

- Slice 7 is shipped, tested, deployed
- 30+ seed worlds live
- Terms + DMCA pages are real
- Public launch has happened (Show HN or equivalent)
- 100+ real users
- You've received at least one piece of organic feedback that surprised you

**Scope:** Medium. Slice 7 itself is similar in shape to Slice 6 (12–16 tasks). Launch ops is unglamorous but not deep.

---

## Phase 2 — The Pivot

**Goal:** transform a world from "one uploaded `.glb`" to "a scene graph composition behind a documented API," and ship the first editing surface — the in-browser editor — alongside an expanded upload pipeline. By the end of Phase 2, any creator can build any kind of world using any combination of tools, and FORGE doesn't care which surface they used.

This is the architectural hinge. Take it seriously, plan it carefully, don't ship until it's genuinely good.

### The core principle for this phase

**One world. One scene graph. Many ways to edit it. All equal.**

The scene graph is the canonical state of a world. The API is the only way to mutate it. The browser editor is a client of that API. Future desktop apps, Blender/Unity plugins, mobile editors, and AI agents will be additional clients of the same API. Building any of those later is a feature, not a redesign.

This means: no tier system, no "casual" vs "pro" creator categories, no privileged tool. A creator can build the environment in Blender, export it as a `.glb`, drop it in FORGE, then use the browser editor to add an interactive prop and tweak the lighting — and it's all one world, one scene graph, no mode switch.

### Deliverables

**Scene graph foundation (Slice 8a):**
- New JSONB column `worlds.scene_graph` (keep `glb_url` for legacy single-file worlds during transition)
- Versioned schema: `{ schemaVersion: 1, ... }` so future migrations don't break old worlds
- Minimal v1 schema: objects (asset reference, transform, optional name), lights, environment (skybox, fog), spawn points, camera defaults
- Renderer reads `scene_graph` if present, falls back to `glb_url` rendering for legacy worlds
- Asset model: new `world_assets` table — `.glb` files uploaded to be *used in* a world, distinct from a published world binary

**Scene graph API (Slice 8b):**
- Documented REST/RPC API for reading and mutating a world's scene graph
- Versioned writes — every save creates a new version, full history retained
- Diff and patch operations — clients send operations, not whole-document overwrites (this is what makes future realtime collaboration possible)
- Permission gates at the API layer — owner, editor, viewer roles ready for Phase 3
- Audit log — who changed what when
- Designed from day one to support any future client (desktop app, plugin, mobile, AI agent)

**Improved upload pipeline (Slice 8c):**
- Re-upload a `.glb` for an existing world without recreating the world record
- Version history visible on every world ("v3, updated 2 days ago")
- Mixed-mode worlds — a creator can upload one `.glb` as a base layer *and* add browser-placed objects/lights/props on top, all in one scene graph
- Optional small CLI / folder-watcher tool that watches a local directory and pushes `.glb` changes via the scene graph API (decision point: include in Phase 2 or park — small but useful for serious creators on launch)

**In-browser editor — the first client (Slice 8d):**
- New `/world/[id]/edit` route, gated by API-level permissions
- Asset panel — upload `.glb` files into this world's asset pool, drag into the scene
- 3D viewport with transform gizmos — move, rotate, scale (R3F + drei's `<TransformControls>` or custom)
- Properties panel — lighting (sun, ambient, intensity), environment (skybox preset list), fog
- Spawn point placement — visitors enter where you mark
- Save / Publish flow — drafts vs published versions, leveraging the API's version history
- Undo / redo (matters a lot for editor feel)
- **Touch-friendly controls** — works on tablets from day one; phones degrade gracefully (not the primary target but not broken)

**Backward compatibility (Slice 8e):**
- Old single-`.glb` worlds still render correctly via the legacy renderer path
- One-click "convert to scene graph" — wraps the existing `.glb` as a single-asset scene graph, unlocking all the new editing capabilities
- Document the migration path clearly; don't force-migrate everyone

**AI assist — small features inside the editor (Slice 8f, if time permits):**
- The original AI text-to-world pitch enters here, but as a *power-tool inside the editor*, not the headline.
- "Place 12 trees in a forest pattern" → Claude generates scene graph operations
- "Switch lighting to sunset" → modifies scene graph
- Full AI text-to-world generation stays parked for Phase 5, when it can manipulate real composable worlds at scale

### What's explicitly parked but architecturally enabled

These are real product directions that we're choosing not to build *yet*. The API design must make each of them straightforward to add later — that's the architectural commitment.

| Parked feature | Lives in | Why parked now |
|---|---|---|
| Native desktop app (Tauri/Electron) | Post-launch decision | Real cost; only build when real users hit friction worth solving |
| Blender / Unity plugins | Phase 5 timeframe likely | Mature ecosystem play; not a launch strategy |
| Real-time bidirectional sync from local tools | Phase 3+ | Only meaningful once collaboration infra exists |
| Phone-optimized editor (vs degrades-gracefully) | Post-launch | Touch 3D gizmos on phones is a research problem |
| Cross-world asset library | Phase 5 | Licensing complexity; world-scoped is enough now |
| Full AI text-to-world generation | Phase 5 | Better as a headline feature once the platform is alive |

### Hard decisions to make in this phase

| Decision | Recommendation |
|---|---|
| Scene graph format | **Roll your own minimal JSON schema, versioned.** Don't adopt USD (overkill, not web-native). Don't fully commit to glTF extensions (good influence, but stay flexible). |
| API shape | **REST with optional WebSocket upgrade path.** Operations-based mutations (not document replacements) from day one — this is what makes Phase 3 realtime cheap later. |
| Editor framework | **Built on R3F with selective libraries.** `@react-three/drei` for gizmos and helpers, custom for everything specific. Avoid Theatre.js (animation-focused). Avoid building Tres Studio clones. |
| Asset reusability | **World-scoped only in this phase.** Cross-world asset library is Phase 5. Licensing matters and we don't want to solve it now. |
| Editor placement | **Separate `/edit` route**, not a modal. Editor is a serious UI, give it the screen. |
| World versioning | **Drafts + published, with manual "save as new version" and autosave drafts.** Don't build full Git-style branching. |
| Mixed-mode worlds | **Yes, ship in Phase 2.** This is core to the "any tool, any creator" promise. |
| Folder-watcher CLI | **Include if it stays small (a one-day build). Park otherwise.** It's the cheapest way to give serious creators a "live publishing" feel without a real desktop app. |
| AI editor assist | **Build if Phase 2 core ships smoothly. Don't let it block Phase 2.** |
| Mobile editor scope | **Tablets supported, phones graceful-degradation.** Don't optimize for phones yet. |

### Risks

- **Editor UX is hard.** Most 3D editors are bad. Allocate real time for polish, not just functionality. Steal generously from Tinkercad, Spline, Womp — they've solved a lot of this.
- **API design debt is permanent.** If the scene graph API is poorly designed, every future editing surface (desktop, plugins, mobile) inherits the pain. Spend time on the API design upfront. Document it like a public API even though it isn't one yet.
- **Scope creep.** Every "small editor feature" feels essential. It isn't. v1 editor = place, move, rotate, scale, light, spawn. Everything else is later.
- **Performance.** Editor with 50+ objects must stay smooth. Use R3F instancing, frustum culling, LOD if you have to.
- **Migration anxiety.** Existing creators will worry about their worlds. Communicate clearly: nothing breaks, old worlds keep working, conversion is opt-in.
- **The temptation to ship AI generation as the headline.** Don't. The editor and the API are the headline. AI is the magic trick inside.
- **The temptation to start the desktop app now.** Don't. Resist hard. The API makes it cheap to build later. Build it when real users ask for it.

### Exit criteria

- A user can build a complete world entirely in the browser, no Blender needed
- A user can also build a complete world entirely in Blender, upload it, and continue editing in the browser without re-doing anything
- Scene graph is the canonical world format going forward
- Scene graph API is documented well enough that an external developer (or future-you) could write a new client against it
- Legacy `.glb`-only worlds still render correctly
- At least 5 of your seed worlds are rebuilt as scene graph compositions, including at least one that mixes uploaded `.glb` and browser-placed objects (proves mixed-mode works in practice)
- The editor is good enough that *you* prefer it to Blender for simple scenes

**Scope:** Large. This is the longest single phase in the roadmap by a meaningful margin, possibly multi-month. The expanded scope (API + mixed-mode + touch support + better upload flow on top of the editor) is real. The trade is worth it because every later phase compounds on this foundation.

---

## Phase 3 — Collaboration

**Goal:** make worlds something multiple people can build, share, and inhabit together. This is split into three sub-phases because each is a meaningful release on its own.

### Phase 3a — Async Collaboration

**Goal:** multiple people can edit the same world, not at the same time.

**Deliverables:**
- `world_collaborators` table — `world_id`, `user_id`, `role` (owner / editor / viewer)
- Invite flow — invite by username, accept/decline
- Last-write-wins on saves, with "edited by @X at Y" visible in version history
- Manual version snapshots — "save version" creates a named snapshot; restore from any version
- Autosave drafts every N minutes
- Permission gates everywhere (viewer can enter, editor can edit, owner can manage collaborators)
- Notifications: "@X invited you to collaborate," "@X edited [your world]"

**Hard decisions:**
- Conflict resolution: pure last-write-wins (simplest, recommended) vs version branching (Git-like, parking lot)
- Invite by username only (recommended) vs shareable invite links (parking lot — abuse risk)

**Scope:** Medium.

### Phase 3b — Shared Presence

**Goal:** multiple users in the same world at the same time. This is the viral moment — "come see what I built" becomes a fundamentally different experience.

**Deliverables:**
- Realtime backbone integration (see decision below)
- Capsule avatars with username labels (no customization yet)
- Position + rotation sync at ~10–20Hz
- Movement controls — WASD + mouse look (pointer lock), or click-to-move for mobile
- Text chat (in-world overlay, world-scoped)
- Presence indicators on world page ("3 people here")
- Join/leave events visible to others
- World session capacity limit (start with 25 concurrent; raise once stable)

**Hard decisions:**

| Decision | Recommendation |
|---|---|
| Realtime backbone | **Liveblocks for v1.** Managed, fast DX, CRDT built in. Pay for velocity. Migrate to Yjs+custom or Partykit later if costs hurt. |
| Avatar model | **Capsules with name labels only.** Custom avatars are parking lot. |
| Voice chat | **Parking lot.** LiveKit is the right answer but adds real cost and complexity. |
| Capacity limit | **25 to start, monitor cost per session.** Hard limit to prevent runaway costs. |
| Trolling / harassment | **Add kick-from-session and per-session mute for world owners.** Suspensions still work platform-wide. |

**Risks:**
- Realtime infra is the most expensive infra. Costs scale linearly with concurrent users. Cost-monitor from day one.
- Real-time trolling. Have moderation tools ready before launch.

**Scope:** Large.

### Phase 3c — Realtime Collaborative Editing

**Goal:** multiple users editing the same world at the same time. Google Docs for 3D.

**Deliverables:**
- CRDT-based scene graph (Yjs on top of the realtime backbone)
- See other editors' selections / cursors in 3D
- Conflict-free property edits
- "Who's editing what" indicators
- Permission gates (viewers can be present, only editors can modify)

**Risks:**
- This is the hardest engineering in the whole roadmap. Distributed-systems-hard.
- Bugs are catastrophic (scene state diverges, world appears broken).
- Test coverage needs to be merciless here.

**Scope:** Large. Could realistically be 3+ months on its own.

---

## Phase 4 — Living Worlds

**Goal:** worlds stop being spaces and become *things that do something*.

This phase is where FORGE separates from "3D Instagram" and starts feeling like the early internet — primitive, full of broken weird stuff, but alive.

### Deliverables (in increasing order of difficulty)

- **Trigger zones** — invisible volumes that fire events when entered (play sound, show text, teleport)
- **Doors and teleporters** — move the visitor to another point within this world
- **Portals** — move the visitor to *another world entirely*. This is huge for the interconnected-universe vision. Portals are how the network forms.
- **Interactive props** — click to play sound, light up, open
- **Multiple spawn points** — visitors can enter at different points (from different portals, from different invite links)
- **Object state** — this lamp is on/off, this door is open/closed. Per-world state, persisted.
- **Visitor state** — small per-visitor flags (you've found the easter egg) — opt-in per world.

Then the big one — **scripting**.

### The scripting question

This is a fork in the road. Three paths:

1. **Declarative behaviors** — a curated palette of "if X then Y" rules. Easy, safe, limited. (e.g. "On enter trigger zone → teleport to spawn 2")
2. **Visual scripting** — node-based, like Unreal Blueprints. Mid difficulty, accessible to non-programmers, but a big UI undertaking.
3. **JS sandbox** — actual code, sandboxed (Quick.js, isolated workers). Most powerful, most dangerous, hardest to make safe.

**Strong recommendation:** start with declarative behaviors. Add visual scripting later. Add JS scripting much later (or never). The most successful platforms in this space (Roblox uses Lua, but it took years to get the editor right) made this transition over a decade. Don't build a programming language in a quarter.

### Risks

- Scripting opens the door to abuse — XSS via crafted scripts, infinite loops, asset theft. Sandboxing is a research problem.
- Performance degrades fast with many interactive objects.
- The temptation to build a game engine and lose focus on the social/platform layer.

**Scope:** Multi-quarter, possibly multi-year if scripting goes deep.

---

## Phase 5 — Persistent Ecosystem

**Goal:** FORGE stops being a platform with worlds and becomes a *universe* — persistent identity across worlds, shared assets, AI co-creators, the beginnings of an economy.

This is where the vision in Doc 2 starts to feel real. It's also where it's least possible to plan in detail today, because what you build here depends entirely on what you learned in Phases 1–4. The list below is the direction, not the slice plan.

### Likely deliverables

- **Persistent avatar** — your avatar follows you across worlds (within limits set by each world)
- **Cross-world asset library** — `.glb` files contributed by creators, licensed explicitly (CC, paid, free), reusable in any world
- **AI text-to-world (full)** — the original pitch finally as a complete feature. "Generate me a medieval village" produces a real scene graph. Not a toy.
- **Generated NPCs** — LLM-driven, conversational, embodied in worlds via Phase 4 scripting
- **Economy primitives** — tipping, world entry fees (optional, creator-set), maybe an internal credit system. Crypto stays banned.
- **World governance** — world-level moderators, role systems within a world, world-specific rules and bans
- **Events** — scheduled gatherings, concerts, classes, with discovery surfacing
- **Editorial layer** — curated collections, featured creators, weekly highlights

### Risks

- **Crypto pressure.** People will demand tokens. Resist hard. Crypto positioning poisons the brand.
- **Feature-parity arms race with Roblox/Rec Room.** You can't win on their terms. Win on yours — open, web, creator-owned.
- **Moderation explodes.** Once there's an economy, scammers arrive. Plan moderation upgrades in parallel.
- **AI generation quality is still mid-tier.** Set expectations honestly.

**Scope:** Multiple multi-quarter phases. This is where FORGE becomes a real company, not a project.

---

## Phase 6 — The Long Horizon

The Ready Player One layer. Probably 3–5 years out. Don't plan in detail. Do keep architectural decisions in Phases 2–5 compatible with it.

The directions to keep open:

- **Federation** — worlds hosted on other servers, accessible via a FORGE protocol. The internet, basically, but for worlds.
- **XR** — VR headsets, AR mode on phones. Render targets, not products. The same world should work in browser and headset.
- **Custom scripting language** with real developer tooling — if Phase 4 scripting goes well
- **Real marketplaces** — assets, worlds, services, with creator payouts
- **AI agents** — persistent autonomous characters living in worlds, not just NPCs spawned per visit
- **Worlds as APIs** — a world exposes data and services to other worlds. The deep version of portals.

The strategic note: every architectural decision in Phases 2–5 should ask "does this make Phase 6 harder?" Scene graph schema should be extensible. Identity should be portable. Asset model should support external references eventually. Avoid proprietary lock-in even where it's tempting.

---

## The Constants — What Never Changes

Across every phase, these stay fixed:

- **Web-first.** Always. No "we should pivot to a native app." No "we need a VR-first version." The web is the platform.
- **Disciplined slice-based execution.** Plan-mode, scope-locked slices. Resist the temptation to "just add one more thing."
- **Social-first.** Every phase should make the network effects stronger, not weaker. Features that don't compound socially are suspect.
- **Creator ownership.** Worlds belong to their creators. Always. This is the moat.
- **No crypto.** Resist the pressure. Resist it again.
- **No VR rabbit hole.** XR is a render target, not the product strategy.
- **Solo-buildable scope at any given moment.** You may hire eventually, but the design constraint is "could a small team ship this?" If a phase requires 50 engineers, the phase is wrong.

---

## Decisions That Block Progress

Three open from the prior conversation, plus new ones from this roadmap:

1. **Slice 7 before Slice 8?** → Strong recommendation: **yes**.
2. **Scene graph format in Phase 2?** → Recommendation: **roll your own minimal JSON, versioned**.
3. **Phase 2 scope — universal API + multi-surface, or browser-only editor?** → Decided: **universal API + multi-surface, with browser editor as the first client.** Desktop app and plugins are parked but architecturally enabled.
4. **Folder-watcher CLI — include in Phase 2 or park?** → Open. Worth it only if it stays a one-day build.
5. **Realtime backbone in Phase 3b?** → Recommendation: **Liveblocks for v1**. You don't have to lock this until Phase 3, but knowing the direction shapes Phase 2 decisions.
6. **AI generation timing?** → Recommendation: **small assistive features enter in Phase 2 inside the editor, full text-to-world becomes a headline feature in Phase 5**. Do not make it the headline before then.
7. **Launch channels and order for Phase 1?** → Recommendation: **r/threejs and r/blenderhelp first, Show HN after 200+ users and zero showstoppers, X/Bluesky in parallel**.
8. **Scripting model in Phase 4?** → Recommendation: **declarative behaviors first, visual scripting later, JS sandbox much later or never**.

You don't need to lock decisions 4–8 today. You do need 1, 2, and 3 settled to plan Slices 7 and 8 — and 3 is now settled.

---

## How This Roadmap Stays Honest

Roadmaps go stale. This one will too unless we treat it the same way as `PROJECT.md`:

- **Update after every phase.** When a phase ships, the next phase's detail level goes up; the phase after that gets a real plan.
- **Phases past the current one + 1 are sketches, not commitments.** Phase 4 detail today is a guess. Phase 4 detail when Phase 3 ships will be real.
- **Re-read this doc at the start of each new phase.** Ask: does the destination still make sense given what we learned?
- **The destination is allowed to change.** The discipline is not.

---

_Companion to `PROJECT.md`. Read both at the start of any new session._
