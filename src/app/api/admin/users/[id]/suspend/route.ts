/**
 * POST   /api/admin/users/[id]/suspend   — set users.suspended_at = now()
 * DELETE /api/admin/users/[id]/suspend   — clear users.suspended_at = null
 *
 * Both handlers are admin-only. The [id] param is the FORGE DB user UUID
 * (not the Clerk ID).
 *
 * Idempotency:
 *   POST   — re-suspending an already-suspended user refreshes suspended_at to now.
 *   DELETE — clearing an already-null field is a silent no-op.
 *
 * Self-action is blocked for both verbs: an admin cannot suspend or unsuspend
 * themselves (defense-in-depth; if already suspended the admin gate would block
 * them anyway, but the check is explicit here).
 *
 * Response codes:
 *   401  — no Clerk session / currentUser() null
 *   400  — invalid target user id (not a UUID) or self-action attempt
 *   403  — caller is not an admin (from requireAdmin)
 *   503  — DB unavailable (from requireAdmin or update query)
 *   404  — target user not found
 *   200  — { suspendedAt: ISO | null }
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin, type DbUser } from "@/lib/users";

// ---------------------------------------------------------------------------
// Param validation
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Shared prelude: auth + admin gate + target-existence check + self-check
// ---------------------------------------------------------------------------

type Prelude = {
  dbUser: DbUser;
  targetUserId: string;
};

type PreludeResult = Prelude | NextResponse;

function isError(result: PreludeResult): result is NextResponse {
  return result instanceof NextResponse;
}

async function resolvePrelude(rawId: string): Promise<PreludeResult> {
  // 1. Clerk session check
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Resolve Clerk user (defensive — auth() already confirmed session)
  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. Admin gate — returns DbUser on success, NextResponse (400/503/403) on failure
  const adminOrError = await requireAdmin(clerkUser);
  if (adminOrError instanceof NextResponse) return adminOrError;
  const dbUser = adminOrError;

  // 4. Validate target user id param
  const parsed = UuidSchema.safeParse(rawId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }
  const targetUserId = parsed.data;

  // 5. Confirm target user exists
  const targetRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  if (targetRows.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // 6. Self-action guard — block both suspend and unsuspend on self
  if (targetUserId === dbUser.id) {
    return NextResponse.json(
      { error: "Cannot suspend yourself" },
      { status: 400 }
    );
  }

  return { dbUser, targetUserId };
}

// ---------------------------------------------------------------------------
// POST — suspend (sets suspended_at = now())
// ---------------------------------------------------------------------------

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const prelude = await resolvePrelude(id);
  if (isError(prelude)) return prelude;

  const { targetUserId } = prelude;

  try {
    const now = new Date();
    await db
      .update(users)
      .set({ suspendedAt: now })
      .where(eq(users.id, targetUserId));

    return NextResponse.json({ suspendedAt: now.toISOString() });
  } catch (err) {
    console.error("[POST /api/admin/users/[id]/suspend] update error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — unsuspend (clears suspended_at = null)
// ---------------------------------------------------------------------------

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const prelude = await resolvePrelude(id);
  if (isError(prelude)) return prelude;

  const { targetUserId } = prelude;

  try {
    await db
      .update(users)
      .set({ suspendedAt: null })
      .where(eq(users.id, targetUserId));

    return NextResponse.json({ suspendedAt: null });
  } catch (err) {
    console.error("[DELETE /api/admin/users/[id]/suspend] update error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}
