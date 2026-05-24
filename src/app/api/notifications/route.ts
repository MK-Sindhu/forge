/**
 * GET /api/notifications — cursor-paginated notification feed for the
 * signed-in user, newest first.
 *
 * Query params:
 *   cursor  — ISO 8601 createdAt of the last-seen notification (optional)
 *   limit   — page size, 1–50, default 20
 *
 * Auth: requireActiveDbUser (blocks suspended users from their feed)
 *
 * Response: { notifications: [...], nextCursor: string | null }
 *
 * Cursor shape mirrors GET /api/worlds/[id]/comments exactly:
 *   cursor = ISO 8601 createdAt string, lt(createdAt, cursorDate), limit + 1 detect.
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, and, lt, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { requireActiveDbUser } from "@/lib/users";

const QuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(request: Request) {
  // 1. Auth
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

  // 3. Build cursor condition and run query
  const cursorDate = cursor ? new Date(cursor) : null;

  const where =
    cursorDate !== null
      ? and(
          eq(notifications.userId, dbUser.id),
          lt(notifications.createdAt, cursorDate)
        )
      : eq(notifications.userId, dbUser.id);

  try {
    const rows = await db.query.notifications.findMany({
      where,
      orderBy: [desc(notifications.createdAt)],
      limit: pageLimit + 1, // fetch one extra to detect next page
      with: {
        actor: {
          columns: { id: true, username: true, avatarUrl: true },
        },
        world: {
          columns: { id: true, title: true },
        },
        comment: {
          columns: { id: true, body: true },
        },
      },
    });

    const hasMore = rows.length > pageLimit;
    const sliced = hasMore ? rows.slice(0, pageLimit) : rows;
    const nextCursor = hasMore
      ? sliced[sliced.length - 1].createdAt.toISOString()
      : null;

    return NextResponse.json({
      notifications: sliced.map((r) => ({
        id: r.id,
        type: r.type,
        createdAt: r.createdAt.toISOString(),
        readAt: r.readAt ? r.readAt.toISOString() : null,
        actor: r.actor
          ? {
              id: r.actor.id,
              username: r.actor.username,
              avatarUrl: r.actor.avatarUrl ?? null,
            }
          : null,
        world: r.world
          ? { id: r.world.id, title: r.world.title }
          : null,
        comment: r.comment
          ? { id: r.comment.id, body: r.comment.body }
          : null,
      })),
      nextCursor,
    });
  } catch (err) {
    console.error("[GET /api/notifications] query error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}
