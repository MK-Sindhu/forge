/**
 * POST /api/uploads/sign
 *
 * Validates an upload request and returns a presigned PUT URL that the client
 * uses to upload a file directly to R2 (bypassing Vercel's serverless body
 * limit — bytes never touch our server).
 *
 * Flow:
 *   1. Client → POST /api/uploads/sign { kind, worldId, contentType, sizeBytes }
 *   2. Server validates → returns { uploadUrl, objectKey }
 *   3. Client → PUT <uploadUrl> with raw file body
 *   4. Client → POST /api/worlds with the objectKey + metadata (separate step)
 *
 * TODO: Add per-user rate limiting before public launch (PROJECT.md risk #4).
 *       A simple counter in Postgres or Upstash Redis is sufficient. Ticket this
 *       as a hardening task before Slice 1 goes live.
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getPresignedPutUrl, buildGlbKey, buildThumbnailKey, buildMediaKey, buildAssetKey } from "@/lib/r2";
import { requireActiveDbUser } from "@/lib/users";
import { db } from "@/db";
import { worlds } from "@/db/schema";

// ---------------------------------------------------------------------------
// Per-kind validation rules
// These are the source of truth for what content types and size caps are
// allowed for each upload kind. Mirrors the spec table in the task brief.
// ---------------------------------------------------------------------------

const KIND_RULES = {
  glb: {
    contentTypes: [
      "model/gltf-binary",
      "model/gltf+json",
      "application/octet-stream",
    ] as readonly string[],
    maxBytes: 50 * 1024 * 1024, // 52428800
  },
  thumbnail: {
    contentTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
    ] as readonly string[],
    maxBytes: 2 * 1024 * 1024, // 2097152
  },
  image: {
    contentTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
    ] as readonly string[],
    maxBytes: 5 * 1024 * 1024, // 5242880
  },
  video: {
    contentTypes: ["video/mp4"] as readonly string[],
    maxBytes: 15 * 1024 * 1024, // 15728640
  },
  // Phase 2 — world asset uploads (.glb files that compose into scene graphs)
  // Reuses the same content types + size cap as the top-level GLB upload.
  asset: {
    contentTypes: [
      "model/gltf-binary",
      "model/gltf+json",
      "application/octet-stream",
    ] as readonly string[],
    maxBytes: 50 * 1024 * 1024, // 52428800
  },
} as const;

// ---------------------------------------------------------------------------
// contentType → file extension lookup (strict — reject non-canonical spellings)
// ---------------------------------------------------------------------------

const IMAGE_CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function extForImageContentType(contentType: string): string {
  const ext = IMAGE_CONTENT_TYPE_TO_EXT[contentType];
  if (!ext) {
    // This path should be unreachable if per-kind content type validation has
    // already run, but guard defensively.
    throw new Error(`No extension mapping for content type "${contentType}"`);
  }
  return ext;
}

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const BodySchema = z.object({
  kind: z.enum(["glb", "thumbnail", "image", "video", "asset"]),
  // Client generates this with crypto.randomUUID() — must be UUID v4.
  // Required for all kinds. For "asset", this is the owning world's id (used
  // for ownership verification only — the R2 key uses assetId, not worldId).
  worldId: z.string().uuid(),
  contentType: z.string().min(1),
  // Must be a positive integer — rejects 0, floats, negatives.
  sizeBytes: z.number().int().positive(),
  // Required when kind is "image" or "video" — client generates a fresh UUID
  // per media item so multiple image/video uploads don't collide.
  mediaId: z.string().uuid().optional(),
  // Required when kind is "asset" — the UUID for the new world_asset row.
  // Client generates this with crypto.randomUUID() before calling this endpoint.
  assetId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  // --- Auth -------------------------------------------------------------------
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // --- Suspension check -------------------------------------------------------
  // Fetch the full Clerk user and resolve the DB row to enforce the suspension
  // guard. The Clerk userId (from auth()) is still used for R2 key construction
  // below — that reference is stable and unaffected by this lookup.
  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userResult = await requireActiveDbUser(clerkUser);
  if (userResult instanceof NextResponse) return userResult;

  // --- Parse + validate body --------------------------------------------------
  let parsed: z.infer<typeof BodySchema>;
  try {
    const body = await req.json();
    parsed = BodySchema.parse(body);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        details: err instanceof z.ZodError ? err.flatten() : undefined,
      },
      { status: 400 }
    );
  }

  const { kind, worldId, contentType, sizeBytes, mediaId, assetId } = parsed;

  // --- Require mediaId for image/video ----------------------------------------
  if ((kind === "image" || kind === "video") && !mediaId) {
    return NextResponse.json(
      { error: "mediaId is required for image and video uploads" },
      { status: 400 }
    );
  }

  // --- Require assetId for asset uploads + verify world ownership --------------
  if (kind === "asset") {
    if (!assetId) {
      return NextResponse.json(
        { error: "assetId is required for asset uploads" },
        { status: 400 }
      );
    }

    // Confirm worldId belongs to the current user — prevents uploading assets
    // to worlds owned by others.
    let worldRow: { userId: string } | undefined;
    try {
      const rows = await db
        .select({ userId: worlds.userId })
        .from(worlds)
        .where(eq(worlds.id, worldId))
        .limit(1);
      worldRow = rows[0];
    } catch (err) {
      console.error("[POST /api/uploads/sign] world ownership lookup error:", err);
      return NextResponse.json(
        { error: "Database temporarily unavailable, please try again" },
        { status: 503 }
      );
    }

    if (!worldRow) {
      return NextResponse.json({ error: "World not found" }, { status: 404 });
    }

    // userResult.id is the DB user id; userId (from auth()) is the Clerk id.
    // The worlds table stores DB user ids so we compare against userResult.id.
    if (worldRow.userId !== userResult.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // --- Per-kind content type check --------------------------------------------
  const rule = KIND_RULES[kind];
  if (!rule.contentTypes.includes(contentType)) {
    return NextResponse.json(
      {
        error: `Content type "${contentType}" is not allowed for kind "${kind}". Allowed: ${rule.contentTypes.join(", ")}`,
      },
      { status: 400 }
    );
  }

  // --- Per-kind size cap -------------------------------------------------------
  if (sizeBytes > rule.maxBytes) {
    return NextResponse.json(
      {
        error: `File size ${sizeBytes} bytes exceeds the ${rule.maxBytes} byte limit for kind "${kind}"`,
      },
      { status: 400 }
    );
  }

  // --- Build object key + resolve bucket --------------------------------------
  let objectKey: string;
  let bucket: "glb" | "media";

  if (kind === "glb") {
    objectKey = buildGlbKey(userId, worldId);
    bucket = "glb";
  } else if (kind === "thumbnail") {
    const ext = extForImageContentType(contentType);
    objectKey = buildThumbnailKey(userId, worldId, ext);
    bucket = "media";
  } else if (kind === "image") {
    const ext = extForImageContentType(contentType);
    // mediaId is guaranteed non-null here (checked above)
    objectKey = buildMediaKey(userId, worldId, mediaId!, ext);
    bucket = "media";
  } else if (kind === "asset") {
    // assetId is guaranteed non-null here (checked in the asset block above)
    // R2 key: assets/{clerkUserId}/{assetId}/asset.glb — lives in the glb bucket
    objectKey = buildAssetKey(userId, assetId!);
    bucket = "glb";
  } else {
    // video — only video/mp4 is allowed per KIND_RULES
    objectKey = buildMediaKey(userId, worldId, mediaId!, "mp4");
    bucket = "media";
  }

  // --- Issue presigned PUT URL (10-minute expiry) ------------------------------
  const uploadUrl = await getPresignedPutUrl({
    bucket,
    objectKey,
    contentType,
    contentLength: sizeBytes,
    expiresInSeconds: 600,
  });

  return NextResponse.json({ uploadUrl, objectKey });
}
