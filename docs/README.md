# FORGE Documentation Index

> Each subagent loads its own doc, not all of them. Cross-link instead of duplicating.

## Auto-loaded by Claude Code

| Doc | Purpose | Notes |
|---|---|---|
| [`/CLAUDE.md`](../CLAUDE.md) | Claude Code project instructions | Auto-loaded every session. Should point sessions at the docs below. |
| [`/AGENTS.md`](../AGENTS.md) | The 6-subagent orchestration system | Defines roles and boundaries between forge-lead, frontend-dev, backend-dev, r3f-engineer, deploy-ops, test-engineer. |

## The Big Picture (cross-cutting, load first)

| Doc | Purpose | Who loads it |
|---|---|---|
| [`/PROJECT.md`](../PROJECT.md) | Current state + decisions + parking lot | Every subagent |
| [`/ROADMAP.md`](../ROADMAP.md) | Long arc, phases, vision | forge-lead, planning sessions |
| [`/TRACKER.md`](../TRACKER.md) | Slice/task progress — what's done, what's left, what's broken | forge-lead, every session start |

## Role-Specific Reference (each subagent loads its own)

| Doc | Owner subagent | What's in it |
|---|---|---|
| [`frontend.md`](./frontend.md) | frontend-dev | Pages, components, routing, Tailwind conventions, Clerk v7 patterns, optimistic updates |
| [`backend.md`](./backend.md) | backend-dev | API routes, DB schema, auth helpers, R2 patterns, common backend patterns |
| [`3d.md`](./3d.md) | r3f-engineer | WorldViewer, R3F + drei usage, asset loading, performance budget, Phase 2 scene graph rendering |
| [`infra.md`](./infra.md) | deploy-ops | Vercel, Neon, R2, GitHub Actions, env vars, deploy flow |
| [`testing.md`](./testing.md) | test-engineer | Testing philosophy, file structure, patterns, mocking |

## Cross-Cutting Tour

| Doc | Purpose | Who loads it |
|---|---|---|
| [`features.md`](./features.md) | Platform tour — every shipped feature with frontend + backend + DB touchpoints | New sessions, onboarding, scope questions |

## Maintenance Protocol

| Doc | Purpose | Who loads it |
|---|---|---|
| [`MAINTENANCE.md`](./MAINTENANCE.md) | How docs stay in sync with reality. Ownership rules, update triggers, mandatory subagent behaviors. | forge-lead always; every worker subagent at task start |

## Existing Setup Docs

| Doc | Purpose |
|---|---|
| [`R2_SETUP.md`](./R2_SETUP.md) | One-time R2 bucket setup steps. Referenced from `infra.md`. |

## Maintenance Rules

1. **Update the doc, then code.** If a slice changes the auth pattern, `backend.md` updates *before* the code does. If a slice adds a new component pattern, `frontend.md` updates first.
2. **No duplication.** If something belongs in `backend.md`, link to it from elsewhere — don't repeat.
3. **TODO markers are honest.** `<!-- TODO -->` is fine, hand-wave is not. Subagents fill TODOs when they touch the area.
4. **PROJECT.md is the index, not the encyclopedia.** It points to these docs; it doesn't replicate them.
5. **CLAUDE.md should point here.** After this restructure, update `CLAUDE.md` so every session loads the right docs by default.
