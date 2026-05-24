/**
 * POST /api/notifications/mark-read — mark notifications as read.
 *
 * Body (one of):
 *   { ids: string[] }   — mark specific notifications as read (by UUID)
 *   { all: true }       — mark all unread notifications as read
 *
 * The WHERE clause always includes user_id = $1 — users can only mark
 * their own notifications as read.
 *
 * Auth: requireActiveDbUser
 *
 * Response: { updated: number }
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { requireActiveDbUser } from "@/lib/users";

const BodySchema = z
  .object({
    ids: z.array(z.string().uuid()).optional(),
    all: z.boolean().optional(),
  })
  .refine((data) => data.ids !== undefined || data.all === true, {
    message: "Provide either 'ids' (array of UUIDs) or 'all: true'",
  });

export async function POST(request: Request) {
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

  // 2. Parse + validate body
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

  const { ids, all } = bodyParsed.data;

  // 3. Perform update — always scope to user's own notifications
  try {
    let updated: number;

    if (all === true) {
      // Mark all unread notifications for this user
      const result = await db
        .update(notifications)
        .set({ readAt: sql`now()` })
        .where(
          and(
            eq(notifications.userId, dbUser.id),
            isNull(notifications.readAt)
          )
        )
        .returning({ id: notifications.id });
      updated = result.length;
    } else {
      // Mark specific notifications — still scoped to this user
      const result = await db
        .update(notifications)
        .set({ readAt: sql`now()` })
        .where(
          and(
            eq(notifications.userId, dbUser.id),
            isNull(notifications.readAt),
            inArray(notifications.id, ids!)
          )
        )
        .returning({ id: notifications.id });
      updated = result.length;
    }

    return NextResponse.json({ updated });
  } catch (err) {
    console.error("[POST /api/notifications/mark-read] update error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}
