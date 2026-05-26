/**
 * POST /api/worlds/[id]/versions/[v]/publish
 *
 * Publish a specific version of a world. Sets:
 *   - world_versions.status → "published" for the target version
 *   - worlds.published_version_id → the target version id
 *
 * Idempotent: calling this on an already-published version is a no-op.
 *
 * Note: worlds.scene_graph is NOT updated here. That column tracks the
 * latest draft if one exists (or the latest published snapshot). The ops
 * route writes worlds.scene_graph on every autosave; publish is a separate
 * concern (marking a version as the canonical public snapshot).
 *
 * Auth: world owner only.
 * Path params: id (world uuid), v (version uuid).
 *
 * Errors:
 *   400 — invalid path params
 *   401 — not signed in
 *   403 — not world owner
 *   404 — world not found, or version id does not belong to this world
 *   503 — DB error
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { dbPool } from "@/db";
import { worlds, worldVersions } from "@/db/schema";
import { requireActiveDbUser } from "@/lib/users";
import { requireWorldRole } from "@/lib/world-permissions";

// ---------------------------------------------------------------------------
// Param validation
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; v: string }> }
) {
  const { id, v } = await params;

  // 1. Auth prelude
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userResult = await requireActiveDbUser(clerkUser);
  if (userResult instanceof NextResponse) return userResult;
  const dbUser = userResult;

  // 2. Validate path params
  const idParsed = UuidSchema.safeParse(id);
  if (!idParsed.success) {
    return NextResponse.json({ error: "Invalid world id" }, { status: 400 });
  }
  const worldId = idParsed.data;

  const vParsed = UuidSchema.safeParse(v);
  if (!vParsed.success) {
    return NextResponse.json({ error: "Invalid version id" }, { status: 400 });
  }
  const versionId = vParsed.data;

  // 3. World ownership gate
  const roleResult = await requireWorldRole(worldId, dbUser, "owner");
  if (roleResult instanceof NextResponse) return roleResult;

  // 4. Transaction: confirm version belongs to this world, then publish
  let publishedVersionNumber: number;

  try {
    const result = await dbPool.transaction(async (tx) => {
      // 4a. Load the version and verify it belongs to this world
      const version = await tx.query.worldVersions.findFirst({
        where: and(
          eq(worldVersions.id, versionId),
          eq(worldVersions.worldId, worldId)
        ),
        columns: { id: true, versionNumber: true, status: true },
      });

      if (!version) {
        throw Object.assign(new Error("version not found"), {
          _forgeCode: "NOT_FOUND",
        });
      }

      // 4b. Mark the version as published (idempotent)
      await tx
        .update(worldVersions)
        .set({ status: "published" })
        .where(eq(worldVersions.id, versionId));

      // 4c. Point worlds.published_version_id at this version
      await tx
        .update(worlds)
        .set({ publishedVersionId: versionId })
        .where(eq(worlds.id, worldId));

      return { versionNumber: version.versionNumber };
    });

    publishedVersionNumber = result.versionNumber;
  } catch (err) {
    if (
      err instanceof Error &&
      (err as Error & { _forgeCode?: string })._forgeCode === "NOT_FOUND"
    ) {
      return NextResponse.json(
        { error: "Version not found" },
        { status: 404 }
      );
    }

    console.error("[POST /api/worlds/[id]/versions/[v]/publish] error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  return NextResponse.json({
    versionId,
    versionNumber: publishedVersionNumber,
    status: "published",
  });
}
