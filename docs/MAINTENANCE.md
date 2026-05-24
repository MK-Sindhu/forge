# Doc Maintenance Protocol

> How docs stay in sync with reality. This is a workflow contract, not a script.
>
> **Core principle:** a slice is not "done" until its docs reflect what was built. Updating the relevant doc is part of the work, not a follow-up.

## Why this exists

Documentation drift is the single most reliable failure mode for systems like this. After 6 months without a protocol, every doc here is out of date and every subagent's context gets poisoned by stale information. The protocol below prevents that without adding meaningful overhead — most updates are 5–20 lines per slice, written by the subagent that just touched the code.

## Ownership Rules

Each doc has exactly one owner who is responsible for keeping it accurate. Other subagents can read it; only the owner edits.

| Doc | Owner | Edits allowed by |
|---|---|---|
| `docs/frontend.md` | `frontend-dev` | frontend-dev, forge-lead |
| `docs/backend.md` | `backend-dev` | backend-dev, forge-lead |
| `docs/3d.md` | `r3f-engineer` | r3f-engineer, forge-lead |
| `docs/infra.md` | `deploy-ops` | deploy-ops, forge-lead |
| `docs/testing.md` | `test-engineer` | test-engineer, forge-lead |
| `docs/features.md` | `forge-lead` | forge-lead only (cross-cutting) |
| `TRACKER.md` | `forge-lead` | forge-lead, founder |
| `PROJECT.md` | `forge-lead` | forge-lead, founder |
| `ROADMAP.md` | `forge-lead` | forge-lead, founder (rare changes) |
| `docs/MAINTENANCE.md` | `forge-lead` | forge-lead, founder |
| `CLAUDE.md` | `forge-lead` | forge-lead, founder |

## Update Triggers — When to Touch Which Doc

When a sub-slice or task produces any of the changes below, the subagent doing the work updates the listed doc as part of completing the task — not later.

### Schema / DB changes

| Change | Doc to update |
|---|---|
| New table or column | `backend.md` schema section · `TRACKER.md` slice schema list |
| New migration file | `backend.md` migration list · `infra.md` if any new env vars |
| New auth-related table or column (e.g., `is_admin`) | `backend.md` schema section · `infra.md` if it affects deploy |

### API surface changes

| Change | Doc to update |
|---|---|
| New API route | `backend.md` API route inventory table · `features.md` if user-facing |
| Changed auth requirements on an existing route | `backend.md` API route inventory table |
| New auth helper in `src/lib/users.ts` | `backend.md` auth helpers section |
| New common backend pattern (cursor pagination helper, etc.) | `backend.md` patterns section |

### Frontend changes

| Change | Doc to update |
|---|---|
| New page in `src/app/` | `frontend.md` pages table · `features.md` if user-facing |
| New shared component in `src/components/` | `frontend.md` file structure / inventory |
| New UI pattern (e.g., a new optimistic update style) | `frontend.md` patterns section |
| New Clerk v7 quirk discovered | `frontend.md` Clerk quirks table |
| Styling convention change (Tailwind config, dark mode, etc.) | `frontend.md` styling section |

### 3D / rendering changes

| Change | Doc to update |
|---|---|
| Changes to `<WorldViewer>` or any `<Canvas>` content | `3d.md` |
| New drei helper adopted | `3d.md` stack section |
| Performance budget change (max .glb size, polygon caps) | `3d.md` performance budget section |
| Phase 2 — scene graph schema changes | `3d.md` scene graph section · `backend.md` schema section (the JSONB structure) |

### Infra / deploy changes

| Change | Doc to update |
|---|---|
| New env var | `infra.md` env section · `.env.example` (the file itself) · CI workflow if needed |
| Vercel config change | `infra.md` Vercel section |
| Neon / DB config change | `infra.md` database section |
| R2 bucket or config change | `infra.md` storage section · `docs/R2_SETUP.md` if setup steps change |
| CI workflow change | `infra.md` CI section |
| Migration deploy flow change | `infra.md` migration deploy section |

### Test changes

| Change | Doc to update |
|---|---|
| New mocking pattern adopted | `testing.md` mocking patterns |
| New common test case added to the every-route checklist | `testing.md` common test cases |
| Tests for a slice complete | `testing.md` per-slice inventory table · `TRACKER.md` test count |
| End-to-end / Playwright suite added (future) | `testing.md` |

### Slice / roadmap-level changes

| Change | Doc to update |
|---|---|
| Sub-slice shipped | `TRACKER.md` sub-slice status (⬜ → 🟢) |
| Slice complete + deployed | `TRACKER.md` slice row, test count, commit hash · `PROJECT.md` current-slice section |
| Production smoke test passed | `TRACKER.md` slice row (🟢 → ✅) |
| Production smoke test failed | `TRACKER.md` known issues section · keep slice as 🟢, do not flip |
| Decision made (non-obvious choice) | `PROJECT.md` decision log |
| Phase complete | `TRACKER.md` phase rollup · `PROJECT.md` current phase |
| Roadmap direction shifts | `ROADMAP.md` (rare) |
| New feature ships | `features.md` — add to index + write a section |
| Architectural pattern change that affects multiple layers | Multiple role docs · `ROADMAP.md` if it's strategic |

## Workflow — How an Update Actually Happens

### Per sub-slice (the inner loop)

This is what runs 8–16 times per slice.

1. forge-lead delegates the sub-slice to the right worker subagent.
2. The worker subagent makes the code changes.
3. **Before reporting complete**, the subagent updates its role doc — adding new entries, modifying changed entries, removing dead entries.
4. The subagent reports complete, including in the structured report: `Docs updated: docs/[file].md — [brief summary]`.
5. forge-lead verifies the doc update by reading the changed section (10-second cost, catches 95% of misses).
6. If the doc update is missing or thin → forge-lead delegates a follow-up: "update docs/X.md to reflect [specific change]."

