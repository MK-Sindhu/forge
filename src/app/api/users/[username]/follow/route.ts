/**
 * POST   /api/users/[username]/follow  — follow a user (idempotent)
 * DELETE /api/users/[username]/follow  — unfollow a user
 *
 * No counter denormalization here — follower count is computed on read (Task 7).
 * Single-row insert/delete: no transaction needed; uses HTTP db driver.
 *
 * TODO: Add per-user rate limiting before public launch (PROJECT.md risk #4).
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { users, follows } from "@/db/schema";
import { requireActiveDbUser } from "@/lib/users";

// ---------------------------------------------------------------------------
// Prelude types
// ---------------------------------------------------------------------------

interface Prelude {
  followerId: string;
  followeeId: string;
}

// ---------------------------------------------------------------------------
// Shared prelude: auth + follower resolution + followee lookup + self-follow check
//
// Error ordering:
//   1. username format check (400) — cheapest, no I/O
//   2. Clerk session check (401) — no DB hit
//   3. DB user bootstrap (503 on DB error, 400 on missing email)
//   4. Followee lookup (404 if username unknown)
//   5. Self-follow guard (400) — needs both IDs, so must come after both lookups
// ---------------------------------------------------------------------------

async function resolvePrelude(
  rawUsername: string
): Promise<Prelude | NextResponse> {
  // 1. Validate username param
  if (!rawUsername || rawUsername.length > 64) {
    return NextResponse.json({ error: "Invalid username" }, { status: 400 });
  }

  // 2. Require Clerk session
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. Resolve (or create) the DB row for the authenticated user (the follower)
  const userResult = await requireActiveDbUser(clerkUser);
  if (userResult instanceof NextResponse) return userResult;
  const followerRow = userResult;

  // 4. Look up the followee by username
  const [followee] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, rawUsername))
    .limit(1);

  if (!followee) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // 5. Reject self-follow before it reaches the DB CHECK constraint
  if (followee.id === followerRow.id) {
    return NextResponse.json(
      { error: "Cannot follow yourself" },
      { status: 400 }
    );
  }

  return { followerId: followerRow.id, followeeId: followee.id };
}

function isError(x: Prelude | NextResponse): x is NextResponse {
  return x instanceof NextResponse;
}

// ---------------------------------------------------------------------------
// POST — follow (idempotent via onConflictDoNothing)
// ---------------------------------------------------------------------------

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const p = await resolvePrelude(username);
  if (isError(p)) return p;

  await db
    .insert(follows)
    .values({ followerId: p.followerId, followeeId: p.followeeId })
    .onConflictDoNothing();

  return NextResponse.json({ following: true });
}

// ---------------------------------------------------------------------------
// DELETE — unfollow
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const p = await resolvePrelude(username);
  if (isError(p)) return p;

  await db
    .delete(follows)
    .where(
      and(
        eq(follows.followerId, p.followerId),
        eq(follows.followeeId, p.followeeId)
      )
    );

  return NextResponse.json({ following: false });
}
