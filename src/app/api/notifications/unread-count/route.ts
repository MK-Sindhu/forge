/**
 * GET /api/notifications/unread-count — cheap unread badge count for the
 * signed-in user.
 *
 * Uses the partial index notifications_user_id_unread_idx
 * (user_id WHERE read_at IS NULL) for efficient execution.
 *
 * Auth: requireActiveDbUser
 *
 * Response: { count: number }
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, isNull, count } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { requireActiveDbUser } from "@/lib/users";

export async function GET() {
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

  // 2. Count unread notifications — partial index makes this cheap
  try {
    const [row] = await db
      .select({ count: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, dbUser.id),
          isNull(notifications.readAt)
        )
      );

    return NextResponse.json({ count: Number(row.count) });
  } catch (err) {
    console.error("[GET /api/notifications/unread-count] query error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}
