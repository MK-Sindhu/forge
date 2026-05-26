/**
 * DELETE /api/worlds/[id]/collaborators/[userId]
 *
 * Remove a collaborator from a world.
 *
 * Allowed callers:
 *   - The world owner (can remove anyone)
 *   - The collaborator themselves (self-removal)
 *
 * Path params: id (world uuid), userId (target collaborator uuid)
 *
 * Response (200): { removed: true, worldId, userId }
 *
 * Errors: 400, 401, 403, 404, 503.
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { worlds, worldCollaborators } from "@/db/schema";
import { requireActiveDbUser } from "@/lib/users";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// DELETE handler
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const { id, userId: targetUserId } = await params;

  // 1. Auth prelude
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
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

  const userIdParsed = UuidSchema.safeParse(targetUserId);
  if (!userIdParsed.success) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }
  const collaboratorUserId = userIdParsed.data;

  // 3. Fetch world to determine ownership
  let world: typeof worlds.$inferSelect | undefined;
  try {
    [world] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1);
  } catch (err) {
    console.error("[DELETE /collaborators/[userId]] world lookup error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  if (!world) {
    return NextResponse.json({ error: "World not found" }, { status: 404 });
  }

  // 4. Authorization: owner may remove anyone; collaborator may remove themselves only
  const isOwner = dbUser.id === world.userId;
  const isSelf = dbUser.id === collaboratorUserId;

  if (!isOwner && !isSelf) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 5. Delete the collaborator row
  let deleted: (typeof worldCollaborators.$inferSelect)[];
  try {
    deleted = await db
      .delete(worldCollaborators)
      .where(
        and(
          eq(worldCollaborators.worldId, worldId),
          eq(worldCollaborators.userId, collaboratorUserId)
        )
      )
      .returning();
  } catch (err) {
    console.error("[DELETE /collaborators/[userId]] delete error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  if (deleted.length === 0) {
    return NextResponse.json(
      { error: "User is not a collaborator on this world" },
      { status: 404 }
    );
  }

  return NextResponse.json({ removed: true, worldId, userId: collaboratorUserId });
}
