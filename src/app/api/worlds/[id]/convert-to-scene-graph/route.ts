/**
 * POST /api/worlds/[id]/convert-to-scene-graph
 *
 * Converts a legacy GLB-only world into a scene-graph world. The existing
 * glb_url is wrapped in a single-object scene graph — the world renders
 * identically, but is now editable via the Phase 2 scene-graph API.
 *
 * Pre-conditions:
 *   - World exists (404 via requireWorldRole)
 *   - Caller is owner (403 via requireWorldRole)
 *   - world.sceneGraph IS NULL (legacy) — 409 if already converted
 *   - world.glbUrl IS NOT NULL — 400 if missing (defensive; should never occur)
 *
 * On success (inside a single transaction):
 *   1. Insert a world_assets row reusing the existing glb_url (no upload/copy)
 *   2. Build a 1-object SceneGraphV1 document wrapping that asset
 *   3. Validate via SceneGraphV1.parse() — 503 on schema mismatch (would be a
 *      bug in this route, not a user error)
 *   4. Insert a world_versions row: status=published, versionNumber=1
 *   5. Update worlds: set scene_graph + published_version_id
 *
 * Response 200:
 *   { worldId, sceneGraph, versionId, versionNumber, assetId }
 *
 * Errors:
 *   400 — invalid id, or world has no glbUrl
 *   401 — not authenticated
 *   403 — not owner
 *   404 — world not found
 *   409 — world is already a scene graph
 *   503 — SceneGraphV1.parse() schema mismatch or DB error
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { dbPool } from "@/db";
import { worlds, worldAssets, worldVersions } from "@/db/schema";
import { requireActiveDbUser } from "@/lib/users";
import { requireWorldRole } from "@/lib/world-permissions";
import { SceneGraphV1 } from "@/lib/scene-graph/schema";

// ---------------------------------------------------------------------------
// Param validation
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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

  // 2. Validate path param
  const idParsed = UuidSchema.safeParse(id);
  if (!idParsed.success) {
    return NextResponse.json({ error: "Invalid world id" }, { status: 400 });
  }
  const worldId = idParsed.data;

  // 3. World ownership gate (also checks world existence → 404)
  const roleResult = await requireWorldRole(worldId, dbUser, "owner");
  if (roleResult instanceof NextResponse) return roleResult;
  const { world } = roleResult;

  // 4. Pre-condition: must be a legacy world (no scene graph yet)
  if (world.sceneGraph !== null && world.sceneGraph !== undefined) {
    return NextResponse.json(
      { error: "world is already a scene graph", sceneGraph: world.sceneGraph },
      { status: 409 }
    );
  }

  // 5. Pre-condition: must have a glbUrl (defensive — all existing worlds have one)
  if (!world.glbUrl) {
    return NextResponse.json(
      { error: "world has no .glb to convert" },
      { status: 400 }
    );
  }

  // ---------------------------------------------------------------------------
  // 6. Transaction: insert asset + version + update world
  // ---------------------------------------------------------------------------

  let resultAssetId: string;
  let resultVersionId: string;
  let resultVersionNumber: number;
  let resultSceneGraph: SceneGraphV1;

  try {
    const txResult = await dbPool.transaction(async (tx) => {
      // 6a. Re-fetch world inside the transaction (guard against concurrent
      //     conversion attempts — lock contention is fine for this rare action)
      const [freshWorld] = await tx
        .select()
        .from(worlds)
        .where(eq(worlds.id, worldId))
        .limit(1);

      if (!freshWorld) {
        throw Object.assign(new Error("world not found inside txn"), {
          _forgeCode: "NOT_FOUND",
        });
      }

      // Re-check pre-conditions inside txn
      if (freshWorld.sceneGraph !== null && freshWorld.sceneGraph !== undefined) {
        throw Object.assign(new Error("already converted"), {
          _forgeCode: "ALREADY_CONVERTED",
          sceneGraph: freshWorld.sceneGraph,
        });
      }

      if (!freshWorld.glbUrl) {
        throw Object.assign(new Error("no glbUrl"), {
          _forgeCode: "NO_GLB",
        });
      }

      // 6b. Insert world_assets row — reuse the existing R2 object (no upload)
      const [insertedAsset] = await tx
        .insert(worldAssets)
        .values({
          worldId,
          uploaderId: dbUser.id,
          name: freshWorld.title || "Base asset",
          glbUrl: freshWorld.glbUrl,
          glbSizeBytes: freshWorld.glbSizeBytes,
          kind: "glb",
        })
        .returning({ id: worldAssets.id });

      const assetId = insertedAsset.id;

      // 6c. Build the initial scene graph — 1 object wrapping the existing GLB
      const rawSceneGraph = {
        schemaVersion: 1 as const,
        objects: [
          {
            id: "obj_base",
            assetId,
            name: "Base",
            position: [0, 0, 0] as [number, number, number],
            rotation: [0, 0, 0] as [number, number, number],
            scale: [1, 1, 1] as [number, number, number],
          },
        ],
        lights: [
          { type: "ambient" as const, intensity: 0.5, color: "#ffffff" },
          {
            type: "sun" as const,
            intensity: 1,
            direction: [5, 5, 5] as [number, number, number],
            color: "#ffffff",
          },
        ],
        environment: { skybox: "studio" as const, fog: null },
        spawnPoints: [
          {
            id: "default",
            position: [0, 1.6, 5] as [number, number, number],
            rotation: [0, 0, 0] as [number, number, number],
          },
        ],
        camera: {
          position: [3, 3, 5] as [number, number, number],
          target: [0, 0, 0] as [number, number, number],
          fov: 50,
        },
      };

      // Sanity-check: ensure the shape we built satisfies the Zod schema.
      // If this throws, it is a bug in this route — we return 503 below.
      const sceneGraph = SceneGraphV1.parse(rawSceneGraph);

      // 6d. Insert world_versions row — status=published from the start so
      //     the world renders immediately and visitors see the new graph.
      const [insertedVersion] = await tx
        .insert(worldVersions)
        .values({
          worldId,
          status: "published",
          versionNumber: 1,
          parentVersionId: null,
          authorId: dbUser.id,
          sceneGraph,
          label: "Converted from legacy .glb",
        })
        .returning({
          id: worldVersions.id,
          versionNumber: worldVersions.versionNumber,
        });

      const versionId = insertedVersion.id;

      // 6e. Update world: set scene_graph + published_version_id.
      //     glbUrl is intentionally kept — safety net + reference even though
      //     the legacy renderer is no longer invoked once sceneGraph is non-null.
      await tx
        .update(worlds)
        .set({
          sceneGraph,
          publishedVersionId: versionId,
        })
        .where(eq(worlds.id, worldId));

      return { assetId, versionId, versionNumber: insertedVersion.versionNumber, sceneGraph };
    });

    resultAssetId = txResult.assetId;
    resultVersionId = txResult.versionId;
    resultVersionNumber = txResult.versionNumber;
    resultSceneGraph = txResult.sceneGraph;
  } catch (err) {
    // 409 — concurrent conversion already happened
    if (
      err instanceof Error &&
      (err as Error & { _forgeCode?: string; sceneGraph?: unknown })._forgeCode === "ALREADY_CONVERTED"
    ) {
      const sceneGraph = (err as Error & { sceneGraph?: unknown }).sceneGraph;
      return NextResponse.json(
        { error: "world is already a scene graph", sceneGraph },
        { status: 409 }
      );
    }

    // 404 — world vanished between the pre-check and the txn (very unlikely)
    if (
      err instanceof Error &&
      (err as Error & { _forgeCode?: string })._forgeCode === "NOT_FOUND"
    ) {
      return NextResponse.json({ error: "World not found" }, { status: 404 });
    }

    // 400 — glbUrl missing inside txn
    if (
      err instanceof Error &&
      (err as Error & { _forgeCode?: string })._forgeCode === "NO_GLB"
    ) {
      return NextResponse.json(
        { error: "world has no .glb to convert" },
        { status: 400 }
      );
    }

    // 503 — Zod parse failure (schema mismatch = bug in this route) or DB error
    console.error(
      "[POST /api/worlds/[id]/convert-to-scene-graph] error:",
      err
    );
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  return NextResponse.json({
    worldId,
    sceneGraph: resultSceneGraph,
    versionId: resultVersionId,
    versionNumber: resultVersionNumber,
    assetId: resultAssetId,
  });
}
