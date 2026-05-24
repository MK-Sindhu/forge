@AGENTS.md

## Project documentation structure

Strategic / cross-cutting (always relevant):

- `PROJECT.md` — current state, decisions, parking lot
- `ROADMAP.md` — long arc, phases, vision
- `TRACKER.md` — slice/task progress, what's done, what's left, what's broken
- `AGENTS.md` — subagent orchestration overview (included above)

Role-specific (each subagent loads its own):

- `docs/frontend.md` — `frontend-dev`
- `docs/backend.md` — `backend-dev`
- `docs/3d.md` — `r3f-engineer`
- `docs/infra.md` — `deploy-ops`
- `docs/testing.md` — `test-engineer`
- `docs/features.md` — cross-cutting platform tour (owned by `forge-lead`)
- `docs/README.md` — full doc index
- `docs/MAINTENANCE.md` — the protocol that keeps these docs in sync with the code

Subagents should load `PROJECT.md` + `TRACKER.md` + their own role doc — not all the docs. Loading everything wastes context.

## Doc maintenance

Doc updates are part of slice completion, not after it. Every worker subagent owns one role doc and must update it before reporting any task complete. `forge-lead` enforces this and owns the cross-cutting docs (`TRACKER`, `PROJECT`, `features`). See `docs/MAINTENANCE.md` for the full protocol, ownership table, and update triggers.
