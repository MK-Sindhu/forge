/**
 * GET /api/admin/reports — paginated list of reports (admin only)
 *
 * Query params:
 *   status?  — 'open' | 'resolved' | 'dismissed' (default: 'open')
 *   cursor?  — ISO 8601 of the last-seen report's createdAt (for keyset pagination)
 *   limit?   — 1–50, default 20
 *
 * Response:
 *   {
 *     reports: Array<{
 *       id, reason, body, status, createdAt, resolvedAt,
 *       world: { id, title, thumbnailUrl },
 *       reporter: { id, username, avatarUrl },
 *     }>,
 *     nextCursor: string | null,
 *   }
 *
 * Auth: requires Clerk session + users.is_admin === true (else 403).
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, and, lt, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { reports } from "@/db/schema";
import { requireAdmin, type DbUser } from "@/lib/users";

// ---------------------------------------------------------------------------
// Query param schema
// ---------------------------------------------------------------------------

const QuerySchema = z.object({
  status: z.enum(["open", "resolved", "dismissed"]).default("open"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  // 1. Auth — must have a Clerk session
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Resolve Clerk user (defensive — currentUser() should not return null if
  //    auth() returned a userId, but we guard anyway)
  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. Admin gate — returns DbUser on success, NextResponse on failure
  const adminOrError = await requireAdmin(clerkUser);
  if (adminOrError instanceof NextResponse) return adminOrError;
  // dbUser is available but not needed beyond the admin gate for this GET
  const _dbUser: DbUser = adminOrError;

  // 4. Parse + validate query params
  const url = new URL(request.url);
  const queryParsed = QuerySchema.safeParse({
    status: url.searchParams.get("status") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!queryParsed.success) {
    return NextResponse.json(
      { error: "Invalid query params", issues: queryParsed.error.issues },
      { status: 400 }
    );
  }

  const { status, cursor, limit: pageLimit } = queryParsed.data;

  // 5. Build cursor condition and run relational query
  const cursorDate = cursor ? new Date(cursor) : null;
  const where = cursorDate
    ? and(eq(reports.status, status), lt(reports.createdAt, cursorDate))
    : eq(reports.status, status);

  try {
    const rows = await db.query.reports.findMany({
      where,
      orderBy: [desc(reports.createdAt)],
      limit: pageLimit + 1, // fetch one extra to detect next page
      columns: {
        id: true,
        reason: true,
        body: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
      },
      with: {
        world: {
          columns: { id: true, title: true },
          with: {
            media: {
              where: (m, { eq: meq }) => meq(m.type, "thumbnail"),
              limit: 1,
              columns: { url: true },
            },
          },
        },
        reporter: {
          columns: { id: true, username: true, avatarUrl: true },
        },
      },
    });

    const hasMore = rows.length > pageLimit;
    const sliced = hasMore ? rows.slice(0, pageLimit) : rows;
    const nextCursor = hasMore
      ? sliced[sliced.length - 1].createdAt.toISOString()
      : null;

    return NextResponse.json({
      reports: sliced.map((r) => ({
        id: r.id,
        reason: r.reason,
        body: r.body ?? null,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
        world: {
          id: r.world!.id,
          title: r.world!.title,
          thumbnailUrl: r.world!.media[0]?.url ?? null,
        },
        reporter: {
          id: r.reporter!.id,
          username: r.reporter!.username,
          avatarUrl: r.reporter!.avatarUrl ?? null,
        },
      })),
      nextCursor,
    });
  } catch (err) {
    console.error("[GET /api/admin/reports] query error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}
