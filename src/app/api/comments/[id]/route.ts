/**
 * DELETE /api/comments/[id] — hard-delete a comment.
 *
 * Authorized callers:
 *   - The comment's author (comments.userId === currentDbUser.id)
 *   - The world's owner  (worlds.userId  === currentDbUser.id)
 *
 * Response codes:
 *   401 — no Clerk session
 *   400 — comment id is not a valid UUID
 *   503 — getOrCreateDbUser threw (DB unavailable)
 *   404 — comment does not exist
 *   403 — caller is neither author nor world owner
 *   204 — deleted (no body)
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { comments, worlds } from "@/db/schema";
import { requireActiveDbUser } from "@/lib/users";

// ---------------------------------------------------------------------------
// Param validation
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// DELETE handler
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;

  // 1. Auth — must have a Clerk session
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate comment id param
  const parsed = UuidSchema.safeParse(rawId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid comment id" }, { status: 400 });
  }
  const commentId = parsed.data;

  // 3. Resolve DB user (creates row on first auth'd request)
  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userResult = await requireActiveDbUser(clerkUser);
  if (userResult instanceof NextResponse) return userResult;
  const currentDbUser = userResult;

  // 4. Fetch comment + world owner in one join
  //    SQL: SELECT comments.user_id, worlds.user_id
  //         FROM comments
  //         INNER JOIN worlds ON worlds.id = comments.world_id
  //         WHERE comments.id = $commentId
  //         LIMIT 1
  const [row] = await db
    .select({
      commentAuthorId: comments.userId,
      worldOwnerId: worlds.userId,
    })
    .from(comments)
    .innerJoin(worlds, eq(worlds.id, comments.worldId))
    .where(eq(comments.id, commentId))
    .limit(1);

  // 5. 404 if comment doesn't exist (join returns no rows)
  if (!row) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  // 6. Authorization — must be author OR world owner
  const isAuthor = row.commentAuthorId === currentDbUser.id;
  const isOwner = row.worldOwnerId === currentDbUser.id;

  if (!isAuthor && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 7. Hard delete — no audit log, no soft delete
  await db.delete(comments).where(eq(comments.id, commentId));

  return new NextResponse(null, { status: 204 });
}
