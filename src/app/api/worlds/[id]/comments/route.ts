/**
 * POST /api/worlds/[id]/comments — create a comment on a world (auth required)
 * GET  /api/worlds/[id]/comments — paginated list of comments, newest first (public)
 *
 * Cursor-based pagination on GET: pass `cursor` (ISO 8601 of the last-seen
 * comment's createdAt) + optional `limit` (default 20, max 50).
 *
 * POST returns 201 with the created comment + author shape.
 * GET  returns { comments: [...], nextCursor: string | null }.
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, and, lt, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { worlds, comments } from "@/db/schema";
import { requireActiveDbUser } from "@/lib/users";
import { notify } from "@/lib/notifications";

// ---------------------------------------------------------------------------
// Shared validation
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Shared helper: validate world id param + confirm world exists
// Returns the world id string on success, or a NextResponse error.
// ---------------------------------------------------------------------------

async function getWorldOr404(
  rawId: string
): Promise<string | NextResponse> {
  const parsed = UuidSchema.safeParse(rawId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid world id" }, { status: 400 });
  }
  const id = parsed.data;

  const worldRows = await db
    .select({ id: worlds.id })
    .from(worlds)
    .where(eq(worlds.id, id))
    .limit(1);

  if (worldRows.length === 0) {
    return NextResponse.json({ error: "World not found" }, { status: 404 });
  }

  return id;
}

function isErrorResponse(v: string | NextResponse): v is NextResponse {
  return v instanceof NextResponse;
}

// ---------------------------------------------------------------------------
// POST — create comment (auth required)
// ---------------------------------------------------------------------------

const BodySchema = z.object({
  body: z.string().trim().min(1).max(1000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;

  // 1. Auth
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse + validate request body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bodyParsed = BodySchema.safeParse(rawBody);
  if (!bodyParsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: bodyParsed.error.issues },
      { status: 400 }
    );
  }

  // 3. Resolve DB user (creates row on first auth'd request)
  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userResult = await requireActiveDbUser(clerkUser);
  if (userResult instanceof NextResponse) return userResult;
  const dbUser = userResult;

  // 4. Validate world id param + confirm world exists
  const worldIdOrError = await getWorldOr404(rawId);
  if (isErrorResponse(worldIdOrError)) return worldIdOrError;
  const worldId = worldIdOrError;

  // 5. Insert comment and return 201
  try {
    const [created] = await db
      .insert(comments)
      .values({
        worldId,
        userId: dbUser.id,
        body: bodyParsed.data.body,
      })
      .returning();

    // Best-effort: notify world owner after the insert commits.
    try {
      const [worldRow] = await db
        .select({ ownerId: worlds.userId })
        .from(worlds)
        .where(eq(worlds.id, worldId))
        .limit(1);
      if (worldRow) {
        await notify({
          userId: worldRow.ownerId,
          type: "comment",
          actorId: dbUser.id,
          worldId,
          commentId: created.id,
        });
      }
    } catch (err) {
      console.error("[POST comments] notify call wrapper failed:", err);
    }

    return NextResponse.json(
      {
        id: created.id,
        body: created.body,
        createdAt: created.createdAt.toISOString(),
        user: {
          id: dbUser.id,
          username: dbUser.username,
          avatarUrl: dbUser.avatarUrl,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/worlds/[id]/comments] insert error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}

// ---------------------------------------------------------------------------
// GET — list comments, newest first, cursor-based pagination (public)
// ---------------------------------------------------------------------------

const QuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;

  // 1. Validate query params
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

  // 2. Validate world id param + confirm world exists
  const worldIdOrError = await getWorldOr404(rawId);
  if (isErrorResponse(worldIdOrError)) return worldIdOrError;
  const worldId = worldIdOrError;

  // 3. Build cursor condition and run query
  const cursorDate = cursor ? new Date(cursor) : null;

  const where =
    cursorDate !== null
      ? and(eq(comments.worldId, worldId), lt(comments.createdAt, cursorDate))
      : eq(comments.worldId, worldId);

  try {
    const rows = await db.query.comments.findMany({
      where,
      orderBy: [desc(comments.createdAt)],
      limit: pageLimit + 1, // fetch one extra to detect next page
      with: {
        user: { columns: { id: true, username: true, avatarUrl: true } },
      },
    });

    const hasMore = rows.length > pageLimit;
    const sliced = hasMore ? rows.slice(0, pageLimit) : rows;
    const nextCursor = hasMore
      ? sliced[sliced.length - 1].createdAt.toISOString()
      : null;

    return NextResponse.json({
      comments: sliced.map((r) => ({
        id: r.id,
        body: r.body,
        createdAt: r.createdAt.toISOString(),
        user: {
          id: r.user!.id,
          username: r.user!.username,
          avatarUrl: r.user!.avatarUrl ?? null,
        },
      })),
      nextCursor,
    });
  } catch (err) {
    console.error("[GET /api/worlds/[id]/comments] query error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}
