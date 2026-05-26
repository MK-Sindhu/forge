/**
 * GET /api/worlds/[id]/scene-graph
 *
 * Public — no auth required. Returns the latest scene graph for a world along
 * with version metadata. Callers use this to bootstrap the editor or renderer
 * without fetching the full world payload.
 *
 * Legacy worlds (no world_versions rows) return all version fields as null but
 * still return the world's publishedVersionId (always null for legacy worlds).
 *
 * Response shape:
 *   {
 *     sceneGraph:        SceneGraphV1 | null,
 *     versionId:         string | null,
 *     versionNumber:     number | null,
 *     status:            "draft" | "published" | null,
 *     publishedVersionId: string | null,
 *   }
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { worlds } from "@/db/schema";
import { parseSceneGraph, type SceneGraphV1 } from "@/lib/scene-graph/schema";

// ---------------------------------------------------------------------------
// Param validation
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Handler
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

  // 2. Look up world
  let world: { id: string; publishedVersionId: string | null } | undefined;
  try {
    const rows = await db
      .select({ id: worlds.id, publishedVersionId: worlds.publishedVersionId })
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1);
    world = rows[0];
  } catch (err) {
    console.error("[GET /api/worlds/[id]/scene-graph] world lookup error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  if (!world) {
    return NextResponse.json({ error: "World not found" }, { status: 404 });
  }

  // 3. Query the latest world_version for this world
  let latest:
    | {
        id: string;
        versionNumber: number;
        sceneGraph: unknown;
        status: string;
      }
    | undefined;
  try {
    latest = await db.query.worldVersions.findFirst({
      where: (wv, { eq: weq }) => weq(wv.worldId, worldId),
      orderBy: (wv, { desc }) => [desc(wv.versionNumber)],
      columns: {
        id: true,
        versionNumber: true,
        sceneGraph: true,
        status: true,
      },
    });
  } catch (err) {
    console.error(
      "[GET /api/worlds/[id]/scene-graph] versions lookup error:",
      err
    );
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  // 4. Legacy world — no versions yet
  if (!latest) {
    return NextResponse.json({
      sceneGraph: null,
      versionId: null,
      versionNumber: null,
      status: null,
      publishedVersionId: world.publishedVersionId ?? null,
    });
  }

  // 5. Parse scene graph defensively
  let sceneGraph: SceneGraphV1 | null = null;
  if (latest.sceneGraph != null) {
    try {
      sceneGraph = parseSceneGraph(latest.sceneGraph) as SceneGraphV1;
    } catch (err) {
      console.error(
        `[GET /api/worlds/${worldId}/scene-graph] invalid scene_graph in world_versions row ${latest.id}:`,
        err
      );
      sceneGraph = null;
    }
  }

  return NextResponse.json({
    sceneGraph,
    versionId: latest.id,
    versionNumber: latest.versionNumber,
    status: latest.status as "draft" | "published",
    publishedVersionId: world.publishedVersionId ?? null,
  });
}
