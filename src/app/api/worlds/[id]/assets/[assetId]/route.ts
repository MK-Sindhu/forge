/**
 * DELETE /api/worlds/[id]/assets/[assetId]
 *
 * Strict-integrity delete of a world asset:
 *   1. Confirms the asset exists and belongs to the specified world.
 *   2. Checks every world_versions row for the world to see if its
 *      scene_graph JSON references the assetId. If any version uses it,
 *      returns 409 rather than deleting (protects version history).
 *   3. Deletes the world_assets row.
 *   4. Best-effort R2 cleanup post-commit: derives the object key from the
 *      stored glb_url (format: <R2_PUBLIC_URL_GLB>/<objectKey>) and calls
 *      deleteObject(). Errors are logged but never surfaced to the client
 *      (the DB row is already gone; an orphaned R2 object is tolerable in v1).
 *
 * Auth: world owner only.
 * Path params: id (world uuid), assetId (asset uuid).
 *
 * Errors:
 *   400 — invalid path params
 *   401 — not signed in
 *   403 — not world owner or editor
 *   404 — world not found, or asset not found on this world
 *   409 — asset is referenced in one or more world_versions rows
 *   503 — DB error
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { dbPool } from "@/db";
import { worldAssets, worldVersions } from "@/db/schema";
import { requireActiveDbUser } from "@/lib/users";
import { requireWorldRole } from "@/lib/world-permissions";
import { deleteObject } from "@/lib/r2";

// ---------------------------------------------------------------------------
// Param validation
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// DELETE handler
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  const { id, assetId } = await params;

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

  const assetIdParsed = UuidSchema.safeParse(assetId);
  if (!assetIdParsed.success) {
    return NextResponse.json({ error: "Invalid asset id" }, { status: 400 });
  }
  const assetIdClean = assetIdParsed.data;

  // 3. World role gate — owner or editor (collaborators can delete assets)
  const roleResult = await requireWorldRole(worldId, dbUser, "editor");
  if (roleResult instanceof NextResponse) return roleResult;

  // 4. Capture glbUrl before transaction — we need it for post-commit R2 cleanup.
  //    We derive the objectKey from glbUrl (format: <publicBase>/<objectKey>)
  //    so we never need a separate uploader-clerkId lookup.
  let capturedGlbUrl: string | null = null;

  // 5. Transaction: load asset, referential integrity check, then delete
  type ConflictInfo = { versionId: string; versionNumber: number };
  type TxResult = { conflict: ConflictInfo } | { deleted: true; glbUrl: string };

  let txResult: TxResult;

  try {
    txResult = await dbPool.transaction(async (tx) => {
      // 5a. Load the asset row — confirm it exists on this world
      const assetRows = await tx
        .select({
          id: worldAssets.id,
          glbUrl: worldAssets.glbUrl,
        })
        .from(worldAssets)
        .where(
          and(
            eq(worldAssets.id, assetIdClean),
            eq(worldAssets.worldId, worldId)
          )
        )
        .limit(1);

      if (assetRows.length === 0) {
        throw Object.assign(new Error("asset not found"), {
          _forgeCode: "NOT_FOUND",
        });
      }

      const asset = assetRows[0];

      // 5b. Strict referential integrity check: find any world_versions row
      //     whose scene_graph JSON text contains a reference to this assetId.
      //
      //     Pattern: "assetId":"<uuid>" — this is the serialized form of the
      //     SceneGraphV1 objects[].assetId field. Using LIKE with a cast to text
      //     is intentional: it avoids a full JSON parse and the GIN index on
      //     scene_graph is not needed here (this is a rare operation).
      //
      //     Note: sql`` template from drizzle-orm is used to inject the raw
      //     SQL condition; worldVersions.worldId and the assetId are bound as
      //     parameters to prevent injection.
      const conflictRows = await tx
        .select({
          id: worldVersions.id,
          versionNumber: worldVersions.versionNumber,
        })
        .from(worldVersions)
        .where(
          and(
            eq(worldVersions.worldId, worldId),
            sql`${worldVersions.sceneGraph}::text LIKE ${"%" + '"assetId":"' + assetIdClean + '"' + "%"}`
          )
        )
        .limit(1);

      if (conflictRows.length > 0) {
        // Return conflict info — do NOT throw (that would roll back the txn;
        // we haven't changed anything yet so a rollback is fine here too, but
        // returning cleanly from the callback avoids unnecessary noise).
        return {
          conflict: {
            versionId: conflictRows[0].id,
            versionNumber: conflictRows[0].versionNumber,
          },
        };
      }

      // 5c. Delete the asset row
      await tx
        .delete(worldAssets)
        .where(eq(worldAssets.id, assetIdClean));

      return { deleted: true as const, glbUrl: asset.glbUrl };
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err as Error & { _forgeCode?: string })._forgeCode === "NOT_FOUND"
    ) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    console.error("[DELETE /api/worlds/[id]/assets/[assetId]] error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  // 6. Handle conflict (outside txn — txn has already committed or rolled back)
  if ("conflict" in txResult) {
    return NextResponse.json(
      {
        error: "asset in use",
        referencedBy: {
          versionId: txResult.conflict.versionId,
          versionNumber: txResult.conflict.versionNumber,
        },
      },
      { status: 409 }
    );
  }

  // 7. Post-commit best-effort R2 cleanup.
  //    Derive the object key from the stored glbUrl.
  //    glbUrl format: <R2_PUBLIC_URL_GLB>/<objectKey>
  //    We extract the path portion after the public base URL by finding the
  //    "assets/" prefix — all world assets use "assets/{userId}/{assetId}/asset.glb".
  capturedGlbUrl = txResult.glbUrl;

  try {
    // Extract the object key from the stored glbUrl.
    // The key always starts with "assets/" — find that prefix and take everything after the last slash before it.
    const assetsIndex = capturedGlbUrl.indexOf("/assets/");
    if (assetsIndex !== -1) {
      const objectKey = capturedGlbUrl.slice(assetsIndex + 1); // strips the leading "/"
      await deleteObject({ bucket: "glb", objectKey });
    } else {
      console.warn(
        "[DELETE asset] Could not extract objectKey from glbUrl for R2 cleanup:",
        capturedGlbUrl
      );
    }
  } catch (err) {
    // Best-effort: log but never surface to client. The DB row is gone;
    // an orphaned R2 object is tolerable in v1.
    console.error("[DELETE asset] R2 cleanup failed (orphaned object):", err);
  }

  return NextResponse.json({ deleted: true, assetId: assetIdClean });
}
