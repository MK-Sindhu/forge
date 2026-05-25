# Launch Posts — draft copy

> Copy-paste-ready drafts for each launch channel, in the order ROADMAP §Phase 1 specifies (small communities first, HN last).
>
> **All copy is a starting draft.** Edit it to match your voice — your post will outperform anything that sounds AI-generated. Especially the personal/origin parts.

---

## Before posting checklist

Don't post any of these until the following are true. The first-impression cost of launching into a half-baked platform is real.

- [ ] **30+ seed worlds live in prod.** ROADMAP risk: "Don't launch with <30 worlds visible." Each one represents the kind of content you want others to upload — quality > quantity.
- [ ] **DMCA email is real** (not `dmca@forge.example`). Reviewers WILL test takedown flows. A bad-looking placeholder kills credibility.
- [ ] **Terms + Privacy reviewed by an attorney** (or at minimum, the `[Jurisdiction TBD]` placeholders resolved and a real contact email substituted). The amber DRAFT banner is fine for now but should come off before posting.
- [ ] **Vercel Web Analytics enabled.** You need to see who clicks through from which post — that's the entire point.
- [ ] **Spot-check the 5 Slice 7 prod-smoked features still work** (tags upload, search, view count increments, trending tab, notifications) on a fresh incognito browser.
- [ ] **Moderation queue empty + you've practiced the resolve flow.** Inevitably someone will test the report button immediately.
- [ ] **You have ~2 hours blocked off** after each post to respond to comments. First-hour engagement matters disproportionately on Reddit + HN.

---

## Posting order (ROADMAP-locked)

1. **r/threejs** + **r/WebGL** — small, forgiving, 3D-literate. Best for catching technical bugs early. **Post first.**
2. **r/blender** + (cautiously) **r/blenderhelp** — creator audience, will become uploaders if the platform looks good. **Post day 1 or day 2.**
3. **X / Bluesky** 3D community — parallel with the Reddit posts. Hashtags + short video preview.
4. **Show HN** — broad tech audience. **Post LAST**, after the above have stress-tested for 1–2 weeks and FORGE has 200+ real users + no showstopper bugs. HN traffic spikes are unforgiving on edge cases.

---

## 1. r/threejs

**Subreddit:** https://reddit.com/r/threejs
**Best time to post:** weekday morning ET (peak EU/US dev overlap)
**Rules to skim:** no pure self-promo without context — frame as "I built this, here's the technical interesting bits." That sub is generous to anyone showing the work.

### Title

> Show r/threejs: FORGE — a feed-first social platform for 3D worlds I built solo with R3F + Next.js

### Body

```
Hi r/threejs 👋

I've been building FORGE — basically YouTube/Instagram but for 3D worlds. Creators upload `.glb` files; visitors browse a feed, click any world, and explore it in the browser. Likes, comments, follows, search, trending — the full social loop on top of a 3D viewer.

Live: https://forge-black-eta.vercel.app
Code: https://github.com/MK-Sindhu/forge

**Tech stack** (the part you're probably here for):

- **Renderer:** React Three Fiber 9 + drei (`useGLTF`, `Bounds`, `OrbitControls`, `Environment`)
- **Loading:** `useGLTF` wrapped in Suspense, lazy-loaded via `dynamic(..., { ssr: false })` so the feed page bundle doesn't pull Three.js
- **Auto-fit camera:** drei's `<Bounds fit clip observe margin={1.4}>` so any-scale GLB just works on first load
- **Hover-preview videos** on feed cards via `<video preload="none">` to keep bandwidth sane at 50+ cards
- **App:** Next.js 16 App Router, Tailwind v4
- **Auth + DB:** Clerk + Neon Postgres + Drizzle
- **Storage:** Cloudflare R2 (presigned PUT direct from browser — bypasses Vercel's 4.5MB body limit)
- **Search:** Postgres full-text search via `tsvector` + GIN, triggers keep it fresh on tag changes

Constraints I'm working under:
- 50 MB cap on GLB uploads (enforced in presigned URL)
- No physics, no FPS controls, no VR — orbit/zoom only in v1
- Single `.glb` per world for now (scene-graph composition is Phase 2)
- Solo + student so the entire thing is meant to be solo-maintainable

**I'd love feedback on:**

1. WorldViewer performance — does any seed world render slowly on your hardware?
2. The auto-fit camera behavior on weird-scale GLBs
3. The hover-to-play video preview pattern in the feed (smart? overkill?)
4. Search relevance ranking
5. Anything that screams "you should be doing X instead"

Phase 2 will pivot worlds from "one .glb file" to a scene-graph behind an API + an in-browser editor (any tool, any creator). I'd love to talk through that design with anyone who's been deep on web 3D editors.

Thanks for taking a look 🙏
```

### Posting notes

