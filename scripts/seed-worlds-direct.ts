/**
 * scripts/seed-worlds-direct.ts
 *
 * **Bypass Vercel entirely** — same outcome as `db:seed-worlds`, but signs
 * R2 PUT URLs locally using R2 credentials from .env.local and writes
 * worlds/world_media/tags/world_tags rows directly to the DB via Drizzle.
 *
 * Why this exists: the Vercel-API path (db:seed-worlds) is the right
 * production path but depends on the founder's network being able to reach
 * Vercel's edge IPs AND on Clerk session auth being honored from a script.
 * When either of those breaks (transient routing / Clerk session quirks),
 * this script is the escape hatch.
 *
 * What it skips that the real API does:
 *  - Clerk session auth (uses OWNER_USERNAME env var instead)
 *  - The rate limiter on POST /api/uploads/sign (there isn't one yet anyway)
 *  - Any future server-side hooks attached to POST /api/worlds — if we add
 *    those, mirror them here.
 *
 * What it still does (matches the real API):
 *  - 50MB GLB cap, 2MB thumbnail cap, 5MB image cap, 15MB video cap
 *  - HEAD-verifies every R2 upload before recording the DB row
 *  - Same R2 key layout (worlds/{userId}/{worldId}/{world.glb|thumbnail.ext|...})
 *  - Same DB shape: worlds, world_media (with position), tags
 *    (ON CONFLICT DO NOTHING), world_tags junction rows
 *  - Same tag normalization: lowercase + trim + dedupe + regex
 *  - Single transaction per world (atomic insert)
 *  - Idempotent on title (skip if already in DB)
 *
 * Usage:
 *   OWNER_USERNAME=<your-username> npm run db:seed-worlds-direct
 *
 *   Optional: SEED_API_BASE overrides DB target — but normally this script
 *   uses the DATABASE_URL from .env.local directly (which already points
 *   at prod Neon if you set it for db:migrate). No Vercel hop.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { readFile, stat } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OWNER_USERNAME = process.env.OWNER_USERNAME;
if (!OWNER_USERNAME) {
  console.error(
    "Error: OWNER_USERNAME is not set.\n" +
    "  Set it to the username of the account that will own the seed worlds.\n" +
    "  Example: OWNER_USERNAME=1234mohitsindhu npm run db:seed-worlds-direct"
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error(
    "Error: DATABASE_URL is not set in .env.local.\n" +
    "  Same value you use for npm run db:migrate."
  );
  process.exit(1);
}

const SIZE_LIMITS: Record<string, number> = {
  glb:       50 * 1024 * 1024,
  thumbnail:  2 * 1024 * 1024,
  image:      5 * 1024 * 1024,
  video:     15 * 1024 * 1024,
};

const TAG_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Kind = "glb" | "thumbnail" | "image" | "video";

type ManifestEntry = {
  glbPath: string;
  title: string;
  description?: string;
  tags?: string[];
  thumbnailPath: string;
  videoPath?: string;
  imagePaths?: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferExt(localPath: string, kind: Kind): string {
  const ext = path.extname(localPath).toLowerCase().replace(/^\./, "");
  if (kind === "glb") return "glb";
  if (kind === "video") return "mp4";
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "webp") return "webp";
  return "png";
}

function inferContentType(ext: string): string {
  if (ext === "glb") return "model/gltf-binary";
  if (ext === "mp4") return "video/mp4";
  if (ext === "jpg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { attempts?: number; perAttemptTimeoutMs?: number; baseDelayMs?: number } = {}
): Promise<Response> {
  const attempts = opts.attempts ?? 4;
  const timeoutMs = opts.perAttemptTimeoutMs ?? 120_000;
  const baseDelayMs = opts.baseDelayMs ?? 1_000;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (i < attempts - 1) {
        const wait = baseDelayMs * Math.pow(2, i);
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`    network retry ${i + 1}/${attempts - 1} in ${wait}ms (${msg})`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

async function validateFile(localPath: string, kind: Kind): Promise<number> {
  const absPath = path.resolve(localPath);
  let stats;
  try {
    stats = await stat(absPath);
  } catch {
    throw new Error(`File not found: ${absPath}`);
  }
  const limit = SIZE_LIMITS[kind];
  if (stats.size > limit) {
    throw new Error(
      `"${absPath}" is ${(stats.size / 1024 / 1024).toFixed(2)}MB — ` +
      `exceeds the ${(limit / 1024 / 1024).toFixed(0)}MB limit for kind "${kind}"`
    );
  }
  return stats.size;
}

function normalizeTags(input: string[] | undefined): string[] {
  const normalized = Array.from(
    new Set(
      (input ?? [])
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0)
    )
  );
  if (normalized.length > 5) {
    throw new Error(`More than 5 tags after dedup: ${normalized.join(", ")}`);
  }
  for (const tag of normalized) {
    if (tag.length > 32 || !TAG_REGEX.test(tag)) {
      throw new Error(`Invalid tag "${tag}" — must be 1-32 chars, /^[a-z0-9][a-z0-9_-]*$/`);
    }
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Lazy imports so dotenv loads first
  const { db, dbPool } = await import("../src/db");
  const { users, worlds, worldMedia, tags, worldTags } = await import("../src/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const { getPresignedPutUrl, headObject, publicUrlFor, buildGlbKey, buildMediaKey } = await import(
    "../src/lib/r2"
  );

  // 1. Resolve owner
  const [owner] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.username, OWNER_USERNAME!))
    .limit(1);

  if (!owner) {
    console.error(`Error: no user found with username "${OWNER_USERNAME}". Double-check capitalisation.`);
    process.exit(1);
  }
  console.log(`Owner: @${owner.username} (id: ${owner.id})`);

  // 2. Load manifest
  const manifestPath = path.resolve("scripts/seed-worlds/manifest.json");
  const manifest: ManifestEntry[] = JSON.parse(await readFile(manifestPath, "utf-8"));
  console.log(`Loaded ${manifest.length} entries from manifest.\n`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < manifest.length; i++) {
    const entry = manifest[i];
    const label = `[${String(i + 1).padStart(2, " ")}/${manifest.length}] ${entry.title}`;
    console.log(`${label}`);

    try {
      // Idempotency
      const existing = await db
        .select({ id: worlds.id })
        .from(worlds)
        .where(eq(worlds.title, entry.title))
        .limit(1);
      if (existing.length > 0) {
        console.log("  -> already exists, skipping");
        skipped++;
        continue;
      }

      const worldId = randomUUID();
      const normalized = normalizeTags(entry.tags);

      // 3. Upload GLB
      const glbSize = await validateFile(entry.glbPath, "glb");
      const glbKey = buildGlbKey(owner.id, worldId);
      const glbUrl = await getPresignedPutUrl({
        bucket: "glb",
        objectKey: glbKey,
        contentType: "model/gltf-binary",
        contentLength: glbSize,
      });
      const glbBuffer = await readFile(path.resolve(entry.glbPath));
      const glbPutRes = await fetchWithRetry(glbUrl, {
        method: "PUT",
        headers: { "Content-Type": "model/gltf-binary", "Content-Length": String(glbSize) },
        body: glbBuffer,
      });
      if (!glbPutRes.ok) throw new Error(`R2 PUT (glb) failed: ${glbPutRes.status}`);
      console.log(`  GLB uploaded (${(glbSize / 1024 / 1024).toFixed(2)} MB)`);

      // 4. Upload thumbnail
      const thumbSize = await validateFile(entry.thumbnailPath, "thumbnail");
      const thumbExt = inferExt(entry.thumbnailPath, "thumbnail");
      const thumbMediaId = randomUUID();
      const thumbKey = buildMediaKey(owner.id, worldId, thumbMediaId, thumbExt);
      const thumbCt = inferContentType(thumbExt);
      const thumbUrl = await getPresignedPutUrl({
        bucket: "media",
        objectKey: thumbKey,
        contentType: thumbCt,
        contentLength: thumbSize,
      });
      const thumbBuffer = await readFile(path.resolve(entry.thumbnailPath));
      const thumbPutRes = await fetchWithRetry(thumbUrl, {
        method: "PUT",
        headers: { "Content-Type": thumbCt, "Content-Length": String(thumbSize) },
        body: thumbBuffer,
      });
      if (!thumbPutRes.ok) throw new Error(`R2 PUT (thumbnail) failed: ${thumbPutRes.status}`);
      console.log(`  thumbnail uploaded (${(thumbSize / 1024).toFixed(0)} KB)`);

      // 5. HEAD-verify both objects landed
      const glbHead = await headObject({ bucket: "glb", objectKey: glbKey });
      if (!glbHead.exists) throw new Error(`HEAD verification failed for ${glbKey}`);
      const thumbHead = await headObject({ bucket: "media", objectKey: thumbKey });
      if (!thumbHead.exists) throw new Error(`HEAD verification failed for ${thumbKey}`);

      // 6. (Optional) video + extra images — none in current seed manifest, so skipped
      const mediaRows = [
        {
          worldId,
          type: "thumbnail" as const,
          url: publicUrlFor("media", thumbKey),
          sizeBytes: thumbSize,
          position: 0,
        },
      ];

      // 7. Atomic insert into worlds + world_media + tags + world_tags
      await dbPool.transaction(async (tx) => {
        await tx.insert(worlds).values({
          id: worldId,
          userId: owner.id,
          title: entry.title,
          description: entry.description ?? null,
          glbUrl: publicUrlFor("glb", glbKey),
          glbSizeBytes: glbSize,
        });
        await tx.insert(worldMedia).values(mediaRows);

        if (normalized.length > 0) {
          await tx
            .insert(tags)
            .values(normalized.map((name) => ({ name })))
            .onConflictDoNothing();
          const tagRows = await tx
            .select({ id: tags.id, name: tags.name })
            .from(tags)
            .where(inArray(tags.name, normalized));
          await tx
            .insert(worldTags)
            .values(tagRows.map((t) => ({ worldId, tagId: t.id })));
        }
      });

      console.log(`  ✓ world row created (id: ${worldId})`);
      uploaded++;
    } catch (err) {
      failed++;
      console.error(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\n--- Done ---`);
  console.log(`  Uploaded : ${uploaded}`);
  console.log(`  Skipped  : ${skipped}`);
  console.log(`  Failed   : ${failed}`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
