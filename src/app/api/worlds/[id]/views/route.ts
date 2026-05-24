/**
 * POST /api/worlds/[id]/views — record a world view (per-user-per-day dedup)
 *
 * Only authenticated, active (non-suspended) users increment the view counter.
 * Anonymous views are intentionally ignored (locked decision, PROJECT.md §7).
 *
 * Idempotency: the composite PK (viewer_id, world_id, day) plus
 * onConflictDoNothing() means repeated calls on the same day are silently
 * dropped — the counter doesn't increment.
 *
 * Counter write: worlds.views is recounted from source (COUNT(*) FROM
 * world_views WHERE world_id = $1) inside the same transaction — matches the
 * recount-from-source pattern used by likes.
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { db, dbPool } from "@/db";
import { worldViews, worlds } from "@/db/schema";
import { requireActiveDbUser } from "@/lib/users";

const ParamsSchema = z.object({ id: z.string().uuid() });

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const parsed = ParamsSchema.safeParse({ id: rawId });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid world id" }, { status: 400 });
  }
  const worldId = parsed.data.id;

  // Auth — require a signed-in, active user
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

  // Confirm the world exists — avoid an FK violation inside the transaction
  const [worldRow] = await db
    .select({ id: worlds.id })
    .from(worlds)
    .where(eq(worlds.id, worldId))
    .limit(1);
  if (!worldRow) {
    return NextResponse.json({ error: "World not found" }, { status: 404 });
  }

  // Transaction: idempotent view insert + recount-from-source
  try {
    await dbPool.transaction(async (tx) => {
      await tx
        .insert(worldViews)
        .values({
          viewerId: dbUser.id,
          worldId,
          day: new Date().toISOString().slice(0, 10), // UTC YYYY-MM-DD
        })
        .onConflictDoNothing();

      const [row] = await tx
        .select({ count: count() })
        .from(worldViews)
        .where(eq(worldViews.worldId, worldId));

      await tx
        .update(worlds)
        .set({ views: Number(row.count) })
        .where(eq(worlds.id, worldId));
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[POST /api/worlds/[id]/views] transaction error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}
