# FORGE — Project Tracker

> The social network of virtual worlds. Scroll a feed, tap, enter a 3D world. AI builds the worlds from text.

**Last updated:** 2026-05-23
**Current phase:** Week 1–2 done. Next: Week 3–4 (World Viewer / Scene JSON renderer).
**Builder:** Solo (student)
**Build tool:** Claude Code

---

## 1. One-Line Pitch

FORGE is the YouTube/Instagram of virtual worlds — AI-generated 3D scenes you can scroll, enter, and share like posts.

## 2. Positioning

- **Not** Roblox (games economy)
- **Not** VRChat (VR-only hangout)
- **Not** Minecraft (sandbox game)
- **Is** a feed-first social network where the posts are 3D worlds, web-first, AI-assisted creation.

## 3. MVP Definition (locked — do not expand)

MVP is **done** when:
1. ✅ User can sign up / log in
2. ✅ User can generate a world from a text prompt (AI → scene JSON)
3. ✅ World is saved to their profile
4. ✅ World shows up in a public feed
5. ✅ Another user can open the world and look around

That's it. No multiplayer. No VR. No marketplace. No mobile app. No avatars beyond a profile pic.

## 4. Stack Decisions (locked)

| Layer       | Choice                          | Why |
|-------------|---------------------------------|-----|
| Frontend    | Next.js + React Three Fiber     | R3F is the cleanest way to use Three.js in React; Next.js handles routing + deploy |
| Styling     | Tailwind CSS                    | Fast, no design system needed for MVP |
| Backend     | Next.js API routes              | Monolith. One repo, one language, one deploy — solo-friendly. Migrate to a separate service later only if forced to. |
| Database    | PostgreSQL on Neon              | Scene JSON fits JSONB cleanly. Neon: 3 GB free tier, scales to zero, branching gives every Vercel preview its own DB. |
| ORM         | Drizzle                         | Plain SQL migrations (readable), TS-native schema, no codegen step, first-class Neon serverless driver. |
| Storage     | Cloudflare R2                   | Thumbnails now, 3D assets later. |
| AI          | Claude API (text → scene JSON)  | Already in the Anthropic ecosystem; TS SDK is first-class. |
| Auth        | Clerk                           | Drop-in `<SignIn />`, social login + MFA free, 10k MAU free tier. Decoupled from DB so swappable. |
| Deploy      | Vercel (full Next.js app)       | Single deploy — Vercel handles UI + API routes. DB is managed by Neon, not deployed by us. |

## 5. Core Abstraction — Scene JSON

Every world is a JSON document. This is the heart of FORGE.

```json
{
  "objects": [
    { "type": "cube", "position": [0,0,0], "color": "#ff0000" },
    { "type": "model", "url": "tree.glb", "position": [2,0,1] }
  ],
  "lighting": { "type": "sunset" },
  "environment": "skybox_1"
}
```

Why this matters: AI generates it, DB stores it, renderer reads it. One format, everything flows.

## 6. Roadmap

| Week | Goal                                    | Status |
|------|-----------------------------------------|--------|
| 0    | Decisions, repo setup, project tracker  | ✅ Done |
| 1–2  | Auth + DB schema + Next.js skeleton     | ✅ Done |
| 3–4  | World viewer (R3F renders scene JSON)   | ⬜ |
| 5    | World creation UI (basic)               | ⬜ |
| 6    | AI text → scene JSON                    | ⬜ |
| 7    | Feed page                               | ⬜ |
| 8    | Deploy + seed 20–50 worlds              | ⬜ |

## 7. Decision Log

_Format: date — decision — reasoning._

- **2026-05-23** — Name is FORGE. Locked.
- **2026-05-23** — Web-first. No VR/AR in MVP. Reason: solo student, 8-week target, can't afford device fragmentation.
- **2026-05-23** — Scene JSON is the single source of truth for a world. All other formats derive from it.
- **2026-05-23** — Backend: Next.js API routes (monolith). Reason: solo dev, one language/repo/deploy. TS Anthropic SDK is sufficient — no need for a separate Python service.
- **2026-05-23** — Database hosting: Neon. Reason: 3 GB free tier, scales to zero, branching gives preview deploys their own DB without extra config.
- **2026-05-23** — Auth: Clerk. Reason: fastest path to working auth (drop-in `<SignIn />`), 10k MAU free tier, decoupled from Neon so each is independently swappable.
- **2026-05-23** — ORM: Drizzle. Reason: native fit with Neon's serverless driver (cold-start matters on Vercel), plain SQL migrations stay readable when things go wrong, no codegen step, TS schema with strong inference.
- **2026-05-23** — Added `test-engineer` subagent. Reason: solo builder needs separation between code-writers and test-writers to keep tests unbiased. Spun up before most implementation exists so tests come from the spec, not the code.

## 8. Open Questions

1. ~~**Backend: FastAPI or Next.js API routes?**~~ ✅ Resolved 2026-05-23 → Next.js API routes.
2. ~~**Auth: Clerk / Supabase Auth / NextAuth / roll-own?**~~ ✅ Resolved 2026-05-23 → Clerk.
3. ~~**Database hosting: Railway / Supabase / Neon?**~~ ✅ Resolved 2026-05-23 → Neon.
4. ~~**ORM: Prisma vs Drizzle?**~~ ✅ Resolved 2026-05-23 → Drizzle.

## 9. Risks (active watch)

- **Overengineering** → strict MVP scope above
- **Performance** → cap worlds at 20 objects in MVP
- **Empty platform** → seed 20–50 AI-generated worlds before launch
- **AI cost** → cache generations, rate-limit free users

## 10. What's NOT in MVP (parking lot)

These are good ideas. They are not Week 1–8 ideas.

- Multiplayer / presence
- VR / AR rendering
- Avatars & customization
- Creator monetization
- Asset marketplace
- Mobile app
- AR mode on phones
- NPC generation
- Voice chat
- Followers / social graph (basic profile only in MVP)

---

_This doc updates every session. When something changes, we change it here first, then we code._
