/**
 * POST   /api/worlds/[id]/repost  — repost a world (idempotent, re-repost is a no-op)
 * DELETE /api/worlds/[id]/repost  — un-repost a world
 *
 * No counter denormalization: repost count is computed at read time (COUNT(*)).
 * Single-row insert/delete: no transaction needed; uses HTTP db driver.
 * Self-repost is allowed (Twitter/IG pattern — lets creators re-bump their own content).
 *
 * TODO: Add per-user rate limiting before public launch (PROJECT.md risk #4).
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { worlds, reposts } from "@/db/schema";
import { requireActiveDbUser, type DbUser } from "@/lib/users";

// ---------------------------------------------------------------------------
// Param validation
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Shared prelude: auth + UUID validation + DB user resolution + world existence
//
// Error ordering:
//   1. Clerk session check (401) — no DB hit
//   2. UUID format check (400) — cheapest I/O-free validation after auth
//   3. DB user bootstrap (503 on DB error, 400 on missing email)
//   4. World existence check (404)
// ---------------------------------------------------------------------------

type Prelude = {
  dbUser: DbUser;
  worldId: string;
};

type PreludeError = NextResponse;

async function resolvePrelude(rawId: string): Promise<Prelude | PreludeError> {
  // 1. Require Clerk session
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
// POST — repost (idempotent via onConflictDoNothing)
// ---------------------------------------------------------------------------

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const prelude = await resolvePrelude(id);
  if (isError(prelude)) return prelude;

  const { dbUser, worldId } = prelude;

  await db
    .insert(reposts)
    .values({ userId: dbUser.id, worldId })
    .onConflictDoNothing();

  return NextResponse.json({ reposted: true });
}

// ---------------------------------------------------------------------------
// DELETE — un-repost
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const prelude = await resolvePrelude(id);
  if (isError(prelude)) return prelude;

  const { dbUser, worldId } = prelude;

  await db
    .delete(reposts)
    .where(and(eq(reposts.userId, dbUser.id), eq(reposts.worldId, worldId)));

  return NextResponse.json({ reposted: false });
}
