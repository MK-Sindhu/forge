/**
 * PATCH /api/updates/[id] — edit a world update (world owner only)
 * DELETE /api/updates/[id] — hard-delete a world update (world owner only)
 *
 * Response codes (both methods share the prelude):
 *   401 — no Clerk session
 *   400 — update id is not a valid UUID
 *   503 — getOrCreateDbUser threw (DB unavailable)
 *   400 — Clerk user has no email
 *   404 — update does not exist
 *   403 — caller is not the world owner
 *
 * PATCH additionally:
 *   400 — body fails validation
 *   200 — updated update row
 *
 * DELETE:
 *   204 — deleted (no body)
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { worldUpdates, worlds } from "@/db/schema";
import { requireActiveDbUser, type DbUser } from "@/lib/users";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

const PatchBodySchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

// ---------------------------------------------------------------------------
// Shared prelude
// Resolves auth + UUID validation + DB user + ownership check.
// Returns the resolved data or a NextResponse error to return immediately.
// ---------------------------------------------------------------------------

type PreludeOk = {
  updateId: string;
  dbUser: DbUser;
  worldOwnerId: string;
};

async function resolvePrelude(
  rawUpdateId: string
): Promise<PreludeOk | NextResponse> {
  // 1. Auth — must have a Clerk session
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate update id param
  const idParsed = UuidSchema.safeParse(rawUpdateId);
  if (!idParsed.success) {
    return NextResponse.json({ error: "Invalid update id" }, { status: 400 });
  }
  const updateId = idParsed.data;

  // 3. Resolve DB user (creates row on first auth'd request)
  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userResult = await requireActiveDbUser(clerkUser);
  if (userResult instanceof NextResponse) return userResult;
  const dbUser: DbUser = userResult;

  // 4. Look up update + world owner in a single join
  const [row] = await db
    .select({
      updateId: worldUpdates.id,
      worldOwnerId: worlds.userId,
    })
    .from(worldUpdates)
    .innerJoin(worlds, eq(worlds.id, worldUpdates.worldId))
    .where(eq(worldUpdates.id, updateId))
    .limit(1);

  // 5. 404 if update doesn't exist (join returns no rows)
  if (!row) {
    return NextResponse.json({ error: "Update not found" }, { status: 404 });
  }

  // 6. 403 if caller is not the world owner
  if (row.worldOwnerId !== dbUser.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { updateId, dbUser, worldOwnerId: row.worldOwnerId };
}

function isErrorResponse(v: PreludeOk | NextResponse): v is NextResponse {
  return v instanceof NextResponse;
}

// ---------------------------------------------------------------------------
// PATCH — edit update body (world owner only)
// ---------------------------------------------------------------------------

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;

  const prelude = await resolvePrelude(rawId);
  if (isErrorResponse(prelude)) return prelude;
  const { updateId } = prelude;

  // Parse + validate request body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bodyParsed = PatchBodySchema.safeParse(rawBody);
  if (!bodyParsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: bodyParsed.error.issues },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(worldUpdates)
    .set({ body: bodyParsed.data.body, editedAt: new Date() })
    .where(eq(worldUpdates.id, updateId))
    .returning();

  return NextResponse.json({
    id: updated.id,
    body: updated.body,
    createdAt: updated.createdAt.toISOString(),
    editedAt: updated.editedAt!.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// DELETE — hard-delete update (world owner only)
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;

  const prelude = await resolvePrelude(rawId);
  if (isErrorResponse(prelude)) return prelude;
  const { updateId } = prelude;

  await db.delete(worldUpdates).where(eq(worldUpdates.id, updateId));

  return new NextResponse(null, { status: 204 });
}
