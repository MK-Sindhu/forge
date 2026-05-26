/**
 * GET /api/worlds/[id]/assets
 *
 * Public — no auth required. Returns all world_asset rows for a world,
 * ordered by createdAt DESC, capped at 100 (practical per-world asset ceiling
 * for Phase 2; configurable if needed).
 *
 * POST /api/worlds/[id]/assets
 *
 * Auth required — world owner only. Records a world_asset row after the client
 * has already uploaded the file directly to R2 via a presigned PUT URL
 * (from POST /api/uploads/sign with kind: "asset").
 *
 * Flow:
 *   1. Client calls POST /api/uploads/sign { kind:"asset", worldId, assetId, ... }
 *      → gets { uploadUrl, objectKey }
 *   2. Client PUT the file to R2 directly
 *   3. Client calls POST /api/worlds/[id]/assets { assetId, name, sizeBytes }
 *   4. Server HEADs R2 to confirm the upload succeeded, then inserts the row
 *
 * Body: { assetId: uuid, name: string(1..120), sizeBytes: positive int }
 *
 * Errors (POST):
 *   400 — invalid body / asset not uploaded / size mismatch
 *   401 — not signed in
 *   403 — not world owner or editor
 *   404 — world not found
 *   503 — DB error or unique-constraint collision (editor should generate fresh IDs)
 *
 * DELETE lives in assets/[assetId]/route.ts.
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { worlds, worldAssets } from "@/db/schema";
import { requireActiveDbUser } from "@/lib/users";
import { requireWorldRole } from "@/lib/world-permissions";
import { buildAssetKey, headObject, publicUrlFor } from "@/lib/r2";

// ---------------------------------------------------------------------------
// Param validation
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

// Body schema for POST
const PostBodySchema = z.object({
  assetId: z.string().uuid(),
  name: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive(),
});

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 1. Validate path param
  const parsed = UuidSchema.safeParse(id);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid world id" }, { status: 400 });
  }
  const worldId = parsed.data;

  // 2. Confirm world exists
  try {
    const rows = await db
      .select({ id: worlds.id })
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1);
    if (rows.length === 0) {
      return NextResponse.json({ error: "World not found" }, { status: 404 });
    }
  } catch (err) {
    console.error("[GET /api/worlds/[id]/assets] world lookup error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  // 3. Fetch assets
  try {
    const assets = await db.query.worldAssets.findMany({
      where: eq(worldAssets.worldId, worldId),
      orderBy: [desc(worldAssets.createdAt)],
      limit: 100,
      columns: {
        id: true,
        name: true,
        glbUrl: true,
        glbSizeBytes: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      assets: assets.map((a) => ({
        id: a.id,
        name: a.name,
        glbUrl: a.glbUrl,
        sizeBytes: a.glbSizeBytes,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[GET /api/worlds/[id]/assets] query error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST handler — record a world asset row after R2 upload
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 1. Auth prelude
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userResult = await requireActiveDbUser(clerkUser);
  if (userResult instanceof NextResponse) return userResult;
  const dbUser = userResult;

  // 2. Validate path param
  const idParsed = UuidSchema.safeParse(id);
  if (!idParsed.success) {
    return NextResponse.json({ error: "Invalid world id" }, { status: 400 });
  }
  const worldId = idParsed.data;

  // 3. World role gate — owner or editor (collaborators can upload assets)
  const roleResult = await requireWorldRole(worldId, dbUser, "editor");
  if (roleResult instanceof NextResponse) return roleResult;

  // 4. Parse + validate body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bodyParsed = PostBodySchema.safeParse(rawBody);
  if (!bodyParsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: bodyParsed.error.issues },
      { status: 400 }
    );
  }

  const { assetId, name, sizeBytes } = bodyParsed.data;

  // 5. HEAD R2 to confirm the asset was actually uploaded.
  //    clerkUserId (from auth()) is used for the key — matches how uploads/sign
  //    constructs the key (buildAssetKey(userId, assetId) where userId = clerkUserId).
  const objectKey = buildAssetKey(clerkUserId, assetId);

  let headResult: Awaited<ReturnType<typeof headObject>>;
  try {
    headResult = await headObject({ bucket: "glb", objectKey });
  } catch (err) {
    console.error("[POST /api/worlds/[id]/assets] R2 HEAD error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  if (!headResult.exists) {
    return NextResponse.json(
      { error: "asset not uploaded" },
      { status: 400 }
    );
  }

  if (headResult.contentLength !== sizeBytes) {
    return NextResponse.json(
      {
        error: "size mismatch",
        expected: sizeBytes,
        actual: headResult.contentLength,
      },
      { status: 400 }
    );
  }

  // 6. Insert the world_asset row
  const glbUrl = publicUrlFor("glb", objectKey);

  let created: { id: string; name: string; glbUrl: string; glbSizeBytes: number; createdAt: Date };
  try {
    const [row] = await db
      .insert(worldAssets)
      .values({
        id: assetId,
        worldId,
        uploaderId: dbUser.id,
        name,
        glbUrl,
        glbSizeBytes: sizeBytes,
        kind: "glb",
      })
      .returning({
        id: worldAssets.id,
        name: worldAssets.name,
        glbUrl: worldAssets.glbUrl,
        glbSizeBytes: worldAssets.glbSizeBytes,
        createdAt: worldAssets.createdAt,
      });
    created = row;
  } catch (err) {
    // Unique-constraint / PK collision — editor should generate fresh asset IDs.
    // No idempotency in v1; document in API ref.
    console.error("[POST /api/worlds/[id]/assets] insert error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  return NextResponse.json(
    {
      id: created.id,
      name: created.name,
      glbUrl: created.glbUrl,
      sizeBytes: created.glbSizeBytes,
      createdAt: created.createdAt.toISOString(),
    },
    { status: 201 }
  );
}