- Reply to every top-level comment in the first 2 hours. Even a one-liner thank-you reply triples your visibility via re-rank.
- If asked about commercial / monetization: be honest — free, no plans for crypto/NFT, may eventually need a Pro tier for power users.
- If asked about iOS/Android: web-first, no native plans, responsive web works on mobile.
- If a maintainer of three.js or drei comments — be receptive, mention the specific drei helpers you use.

---

## 2. r/WebGL

**Subreddit:** https://reddit.com/r/webgl
**Best time to post:** same day as r/threejs (parallel) — different audience overlap
**Rules to skim:** very small sub but very high signal — devs there will catch GPU bugs your QA won't.

### Title

> Show r/WebGL: FORGE — social feed of user-uploaded GLB worlds, built on R3F + drei

### Body

```
Posting in parallel with r/threejs. Same project, shorter pitch for this crowd.

Live: https://forge-black-eta.vercel.app

FORGE is a social feed where creators upload `.glb` files and visitors explore them in the browser. R3F 9 + drei + Next.js 16 App Router. WebGL2 via Three.js's renderer.

Specifically interested in:
- Any rendering issues on your GPU / browser combo
- Memory behavior on large GLBs (the cap is 50 MB but I'd like to push it)
- Texture-heavy scenes — anything that consistently crashes mobile Safari, please tell me

Code: https://github.com/MK-Sindhu/forge

Thanks 👀
```

### Posting notes

- This sub is tiny; expect <10 comments. Quality > volume. Anyone who replies is likely a serious WebGL dev.
- Don't repost from r/threejs — the audience overlap is small enough that both communities want their own post.

---

## 3. r/blender

**Subreddit:** https://reddit.com/r/blender (NOT r/blenderhelp — see notes)
**Best time to post:** day 1 or 2 after Reddit/three.js launch, when you have ~5+ "founding creator" worlds visible to anchor newcomers
**Rules to skim:** r/blender allows showcases + tool announcements; r/blenderhelp is strictly help requests and will remove this kind of post.

### Title

> I built a free platform where you can upload your Blender exports as 3D worlds, share them on a feed, and let people walk through them in a browser

### Body

```
Hey r/blender 👋

I made FORGE — a social platform for 3D worlds. The pitch: export your Blender scene to `.glb`, drop it in FORGE, and visitors can walk through it in their browser. No installs, no plugins, no VR required. Likes, comments, follows — the usual social loop.

Live: https://forge-black-eta.vercel.app

**For creators specifically:**
- 100% free
- **You own your worlds.** I'll never claim rights to your content. (Locked in the Terms.)
- Up to 50 MB per `.glb`. Optional preview video + 4 extra images per world.
- Tags + Postgres full-text search — your work is findable.
- No crypto, no NFTs, no tokens. Won't change.

**Honest disclosure:** the platform launched [DAY] with [N] worlds — small but growing. I'm specifically looking for "founding creators" to seed it. If you upload in the first week and DM me, I'll add a "founding creator" badge to your profile [if/when implemented].

What kinds of scenes work well: low-poly environments, dioramas, architectural visualizations, sculpts, animation clips (if baked into the GLB), product viz. Anything that benefits from being walked-around instead of rendered to a flat image.

Would love your feedback — both as creators (does the upload flow make sense?) and as viewers (does the feed format work for 3D?).

Cheers
```

### Posting notes

- Include 1–2 screenshots / a short GIF in the post. r/blender is heavily visual. If you can attach a screenshot of YOUR own seed world rendering on FORGE, even better.
- Don't say "I built this in X weeks" — r/blender doesn't care about your timeline, they care about whether the platform respects their work.
- Mention CC-friendly licensing if you're sourcing some seed worlds from Poly Pizza / Quaternius — that builds trust.
- DON'T cross-post to r/blenderhelp; that sub is for help requests only. If you want a second Blender community, try r/blendercommunity or r/b3d.

---

## 4. X / Bluesky

**Best time to post:** parallel with Reddit posts (day 1)
**Length:** 1–2 sentences + image/video preview + 1–2 hashtags max
**Tag:** `#threejs` `#webgl` `#b3d` (Blender) `#webdev` — pick 2 max per platform

### Variant A — for X (Twitter)

```
just shipped FORGE — a social feed for 3D worlds you can walk through in your browser. upload your .glb, get likes, build a following

solo built · web-first · creators own everything · no crypto

🔗 forge-black-eta.vercel.app

#threejs #b3d
```

### Variant B — for Bluesky

```
shipped a thing: FORGE is a social platform for 3D worlds. upload a .glb, visitors explore it in the browser, social loop on top (likes/comments/follows/search/trending).

solo built in a few weeks with R3F + Next.js. free, no crypto, creators own their work.

forge-black-eta.vercel.app
```

### Posting notes

- **Attach a short looping video** (5–10 sec) of someone exploring one of your seed worlds. Static screenshots don't communicate the 3D-ness. Use OBS or QuickTime, then convert with `ffmpeg -i in.mov -vf "scale=720:-1" -t 10 -loop 0 out.gif` for a small GIF, or post as native video.
- Quote-tweet / reskeet your own post once or twice over the next week with new seed worlds as social proof.
- Reply to anyone in the 3D community who engages — even one-liners. Same first-hour-engagement rule as Reddit.

