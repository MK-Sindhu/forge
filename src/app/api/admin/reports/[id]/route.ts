/**
 * PATCH /api/admin/reports/[id] — resolve or dismiss a report (admin only)
 *
 * Body: { status: 'resolved' | 'dismissed' }
 *
 * Recategorization (resolved → dismissed or vice versa) is allowed —
 * resolvedAt and resolvedById are always updated on every PATCH.
 *
 * Response codes:
 *   401 — no Clerk session / currentUser() null
 *   400 — invalid report id (not a UUID) or invalid body
 *   403 — caller is not an admin (from requireAdmin)
 *   503 — DB unavailable (from requireAdmin)
 *   404 — report not found
 *   200 — { id, status, resolvedAt: ISO, resolvedById }
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { reports } from "@/db/schema";
import { requireAdmin } from "@/lib/users";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

const BodySchema = z.object({
  status: z.enum(["resolved", "dismissed"]),
});

// ---------------------------------------------------------------------------
// PATCH handler
// ---------------------------------------------------------------------------

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;

  // 1. Auth — must have a Clerk session
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate report id param
  const parsedId = UuidSchema.safeParse(rawId);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid report id" }, { status: 400 });
  }
  const reportId = parsedId.data;

  // 3. Resolve Clerk user (defensive)
  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 4. Admin gate — returns DbUser on success, NextResponse on failure
  const adminOrError = await requireAdmin(clerkUser);
  if (adminOrError instanceof NextResponse) return adminOrError;
  const dbUser = adminOrError;

  // 5. Parse + validate request body
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

  // 6. Confirm report exists
  const existing = await db
    .select({ id: reports.id })
    .from(reports)
    .where(eq(reports.id, reportId))
    .limit(1);

  if (existing.length === 0) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // 7. Update status, resolvedAt, and resolvedById
  //    Always sets resolvedAt + resolvedById even on recategorization.
  try {
    const [updated] = await db
      .update(reports)
      .set({
        status: bodyParsed.data.status,
        resolvedAt: new Date(),
        resolvedById: dbUser.id,
      })
      .where(eq(reports.id, reportId))
      .returning();

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      resolvedAt: updated.resolvedAt!.toISOString(),
      resolvedById: updated.resolvedById,
    });
  } catch (err) {
    console.error("[PATCH /api/admin/reports/[id]] update error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}
