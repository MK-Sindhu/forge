/**
 * scripts/seed-worlds.ts
 *
 * Bulk-upload seed worlds to FORGE from a local manifest.
 * Reads scripts/seed-worlds/manifest.json, uploads each world's GLB +
 * media directly to R2 via presigned PUT URLs, then records the world
 * row via POST /api/worlds.
 *
 * Usage:
 *   npx tsx scripts/seed-worlds.ts
 *   SEED_API_BASE=https://forge-black-eta.vercel.app npx tsx scripts/seed-worlds.ts
 *
 * Required env vars (via .env.local or the shell):
 *   CLERK_SESSION_TOKEN — the __session JWT copied from browser DevTools.
 *                         See scripts/seed-worlds/README.md for how to get it.
 *   SEED_API_BASE       — optional; defaults to http://localhost:3000
 *
 * See scripts/seed-worlds/README.md for full setup instructions.
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { readFile, stat } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// fetch with retry — wraps Node fetch with exponential backoff on network
// errors. Transient DNS / TCP / TLS failures on flaky connections (the
// reason `fetch failed` was killing whole uploads) get up to 3 attempts.
// Per-attempt timeout via AbortController prevents indefinite hangs.
// ---------------------------------------------------------------------------

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { attempts?: number; perAttemptTimeoutMs?: number; baseDelayMs?: number } = {}
): Promise<Response> {
  const attempts = opts.attempts ?? 4;
  const timeoutMs = opts.perAttemptTimeoutMs ?? 60_000;
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
      const msg = err instanceof Error ? err.message : String(err);
      if (i < attempts - 1) {
        const wait = baseDelayMs * Math.pow(2, i);
        console.log(`    network retry ${i + 1}/${attempts - 1} in ${wait}ms (${msg})`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = process.env.SEED_API_BASE ?? "http://localhost:3000";
const SESSION = process.env.CLERK_SESSION_TOKEN;

if (!SESSION) {
  console.error(
    "Error: CLERK_SESSION_TOKEN is not set.\n" +
    "Set it to the __session JWT from browser DevTools.\n" +
    "See scripts/seed-worlds/README.md for instructions."
  );
  process.exit(1);
}

// Sanity check: __session is a JWT, so it must start with eyJ
if (!SESSION.startsWith("eyJ")) {
  console.error(
    `Error: CLERK_SESSION_TOKEN doesn't look like a JWT.\n` +
    `  Got: "${SESSION.slice(0, 20)}..."\n` +
    `  Expected something starting with "eyJ".\n` +
    `  You probably copied the wrong cookie. Look for the row named "__session"\n` +
    `  in DevTools → Application → Cookies → https://forge-black-eta.vercel.app.`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Size limits — must match KIND_RULES in /api/uploads/sign/route.ts
// ---------------------------------------------------------------------------

const SIZE_LIMITS: Record<string, number> = {
  glb:       50 * 1024 * 1024, // 50 MB
  thumbnail:  2 * 1024 * 1024, //  2 MB
  image:      5 * 1024 * 1024, //  5 MB
  video:     15 * 1024 * 1024, // 15 MB
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Kind = "glb" | "thumbnail" | "image" | "video";

type ManifestEntry = {
  glbPath: string;
  title: string;
  description?: string;
  tags?: string[];
  thumbnailPath: string;   // required — POST /api/worlds enforces exactly one thumbnail
  videoPath?: string;
  imagePaths?: string[];
};

type UploadResult = {
  objectKey: string;
  sizeBytes: number;
};

type WorldOutcome = "uploaded" | "skipped";

// ---------------------------------------------------------------------------
// Content-type inference
// ---------------------------------------------------------------------------

function inferContentType(localPath: string, kind: Kind): string {
  const ext = path.extname(localPath).toLowerCase();
  if (kind === "glb") {
    if (ext === ".gltf") return "model/gltf+json";
    return "model/gltf-binary";
  }
  if (kind === "video") return "video/mp4";
  // image / thumbnail
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png"; // default for .png and any unrecognised image ext
}

// ---------------------------------------------------------------------------
// Manifest loader
// ---------------------------------------------------------------------------

async function loadManifest(): Promise<ManifestEntry[]> {
  const manifestPath = path.resolve("scripts/seed-worlds/manifest.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch {
    console.error(`Error: manifest not found at ${manifestPath}`);
    console.error("Create scripts/seed-worlds/manifest.json — see scripts/seed-worlds/README.md.");
    process.exit(1);
  }
  return JSON.parse(raw) as ManifestEntry[];
}

// ---------------------------------------------------------------------------
// File validation (size cap, existence)
// ---------------------------------------------------------------------------

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
      `"${absPath}" is ${(stats.size / 1024 / 1024).toFixed(2)} MB — ` +
      `exceeds the ${(limit / 1024 / 1024).toFixed(0)} MB limit for kind "${kind}"`
    );
  }
  return stats.size;
}

// ---------------------------------------------------------------------------
// Idempotency check — query the DB directly (same pattern as smoke.ts).
// Dynamic imports run after dotenv.config() so DATABASE_URL is already set.
// ---------------------------------------------------------------------------

async function alreadyExists(title: string): Promise<boolean> {
  const { db } = await import("../src/db");
  const { worlds } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const rows = await db
    .select({ id: worlds.id })
    .from(worlds)
    .where(eq(worlds.title, title))
    .limit(1);

  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Core upload helper: sign → R2 PUT → return objectKey + sizeBytes
// ---------------------------------------------------------------------------

async function uploadFile(
  localPath: string,
  kind: Kind,
  worldId: string,
  mediaId?: string
): Promise<UploadResult> {
  const absPath = path.resolve(localPath);
  const sizeBytes = await validateFile(localPath, kind);
  const contentType = inferContentType(localPath, kind);

  // Build the sign request body.
  // image and video require a mediaId per the /api/uploads/sign schema.
  const signBody: Record<string, unknown> = {
    kind,
    worldId,
    contentType,
    sizeBytes,
  };
  if (kind === "image" || kind === "video") {
    signBody.mediaId = mediaId ?? randomUUID();
  }

  // 1. Request a presigned PUT URL from the API
  const signRes = await fetchWithRetry(`${API_BASE}/api/uploads/sign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Auth: send as a Cookie (matches what the browser sends).
      // Clerk's __session JWT validates as a cookie but not reliably as a
      // bearer in Next.js v7 — different audience claim. Cookie form works.
      Cookie: `__session=${SESSION}`,
    },
    body: JSON.stringify(signBody),
  });

  if (!signRes.ok) {
    const text = await signRes.text().catch(() => "");
    throw new Error(
      `Sign failed for "${absPath}" (${kind}): HTTP ${signRes.status} — ${text}`
    );
  }

  const { uploadUrl, objectKey } = (await signRes.json()) as {
    uploadUrl: string;
    objectKey: string;
  };

  // 2. Read the file and PUT directly to R2 (bytes never touch our server).
  //    R2 uploads can be large + slow on flaky connections — give them a
  //    generous per-attempt timeout (2 min) and 4 attempts.
  const fileBuffer = await readFile(absPath);
  const putRes = await fetchWithRetry(
    uploadUrl,
    {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(sizeBytes),
      },
      body: fileBuffer,
    },
    { perAttemptTimeoutMs: 120_000 }
  );

  if (!putRes.ok) {
    const text = await putRes.text().catch(() => "(no body)");
    throw new Error(
      `R2 PUT failed for "${absPath}": HTTP ${putRes.status} — ${text}`
    );
  }

  return { objectKey, sizeBytes };
}

// ---------------------------------------------------------------------------
// Upload a single world entry from the manifest
// ---------------------------------------------------------------------------

async function uploadWorld(
  entry: ManifestEntry,
  index: number,
  total: number
): Promise<WorldOutcome> {
  console.log(`\n[${index + 1}/${total}] uploading "${entry.title}"...`);

  // Idempotency check
  if (await alreadyExists(entry.title)) {
    console.log("  -> already exists, skipping");
    return "skipped";
  }

  // A single worldId is generated here and threaded through both /api/uploads/sign
  // (for R2 key construction) and /api/worlds (for the DB row + key ownership check).
  const worldId = randomUUID();

  // 1. Upload GLB
  const glbResult = await uploadFile(entry.glbPath, "glb", worldId);
  console.log(
    `  GLB signed (${(glbResult.sizeBytes / 1024 / 1024).toFixed(2)} MB) -> R2...`
  );

  // 2. Upload thumbnail (required — POST /api/worlds rejects if missing)
  const thumbnailResult = await uploadFile(entry.thumbnailPath, "thumbnail", worldId);
  console.log(
    `  thumbnail signed (${(thumbnailResult.sizeBytes / 1024).toFixed(0)} KB) -> R2...`
  );

  // 3. Optional video
  let videoResult: UploadResult | null = null;
  if (entry.videoPath) {
    videoResult = await uploadFile(entry.videoPath, "video", worldId, randomUUID());
    console.log(
      `  video signed (${(videoResult.sizeBytes / 1024 / 1024).toFixed(2)} MB) -> R2...`
    );
  }

  // 4. Optional extra images (POST /api/worlds accepts up to 4 in addition to thumbnail)
  const imageResults: UploadResult[] = [];
  if (entry.imagePaths && entry.imagePaths.length > 0) {
    for (const imgPath of entry.imagePaths) {
      const r = await uploadFile(imgPath, "image", worldId, randomUUID());
      imageResults.push(r);
      console.log(`  image signed (${(r.sizeBytes / 1024).toFixed(0)} KB) -> R2...`);
    }
  }

  // 5. Build the media array for POST /api/worlds.
  //    Thumbnail goes first (position=0), matching the upload form convention.
  const media = [
    {
      key: thumbnailResult.objectKey,
      kind: "thumbnail" as const,
      sizeBytes: thumbnailResult.sizeBytes,
    },
    ...(videoResult
      ? [{ key: videoResult.objectKey, kind: "video" as const, sizeBytes: videoResult.sizeBytes }]
      : []),
    ...imageResults.map((r) => ({
      key: r.objectKey,
      kind: "image" as const,
      sizeBytes: r.sizeBytes,
    })),
  ];

  // 6. Record the world in the DB
  const worldPayload = {
    worldId,
    title: entry.title,
    description: entry.description ?? "",
    glbKey: glbResult.objectKey,
    glbSizeBytes: glbResult.sizeBytes,
    tosAccepted: true,
    media,
    tags: entry.tags ?? [],
  };

  const worldRes = await fetchWithRetry(`${API_BASE}/api/worlds`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Auth: send as a Cookie (matches what the browser sends).
      // Clerk's __session JWT validates as a cookie but not reliably as a
      // bearer in Next.js v7 — different audience claim. Cookie form works.
      Cookie: `__session=${SESSION}`,
    },
    body: JSON.stringify(worldPayload),
  });

  if (!worldRes.ok) {
    const text = await worldRes.text().catch(() => "(no body)");
    throw new Error(
      `POST /api/worlds failed: HTTP ${worldRes.status} — ${text}`
    );
  }

  const { worldId: createdId } = (await worldRes.json()) as { worldId: string };
  console.log(`  world row created (id: ${createdId}). [ok]`);
  return "uploaded";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const manifest = await loadManifest();
  console.log(
    `Loaded ${manifest.length} entr${manifest.length === 1 ? "y" : "ies"} from manifest.`
  );
  console.log(`API base: ${API_BASE}`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < manifest.length; i++) {
    try {
      const outcome = await uploadWorld(manifest[i], i, manifest.length);
      if (outcome === "skipped") skipped++;
      else uploaded++;
    } catch (err) {
      failed++;
      console.error(
        `  [FAIL] "${manifest[i].title}": ` +
        `${err instanceof Error ? err.message : String(err)}`
      );
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