### Per slice complete (the outer loop)

After all sub-slices ship and tests pass:

1. forge-lead updates `TRACKER.md`:
   - Mark all sub-slices ✅ or 🟢
   - Update test count
   - Update commit hash
   - Add any known issues
2. forge-lead updates `PROJECT.md`:
   - Move current slice forward
   - Add any decisions made during the slice to the decision log
3. forge-lead updates `features.md`:
   - Add any new features to the index + write feature sections
4. forge-lead reports to founder: "Slice N done. Docs updated: TRACKER, PROJECT, features, [role docs]."

### Per smoke test (the verification loop)

After a production smoke test:

1. Founder reports results in chat.
2. forge-lead updates `TRACKER.md`:
   - Pass → flip 🟢 to ✅ for the slice
   - Fail → leave as 🟢, add to known issues, plan a fix slice or hotfix

## Mandatory Subagent Behaviors

The following text should appear in **every** worker subagent's `.claude/agents/*.md` prompt. Copy verbatim into:

- `.claude/agents/frontend-dev.md`
- `.claude/agents/backend-dev.md`
- `.claude/agents/r3f-engineer.md`
- `.claude/agents/deploy-ops.md`
- `.claude/agents/test-engineer.md`

Replace `[YOUR_DOC]` with `docs/frontend.md` / `docs/backend.md` / `docs/3d.md` / `docs/infra.md` / `docs/testing.md` respectively.

```
## Documentation Responsibility

You own `[YOUR_DOC]`. Before reporting any task complete:

1. Read the "Update Triggers" table in `docs/MAINTENANCE.md` to identify
   which sections of your doc this task affects.
2. Update `[YOUR_DOC]` with the new reality:
   - Add new entries for anything created
   - Modify entries for anything changed
   - Remove entries for anything deleted
3. In your structured report, include a line:
   `Docs updated: [YOUR_DOC] — <brief summary of what changed>`
4. If a change you made affects another role's doc (rare but possible),
   note it in your report so forge-lead can delegate the cross-cutting
   update. Do NOT edit another subagent's doc directly.

A task is not complete if your doc still reflects the old reality.
This is non-negotiable.
```

## Mandatory forge-lead Behaviors

The following should appear in `.claude/agents/forge-lead.md`:

```
## Documentation Enforcement

You are the doc maintenance gatekeeper. On every worker report:

1. Check the report for the `Docs updated: ...` line.
2. If missing or thin → delegate a follow-up before marking the task done.
3. After every slice completes, you own updating:
   - `TRACKER.md` (sub-slice statuses, test count, commit hash, known issues)
   - `PROJECT.md` (current slice section, decision log if applicable)
   - `docs/features.md` (any new features added)
4. At session start, read PROJECT.md and TRACKER.md. If anything is
   marked 🟡 in-flight, surface it to the founder before doing anything else.
5. If a worker reports a change that crosses doc boundaries, you
   coordinate the cross-doc update (the worker stays in its lane).
```

## Session Start Audit

At the start of every Claude Code session, forge-lead performs a quick consistency check before any other work:

1. **Read** `PROJECT.md` + `TRACKER.md` + relevant memory files.
2. **Pick one recent change** from `TRACKER.md` (last shipped slice).
3. **Verify** the corresponding doc update happened — open the role doc, find the section, confirm the change is reflected.
4. **If drift is detected:** report to founder, propose a doc-catch-up before any new work.

This is a 30-second check, run once per session. Catches drift before it compounds.

## Drift Detection

Even with the protocol, drift can happen — usually because a subagent did the update but in a less-than-thorough way. Signs of drift to watch for:

- TRACKER.md still says 🟢 (deployed, not prod-smoked) on a slice that's been live for weeks
- A role doc references files that have been renamed or deleted
- features.md missing a recently-shipped feature
- backend.md API inventory missing routes that exist in `src/app/api/`
- PROJECT.md decision log doesn't mention a decision the founder remembers making

When detected: forge-lead schedules a focused doc-catch-up task. Don't let drift accumulate; one doc catch-up per month is sustainable, one every six months is misery.

## Optional Future: CI-level Drift Check

A simple GitHub Actions check could detect *some* drift automatically:

- Grep `src/app/api/` for all `route.ts` files; compare to the API table in `backend.md` — flag any not mentioned.
- Grep `drizzle/` migration count; compare to the count claimed in `infra.md` — flag mismatch.
- Grep `src/components/` for component directories; compare to `frontend.md` — flag missing.

This is parking-lot for now. It's brittle to set up and a strong workflow protocol covers 90% of cases. Revisit if drift becomes a recurring problem.

## Failure Mode Recovery

If docs ever drift significantly (say, after a hiatus), the recovery path:

1. forge-lead does a full audit: walk every doc, walk the codebase, list every drift.
2. Group drifts by owner subagent.
3. Delegate one catch-up task per subagent: "Audit your doc against the current codebase. Fix every drift. Report the diff."
4. Cross-check each report.
5. Update `TRACKER.md` known-issues section if any drift turned out to mask a real bug (it happens).

This is exactly what was done before this protocol existed — but now it shouldn't be needed more than once a year, if that.

---

## Summary — The Three Things Subagents Must Internalize

1. **Update your doc before reporting done.** Not after.
2. **Stay in your lane.** Don't edit other subagents' docs; flag cross-cutting changes for forge-lead.
3. **No silent updates.** Every doc change is mentioned in the structured report.

If these three habits hold, the docs stay current with no extra overhead. If they slip, the docs become a graveyard.