/**
 * GET /api/worlds/[id]/versions
 *
 * Public — no auth required. Paginated list of world_versions for a world,
 * newest first. Does NOT include the full sceneGraph JSONB — too large for a
 * list endpoint. Use GET /api/worlds/[id]/scene-graph or the individual
 * version endpoint (Chunk D2) to retrieve the full document.
 *
 * Query params:
 *   cursor?  — ISO 8601 createdAt of the last-seen version (for next-page)
 *   limit?   — 1..50, default 20
 *
 * Response:
 *   {
 *     versions: Array<{
 *       id, versionNumber, status, label, parentVersionId,
 *       createdAt,
 *       author: { id, username, avatarUrl }
 *     }>,
 *     nextCursor: string | null,
 *   }
 */

import { NextResponse } from "next/server";
import { eq, and, lt, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { worlds, worldVersions } from "@/db/schema";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

const QuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 1. Validate path param
  const idParsed = UuidSchema.safeParse(id);
  if (!idParsed.success) {
    return NextResponse.json({ error: "Invalid world id" }, { status: 400 });
  }
  const worldId = idParsed.data;

  // 2. Validate query params
  const url = new URL(request.url);
  const queryParsed = QuerySchema.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!queryParsed.success) {
    return NextResponse.json(
      { error: "Invalid query params", issues: queryParsed.error.issues },
      { status: 400 }
    );
  }
  const { cursor, limit: pageLimit } = queryParsed.data;

  // 3. Confirm world exists
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
    console.error("[GET /api/worlds/[id]/versions] world lookup error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  // 4. Cursor condition
  const cursorDate = cursor ? new Date(cursor) : null;
  const whereCondition =
    cursorDate !== null
      ? and(
          eq(worldVersions.worldId, worldId),
          lt(worldVersions.createdAt, cursorDate)
        )
      : eq(worldVersions.worldId, worldId);

  // 5. Query versions with author relation
  try {
    const rows = await db.query.worldVersions.findMany({
      where: whereCondition,
      orderBy: [desc(worldVersions.createdAt)],
      limit: pageLimit + 1, // fetch one extra to detect next page
      columns: {
        id: true,
        versionNumber: true,
        status: true,
        label: true,
        parentVersionId: true,
        createdAt: true,
        // Intentionally omit sceneGraph — too large for a list response
      },
      with: {
        author: {
          columns: { id: true, username: true, avatarUrl: true },
        },
      },
    });

    const hasMore = rows.length > pageLimit;
    const sliced = hasMore ? rows.slice(0, pageLimit) : rows;
    const nextCursor = hasMore
      ? sliced[sliced.length - 1].createdAt.toISOString()
      : null;

    return NextResponse.json({
      versions: sliced.map((r) => ({
        id: r.id,
        versionNumber: r.versionNumber,
        status: r.status as "draft" | "published",
        label: r.label ?? null,
        parentVersionId: r.parentVersionId ?? null,
        createdAt: r.createdAt.toISOString(),
        author: {
          id: r.author!.id,
          username: r.author!.username,
          avatarUrl: r.author!.avatarUrl ?? null,
        },
      })),
      nextCursor,
    });
  } catch (err) {
    console.error("[GET /api/worlds/[id]/versions] query error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}