---

## 5. Show HN

**Site:** https://news.ycombinator.com/submit
**Best time to post:** weekday morning ET (10–11am ET hits the work-day window). NOT a Sunday.
**Length:** title constrained by HN; body can be longer (in the first comment).
**Rules to skim:** strict guidelines — https://news.ycombinator.com/showhn.html. Title must start with `Show HN:`, must be your project, must have something people can actually try.

### Title

```
Show HN: FORGE – a social feed of 3D worlds built with React Three Fiber
```

(Title cap is 80 chars including "Show HN:". This is 73.)

### URL

```
https://forge-black-eta.vercel.app
```

### Optional first comment (post immediately after submitting)

```
Hi HN 👋

I'm a solo student dev. FORGE is what I've been building for the last [N weeks]: a social feed for 3D worlds. Creators upload `.glb` files; visitors browse a feed, open a world, and explore it in the browser. Likes, comments, follows, full-text search, trending tab, notifications — the full social mechanics on top of a 3D viewer.

**Why this exists.** Most platforms for 3D content force the creator into a specific tool (Roblox, Unity, Unreal). FORGE doesn't care what you used — Blender, Maya, Spline, Houdini — as long as it exports to `.glb`. Phase 2 will turn worlds into scene-graph compositions behind a documented API so any editing surface (browser editor first, future native apps, plugins, AI agents) can write to the same canonical state. The point: one world, one canonical state, many ways to edit it, all equal. Today we're at "any tool can publish"; Phase 2 unlocks "any tool can edit."

**Stack** (since you'll ask):
- Next.js 16 (App Router) + TypeScript + Tailwind v4
- React Three Fiber 9 + drei for the 3D viewer
- Clerk for auth, Neon Postgres + Drizzle for the DB, Cloudflare R2 for `.glb`/media storage
- Postgres full-text search (`tsvector` + GIN + triggers that keep the index fresh on tag changes)
- All in-app notifications fire post-commit best-effort so a notification bug never breaks the underlying action
- ~21 test files / 417 tests
- Vercel for hosting

**What I want feedback on:**
1. The upload flow — is the 5-step form bearable? (GLB → thumbnail → optional video/images → metadata → publish)
2. Search relevance — does ranking feel right? Anything missing?
3. The trending algorithm is dumb (`likes × pow(0.5, age_hours / 24)`); does it produce results that make sense to you?
4. Performance on your hardware — any worlds that render slowly or crash?
5. Anything I'm doing dangerously wrong from a security / scaling angle

**Honest limitations:**
- Small content library at launch (~[N] seed worlds). Looking for early creators.
- Terms + Privacy Policy are drafts pending attorney finalization (banners on each page make this clear).
- No mobile native app. Responsive web works; the upload form is awkward on phones.
- Single `.glb` per world today. Composition is Phase 2.

No crypto. No tokens. Never will. Creators own their worlds.

Will be here in the comments all day. Thanks for the read 🙏

GitHub: https://github.com/MK-Sindhu/forge
```

### Posting notes

- **Title format matters.** Read https://news.ycombinator.com/showhn.html before submitting.
- **Don't ask for upvotes.** HN flags vote-rigging hard and your post will get killed.
- **First-hour engagement is everything.** Post when you can babysit for ~3 hours minimum.
- **Be brutally honest about limitations.** HN respects "this is broken in these specific ways and I'd appreciate feedback" infinitely more than "this is amazing, please try it." The Honest Limitations section above is intentional — keep it.
- **Reply to every top-level comment.** Even angry ones. Especially angry ones. The HN crowd judges responsiveness.
- **Have prod ready for traffic.** A Show HN can easily 100x your normal traffic for an afternoon. Vercel + Neon's autoscaling should hold but watch the Neon connection pool. If you see request errors during the spike, add a few `console.error` logs to figure out what's breaking — easier than debugging post-hoc.

---

## After-launch dashboard

Things to watch in the first 48 hours after each post:

- **Vercel Web Analytics** — visitors, page views, top pages, top referrers (each post should be a clearly identifiable referrer)
- **Sign-up rate** — Clerk dashboard shows new user count over time
- **Upload rate** — `SELECT count(*) FROM worlds WHERE created_at > now() - interval '24 hours';`
- **Active engagement** — likes + comments + follows in the same window
- **Report queue** — check `/admin/reports` every few hours; respond to anything flagged within 24 hours
- **Error rate** — Vercel Logs tab; look for 500s
- **Database load** — Neon dashboard; watch the connection count and query latency

If something breaks at scale (Neon connection exhaustion, R2 bandwidth spike, Clerk rate limit): fix-forward immediately, write the post-mortem after. The launch window is too short to spend rebuilding the same hour twice.

Good luck.
