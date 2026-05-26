# forge-watch — FORGE Folder Watcher CLI

Watch a local folder for `.glb` file changes and automatically sync them into a FORGE scene-graph world. The "edit in Blender, save the file, it appears in FORGE" workflow.

---

## What it does

- Scans a folder on startup; any `.glb` files that are not already tracked in the world are uploaded as new assets and placed at the origin.
- When you save/overwrite a `.glb`, the script re-uploads it as a new asset and swaps every scene-graph object that referenced the old asset to point at the new one (identity-preserving — position, rotation, scale are unchanged).
- When you delete a `.glb` locally, the script logs it and does nothing else to the world (safe against accidental renames).
- All operations are serialized — no concurrent writes to the same world.
- Uses chokidar with `awaitWriteFinish` so partial Blender writes don't trigger a mid-save upload.

---

## Requirements

- The target FORGE world must already be a **scene-graph world** (not legacy GLB-only). If it is still a legacy world, click "Convert to scene graph" on the world page first.
- You must be the **owner** of the world.
- Node 18+ (comes with `fetch` built-in). The repo uses Node 24.

---

## Installation

Dependencies are already in `package.json` — just `npm install` from the repo root.

---

## How to get your session cookie

This CLI authenticates as you by replaying your browser session cookie.

1. Open your browser and sign in to FORGE.
2. Open DevTools:
   - Chrome/Edge: F12 or Cmd+Option+I (Mac) / Ctrl+Shift+I (Windows)
   - Firefox: F12 or Cmd+Option+I
3. Go to: **Application** tab (Chrome) or **Storage** tab (Firefox).
4. Expand **Cookies** and click on your FORGE domain (e.g. `https://forge-black-eta.vercel.app`).
5. Find the cookie named `__session`.
6. Click on it and copy the **Value** column — it is a long JWT string starting with `eyJ...`.
7. Pass it to the CLI via `--session=<value>` or set `FORGE_SESSION=<value>` in your shell.

**Session expiry:** Clerk sessions are short-lived (rolling ~1 hour, max 7 days). When you see `[!] Your session expired`, go back to DevTools and copy a fresh `__session` value.

---

## Usage

```bash
npm run forge:watch -- \
  --world-id=<uuid> \
  --folder=<local-path> \
  --session=<session-cookie-value> \
  [--base-url=http://localhost:3000]
```

Or using an environment variable for the session:

```bash
export FORGE_SESSION=eyJhbGci...
npm run forge:watch -- --world-id=<uuid> --folder=./my-blender-exports
```

### Arguments

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--world-id` | yes | — | UUID of the target world |
| `--folder` | yes | — | Local folder to watch for `.glb` files |
| `--session` | yes* | `$FORGE_SESSION` env var | Clerk `__session` cookie value |
| `--base-url` | no | `http://localhost:3000` | FORGE API base URL (use `https://forge-black-eta.vercel.app` for prod) |

*Required unless `FORGE_SESSION` env var is set.

### Getting your world ID

The world ID is the UUID in the URL when you view the world:
`https://forge-black-eta.vercel.app/world/<world-id-here>`

---

## Event glyphs

```
[+]  New .glb file detected — uploaded and placed in the world at origin
[~]  .glb file changed — re-uploaded; all matching scene objects swapped
[-]  .glb file deleted locally — kept in FORGE (delete via editor when ready)
[!]  Warning or error — operation failed; the watcher continues running
[OK] Operation succeeded
```

---

## Example session

```
FORGE Folder Watcher
Phase 2 — folder-watcher CLI

  World ID : 3f7a2e91-...
  Folder   : /Users/you/blender-exports
  Base URL : http://localhost:3000
  Session  : eyJhbGci...

  Stop: Ctrl+C

  Checking world... OK (current version 4)
  Loading existing assets... OK (2 assets already tracked)

    Already tracked: base.glb
    Already tracked: tree.glb
  Ready. Watching for .glb changes...
  (Ctrl+C to stop)

[+] New file: rock.glb
    [OK] Added: rock.glb -> object placed at origin (version 5)

[~] Changed: tree.glb
    [OK] Updated: tree.glb — 3 object(s) swapped (version 6)

[-] Deleted locally: old-prop.glb — kept in FORGE (delete from world via the editor).
```

---

## Known limitations (v1)

- **No auto-delete.** Deleting a `.glb` locally does NOT remove it from the FORGE world. This is intentional — an accidental folder rename would otherwise delete all your scene objects. Use the in-browser editor (coming in 8.4) to delete objects.
- **Old asset rows are kept.** On a file change, the old `world_assets` row is preserved because it is referenced by past `world_versions`. History is immutable. A future "remove unused assets" tool will GC them.
- **Session auth only.** No API token in v1. You must paste your `__session` cookie. API tokens are on the post-MVP roadmap.
- **No GLB validation.** The server accepts any binary named `.glb` — malformed files will upload successfully but fail to render.
- **One world per run.** Start multiple watchers for multiple worlds if needed.
- **Sub-folders not distinguished.** Files at `exports/buildings/tower.glb` and `exports/tower.glb` would both be keyed as `tower` — the second one would be treated as a change to the first. Keep filenames unique within the watched folder.
