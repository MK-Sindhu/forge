# Seed worlds bulk uploader

One-shot script to upload N worlds to FORGE from a local manifest.
Uploads are sequential (no parallelism) and idempotent — re-running
skips worlds whose title already exists in the DB.

## Setup (one-time)

1. Create a folder to hold seed assets:

   ```bash
   mkdir -p scripts/seed-worlds/assets
   ```

2. Drop your `.glb` files and thumbnail images into `scripts/seed-worlds/assets/`.

3. Create `scripts/seed-worlds/manifest.json` (gitignored). Example:

   ```json
   [
     {
       "glbPath": "scripts/seed-worlds/assets/forest-cabin.glb",
       "thumbnailPath": "scripts/seed-worlds/assets/forest-cabin.png",
       "title": "Forest Cabin",
       "description": "A small cabin in a pine forest. Original asset by Quaternius, CC0.",
       "tags": ["forest", "cabin", "lowpoly", "diorama"]
     },
     {
       "glbPath": "scripts/seed-worlds/assets/alien-temple.glb",
       "thumbnailPath": "scripts/seed-worlds/assets/alien-temple.jpg",
       "title": "Alien Temple",
       "description": "Overgrown ruins on a distant moon.",
       "tags": ["scifi", "ruins", "alien"],
       "videoPath": "scripts/seed-worlds/assets/alien-temple-preview.mp4",
       "imagePaths": [
         "scripts/seed-worlds/assets/alien-temple-interior.jpg",
         "scripts/seed-worlds/assets/alien-temple-exterior.jpg"
       ]
     }
   ]
   ```

### Manifest fields

| Field | Required | Notes |
|---|---|---|
| `glbPath` | Yes | Path to the `.glb` (or `.gltf`) file. Relative to repo root or absolute. |
| `thumbnailPath` | Yes | PNG, JPEG, or WebP. Max 2 MB. |
| `title` | Yes | Must be unique — used to detect duplicates for idempotency. Max 100 chars. |
| `description` | No | Max 1000 chars. |
| `tags` | No | Array of strings, max 5. Lowercase, alphanumeric + dash/underscore. e.g. `["forest", "lowpoly"]`. |
| `videoPath` | No | MP4 only. Max 15 MB. |
| `imagePaths` | No | PNG/JPEG/WebP array, max 4 items. Max 5 MB each. |

## Auth

The script authenticates via the `__session` cookie JWT from Clerk.
This is the same short-lived token the browser uses.

To grab it:

1. Open the FORGE site you are seeding:
   - Local: `http://localhost:3000`
   - Prod: `https://forge-black-eta.vercel.app`
2. Sign in as the account you want the seed worlds attributed to.
3. DevTools (F12 or Cmd+Option+I) → **Application** tab → **Cookies** → select the site.
4. Find the `__session` cookie and copy its **Value** (a long JWT string starting with `ey...`).
5. Export it:

   ```bash
   export CLERK_SESSION_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
   ```

   Or add it to `.env.local` (already gitignored):

   ```
   CLERK_SESSION_TOKEN=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

Note: Clerk session JWTs are short-lived (typically 1 minute). If the
script takes longer than the token expiry you will start getting 401
errors. Re-copy the cookie value and re-run — the script will skip
already-uploaded worlds and resume from the first failure.

## Run

```bash
# Against local dev (default):
npx tsx scripts/seed-worlds.ts

# Or via the npm script alias:
npm run db:seed-worlds

# Against prod:
SEED_API_BASE=https://forge-black-eta.vercel.app npx tsx scripts/seed-worlds.ts
```

The script prints one block per world:

```
[1/3] uploading "Forest Cabin"...
  GLB signed (4.21 MB) -> R2...
  thumbnail signed (180 KB) -> R2...
  world row created (id: 018f...). [ok]
```

Already-existing worlds print:

```
[2/3] uploading "Forest Cabin"...
  -> already exists, skipping
```

## File size limits

| Kind | Limit |
|---|---|
| `.glb` / `.gltf` | 50 MB |
| thumbnail | 2 MB |
| image (extra) | 5 MB |
| video | 15 MB |

The script validates sizes before making any API calls. Files that exceed
the limit cause a hard error for that entry; the rest of the manifest
continues.

## What to seed

See ROADMAP.md Phase 1 Risks ("Don't launch with <30 worlds visible").
Good CC0 / CC-BY sources:

- **Khronos glTF Sample Models** (MIT) — variety of canonical test scenes.
  https://github.com/KhronosGroup/glTF-Sample-Models
- **Quaternius CC0 packs** — low-poly stylized, great thumbnails.
  https://quaternius.com
- **Sketchfab CC0 filter** — wide variety; search → License → CC0.
  https://sketchfab.com/search?features=downloadable&sort_by=-likeCount&license=322a749bcfa841b29dff1e8a1bb74b0b

Avoid CC-BY-NC licenses (no commercial use would block the platform).
Always keep a record of the source + license for each asset.
