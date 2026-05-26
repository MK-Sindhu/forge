/**
 * POST /api/worlds/[id]/scene-graph/ops
 *
 * Apply a batch of scene-graph operations on top of a known base version,
 * producing a new draft version. This is the canonical mutation surface for
 * the browser editor and all future editing clients.
 *
 * Flow:
 *   1. Client holds a `baseVersionId` from the last GET /scene-graph response.
 *   2. Client batches up to MAX_OPS_PER_BATCH ops and POSTs them here.
 *   3. Server loads the base version, checks for a more-recent version
 *      (optimistic concurrency), applies ops, inserts a new world_versions row,
 *      and updates worlds.scene_graph.
 *
 * Conflict handling (409):
 *   If another version exists on top of the base version, the server returns
 *   the full current version so the client can rebase locally and retry.
 *
 * Body: OpsBatchSchema — { ops, baseVersionId, label? }
 *
 * Errors:
 *   400 — invalid body, or OperationError (with opIndex)
 *   401 — not signed in
 *   403 — not world owner
 *   404 — world or baseVersionId not found
 *   409 — version conflict (body includes currentVersion for rebase)
 *   503 — DB error
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { dbPool } from "@/db";
import { worlds, worldVersions } from "@/db/schema";
import { requireActiveDbUser } from "@/lib/users";
import { requireWorldRole } from "@/lib/world-permissions";
import {
  OpsBatchSchema,
  applyOps,
  OperationError,
} from "@/lib/scene-graph/operations";
import { parseSceneGraph, type SceneGraphV1 } from "@/lib/scene-graph/schema";

// ---------------------------------------------------------------------------
// Param validation
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Sentinel class for 409 rollback-via-throw
// ---------------------------------------------------------------------------

class VersionConflict {
  constructor(
    readonly versionId: string,
    readonly versionNumber: number,
    readonly sceneGraph: SceneGraphV1 | null,
    readonly status: string
  ) {}
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
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

  // 3. World ownership gate
  const roleResult = await requireWorldRole(worldId, dbUser, "owner");
  if (roleResult instanceof NextResponse) return roleResult;

  // 4. Parse + validate body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bodyParsed = OpsBatchSchema.safeParse(rawBody);
  if (!bodyParsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: bodyParsed.error.issues },
      { status: 400 }
    );
  }

  const { ops, baseVersionId, label } = bodyParsed.data;

  // 5. Transaction: optimistic concurrency + apply ops + insert new version
  let newVersionId: string;
  let newVersionNumber: number;
  let newGraph: SceneGraphV1;

  try {
    const result = await dbPool.transaction(async (tx) => {
      // 5a. Load base version (must belong to this world)
      const base = await tx.query.worldVersions.findFirst({
        where: and(
          eq(worldVersions.id, baseVersionId),
          eq(worldVersions.worldId, worldId)
        ),
      });

      if (!base) {
        // Throw a plain error — we return 404 outside the txn
        throw Object.assign(new Error("base version not found"), {
          _forgeCode: "NOT_FOUND_BASE",
        });
      }

      // 5b. Load latest version for the world
      const latest = await tx.query.worldVersions.findFirst({
        where: eq(worldVersions.worldId, worldId),
        orderBy: [desc(worldVersions.versionNumber)],
      });

      // latest must exist (we just confirmed base exists)
      if (!latest) {
        throw Object.assign(new Error("no versions found"), {
          _forgeCode: "NOT_FOUND_BASE",
        });
      }

      // 5c. Optimistic concurrency: if another version was committed on top,
      //     throw a sentinel so we can roll back the txn and return 409.
      if (latest.id !== baseVersionId) {
        let currentSg: SceneGraphV1 | null = null;
        if (latest.sceneGraph != null) {
          try {
            currentSg = parseSceneGraph(latest.sceneGraph) as SceneGraphV1;
          } catch {
            // parse failure on the latest version — expose null, don't crash
          }
        }
        throw new VersionConflict(
          latest.id,
          latest.versionNumber,
          currentSg,
          latest.status
        );
      }

      // 5d. Apply ops to the base scene graph
      let baseGraph: SceneGraphV1;
      try {
        baseGraph = parseSceneGraph(base.sceneGraph) as SceneGraphV1;
      } catch {
        throw Object.assign(new Error("base version scene graph is corrupt"), {
          _forgeCode: "BAD_BASE_GRAPH",
        });
      }

      // applyOps throws OperationError if any op is invalid — we let it bubble
      const applied = applyOps(baseGraph, ops);

      // 5e. Insert new version row
      const [inserted] = await tx
        .insert(worldVersions)
        .values({
          worldId,
          status: "draft",
          versionNumber: latest.versionNumber + 1,
          parentVersionId: baseVersionId,
          authorId: dbUser.id,
          sceneGraph: applied,
          label: label ?? null,
        })
        .returning({
          id: worldVersions.id,
          versionNumber: worldVersions.versionNumber,
        });

      // 5f. Update worlds.scene_graph to the new graph
      await tx
        .update(worlds)
        .set({ sceneGraph: applied })
        .where(eq(worlds.id, worldId));

      return { inserted, applied };
    });

    newVersionId = result.inserted.id;
    newVersionNumber = result.inserted.versionNumber;
    newGraph = result.applied as SceneGraphV1;
  } catch (err) {
    // 409 — version conflict (sentinel thrown inside txn)
    if (err instanceof VersionConflict) {
      return NextResponse.json(
        {
          error: "version conflict",
          currentVersion: {
            versionId: err.versionId,
            versionNumber: err.versionNumber,
            sceneGraph: err.sceneGraph,
            status: err.status,
          },
        },
        { status: 409 }
      );
    }

    // 400 — bad op
    if (err instanceof OperationError) {
      return NextResponse.json(
        { error: err.message, opIndex: err.opIndex },
        { status: 400 }
      );
    }

    // 404 — base version not found
    if (
      err instanceof Error &&
      (err as Error & { _forgeCode?: string })._forgeCode === "NOT_FOUND_BASE"
    ) {
      return NextResponse.json(
        { error: "Base version not found" },
        { status: 404 }
      );
    }

    // 400 — base graph corrupt (should be rare in production)
    if (
      err instanceof Error &&
      (err as Error & { _forgeCode?: string })._forgeCode === "BAD_BASE_GRAPH"
    ) {
      return NextResponse.json(
        { error: "Base version scene graph is invalid" },
        { status: 400 }
      );
    }

    console.error("[POST /api/worlds/[id]/scene-graph/ops] error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  return NextResponse.json({
    versionId: newVersionId,
    versionNumber: newVersionNumber,
    sceneGraph: newGraph,
  });
}
