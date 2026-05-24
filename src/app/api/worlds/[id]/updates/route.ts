/**
 * POST /api/worlds/[id]/updates — create an update on a world (owner only)
 * GET  /api/worlds/[id]/updates — paginated list of updates, newest first (public)
 *
 * Cursor-based pagination on GET: pass `cursor` (ISO 8601 of the last-seen
 * update's createdAt) + optional `limit` (default 20, max 50).
 *
 * POST returns 201 with the created update shape (no user field — author is
 * implicitly the world owner, visible elsewhere on the page).
 * GET  returns { updates: [...], nextCursor: string | null }.
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, and, lt, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { worlds, worldUpdates } from "@/db/schema";
import { getOrCreateDbUser } from "@/lib/users";

// ---------------------------------------------------------------------------
// Shared validation
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Shared helper: validate world id param + confirm world exists.
// Returns { id, ownerId } on success, or a NextResponse error.
// POST uses ownerId to enforce the owner-only constraint without a second query.
// ---------------------------------------------------------------------------

async function getWorldOr404(
  rawId: string
): Promise<{ id: string; ownerId: string } | NextResponse> {
  const parsed = UuidSchema.safeParse(rawId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid world id" }, { status: 400 });
  }
  const id = parsed.data;

  const worldRows = await db
    .select({ id: worlds.id, ownerId: worlds.userId })
    .from(worlds)
    .where(eq(worlds.id, id))
    .limit(1);

  if (worldRows.length === 0) {
    return NextResponse.json({ error: "World not found" }, { status: 404 });
  }

  return { id: worldRows[0].id, ownerId: worldRows[0].ownerId };
}

function isErrorResponse(
  v: { id: string; ownerId: string } | NextResponse
): v is NextResponse {
  return v instanceof NextResponse;
}

// ---------------------------------------------------------------------------
// POST — create update (owner only)
// ---------------------------------------------------------------------------

const PostBodySchema = z.object({
  body: z.string().trim().min(1).max(2000),
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

  const bodyParsed = PostBodySchema.safeParse(rawBody);
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

  let dbUser: Awaited<ReturnType<typeof getOrCreateDbUser>>;
  try {
    dbUser = await getOrCreateDbUser(clerkUser);
  } catch (err) {
    if (err instanceof Error && err.message.includes("no email")) {
      return NextResponse.json(
        { error: "No email on Clerk user" },
        { status: 400 }
      );
    }
    console.error(
      "[POST /api/worlds/[id]/updates] getOrCreateDbUser error:",
      err
    );
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  // 4. Validate world id param + confirm world exists (returns ownerId too)
  const worldOrError = await getWorldOr404(rawId);
  if (isErrorResponse(worldOrError)) return worldOrError;
  const { id, ownerId } = worldOrError;

  // 5. Owner-only guard — 403, not 404 (world exists; requester just can't post to it)
  if (dbUser.id !== ownerId) {
    return NextResponse.json(
      { error: "Forbidden: only the world owner can post updates" },
      { status: 403 }
    );
  }

  // 6. Insert update and return 201
  try {
    const [created] = await db
      .insert(worldUpdates)
      .values({ worldId: id, body: bodyParsed.data.body })
      .returning();

    return NextResponse.json(
      {
        id: created.id,
        body: created.body,
        createdAt: created.createdAt.toISOString(),
        editedAt: null, // never edited at creation
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/worlds/[id]/updates] insert error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}

// ---------------------------------------------------------------------------
// GET — list updates, newest first, cursor-based pagination (public)
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
  const worldOrError = await getWorldOr404(rawId);
  if (isErrorResponse(worldOrError)) return worldOrError;
  const { id } = worldOrError;

  // 3. Build cursor condition and run query
  const cursorDate = cursor ? new Date(cursor) : null;

  const where =
    cursorDate !== null
      ? and(eq(worldUpdates.worldId, id), lt(worldUpdates.createdAt, cursorDate))
      : eq(worldUpdates.worldId, id);

  try {
    const rows = await db.query.worldUpdates.findMany({
      where,
      orderBy: [desc(worldUpdates.createdAt)],
      limit: pageLimit + 1, // fetch one extra to detect next page
      columns: { id: true, body: true, createdAt: true, editedAt: true },
    });

    const hasMore = rows.length > pageLimit;
    const sliced = hasMore ? rows.slice(0, pageLimit) : rows;
    const nextCursor = hasMore
      ? sliced[sliced.length - 1].createdAt.toISOString()
      : null;

    return NextResponse.json({
      updates: sliced.map((r) => ({
        id: r.id,
        body: r.body,
        createdAt: r.createdAt.toISOString(),
        editedAt: r.editedAt ? r.editedAt.toISOString() : null,
      })),
      nextCursor,
    });
  } catch (err) {
    console.error("[GET /api/worlds/[id]/updates] query error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}
