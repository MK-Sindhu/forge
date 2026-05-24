/**
 * POST   /api/worlds/[id]/likes — like a world (idempotent, re-liking is a no-op)
 * DELETE /api/worlds/[id]/likes — unlike a world
 *
 * Both handlers are atomic: the like row and the denormalized likesCount on
 * the worlds table are updated inside a single dbPool.transaction() call.
 * The counter is recounted from source-of-truth (SELECT COUNT(*)) rather than
 * incremented/decremented to prevent drift from race conditions or past bugs.
 *
 * TODO: Add per-user rate limiting before public launch (PROJECT.md risk #4).
 *       A simple counter in Postgres or Upstash Redis is sufficient.
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, and, count } from "drizzle-orm";
import { z } from "zod";
import { db, dbPool } from "@/db";
import { worlds, likes } from "@/db/schema";
import { requireActiveDbUser, type DbUser } from "@/lib/users";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NeonQueryResultHKT } from "drizzle-orm/neon-serverless";

// ---------------------------------------------------------------------------
// Param validation
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Shared prelude: auth + DB user resolution + world existence check
// ---------------------------------------------------------------------------

type Prelude = {
  dbUser: DbUser;
  worldId: string;
};

type PreludeError = NextResponse;

async function resolvePrelude(
  rawId: string
): Promise<Prelude | PreludeError> {
  // 1. Auth
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate world id param
  const parsed = UuidSchema.safeParse(rawId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid world id" }, { status: 400 });
  }
  const worldId = parsed.data;

  // 3. Resolve DB user (creates row on first auth'd request)
  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userResult = await requireActiveDbUser(clerkUser);
  if (userResult instanceof NextResponse) return userResult;
  const dbUser: DbUser = userResult;

  // 4. Confirm world exists
  const worldRows = await db
    .select({ id: worlds.id })
    .from(worlds)
    .where(eq(worlds.id, worldId))
    .limit(1);

  if (worldRows.length === 0) {
    return NextResponse.json({ error: "World not found" }, { status: 404 });
  }

  return { dbUser, worldId };
}

function isError(result: Prelude | PreludeError): result is PreludeError {
  return result instanceof NextResponse;
}

// ---------------------------------------------------------------------------
// Helper: recount likes from source of truth and update worlds.likesCount
// ---------------------------------------------------------------------------

async function recountAndUpdate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: PgTransaction<NeonQueryResultHKT, any, any>,
  worldId: string
): Promise<number> {
  const [row] = await tx
    .select({ count: count() })
    .from(likes)
    .where(eq(likes.worldId, worldId));

  const newCount = Number(row.count);

  await tx
    .update(worlds)
    .set({ likesCount: newCount })
    .where(eq(worlds.id, worldId));

  return newCount;
}

// ---------------------------------------------------------------------------
// POST — like (idempotent via onConflictDoNothing)
// ---------------------------------------------------------------------------

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const prelude = await resolvePrelude(id);
  if (isError(prelude)) return prelude;

  const { dbUser, worldId } = prelude;

  try {
    const likesCount = await dbPool.transaction(async (tx) => {
      await tx
        .insert(likes)
        .values({ userId: dbUser.id, worldId })
        .onConflictDoNothing();

      return recountAndUpdate(tx, worldId);
    });

    return NextResponse.json({ liked: true, likesCount });
  } catch (err) {
    console.error("[POST /api/worlds/[id]/likes] transaction error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — unlike
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const prelude = await resolvePrelude(id);
  if (isError(prelude)) return prelude;

  const { dbUser, worldId } = prelude;

  try {
    const likesCount = await dbPool.transaction(async (tx) => {
      await tx
        .delete(likes)
        .where(and(eq(likes.userId, dbUser.id), eq(likes.worldId, worldId)));

      return recountAndUpdate(tx, worldId);
    });

    return NextResponse.json({ liked: false, likesCount });
  } catch (err) {
    console.error("[DELETE /api/worlds/[id]/likes] transaction error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}
