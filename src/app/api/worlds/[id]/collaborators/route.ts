/**
 * GET /api/worlds/[id]/collaborators — public
 *
 * Returns the world owner plus all collaborator rows (capped at 50).
 *
 * Response:
 *   {
 *     owner: { id, username, avatarUrl },
 *     collaborators: [
 *       { id, username, avatarUrl, role, addedAt, addedBy: { id, username } | null }
 *     ]
 *   }
 *
 * Errors: 400 (invalid id), 404 (world not found), 503.
 *
 * ---------------------------------------------------------------------------
 *
 * POST /api/worlds/[id]/collaborators — owner-only
 *
 * Invite a user (by username) as an editor collaborator.
 *
 * Body: { username: string (1..80) }
 *
 * Response (201):
 *   { id, username, avatarUrl, role, addedAt, addedBy: { id, username } }
 *
 * Errors: 400, 401, 403, 404, 409, 503.
 * 409 cases:
 *   - "owner cannot be a collaborator"
 *   - "already a collaborator" (body includes the existing row)
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, and, asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { dbPool } from "@/db";
import { worlds, users, worldCollaborators } from "@/db/schema";
import { requireActiveDbUser } from "@/lib/users";
import { requireWorldRole } from "@/lib/world-permissions";
import { notify } from "@/lib/notifications";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

const PostBodySchema = z.object({
  username: z.string().min(1).max(80),
});

// ---------------------------------------------------------------------------
// GET handler — public
// ---------------------------------------------------------------------------

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 1. Validate path param
  const idParsed = UuidSchema.safeParse(id);
  if (!idParsed.success) {
    return NextResponse.json({ error: "Invalid world id" }, { status: 400 });
  }
  const worldId = idParsed.data;

  // 2. Look up world with owner user
  let worldRow:
    | (typeof worlds.$inferSelect & {
        user: { id: string; username: string; avatarUrl: string | null } | null;
      })
    | undefined;

  try {
    worldRow = await db.query.worlds.findFirst({
      where: eq(worlds.id, worldId),
      with: {
        user: {
          columns: { id: true, username: true, avatarUrl: true },
        },
      },
    });
  } catch (err) {
    console.error("[GET /collaborators] world lookup error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  if (!worldRow) {
    return NextResponse.json({ error: "World not found" }, { status: 404 });
  }

  // 3. Fetch collaborators ordered by addedAt asc, capped at 50
  type CollabRow = {
    worldId: string;
    userId: string;
    role: string;
    addedAt: Date;
    addedById: string | null;
    user: { id: string; username: string; avatarUrl: string | null } | null;
    addedBy: { id: string; username: string } | null;
  };

  let collabs: CollabRow[];
  try {
    collabs = await db.query.worldCollaborators.findMany({
      where: eq(worldCollaborators.worldId, worldId),
      with: {
        user: {
          columns: { id: true, username: true, avatarUrl: true },
        },
        addedBy: {
          columns: { id: true, username: true },
        },
      },
      orderBy: [asc(worldCollaborators.addedAt)],
      limit: 50,
    });
  } catch (err) {
    console.error("[GET /collaborators] collaborators query error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  return NextResponse.json({
    owner: {
      id: worldRow.user?.id ?? "",
      username: worldRow.user?.username ?? "",
      avatarUrl: worldRow.user?.avatarUrl ?? null,
    },
    collaborators: collabs.map((c) => ({
      id: c.user?.id ?? c.userId,
      username: c.user?.username ?? "",
      avatarUrl: c.user?.avatarUrl ?? null,
      role: c.role,
      addedAt: c.addedAt.toISOString(),
      addedBy: c.addedBy
        ? { id: c.addedBy.id, username: c.addedBy.username }
        : null,
    })),
  });
}

// ---------------------------------------------------------------------------
// POST handler — owner-only
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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

  // 2. Validate path param
  const idParsed = UuidSchema.safeParse(id);
  if (!idParsed.success) {
    return NextResponse.json({ error: "Invalid world id" }, { status: 400 });
  }
  const worldId = idParsed.data;

  // 3. Owner-only gate (also confirms world exists → 404 if missing)
  const roleResult = await requireWorldRole(worldId, dbUser, "owner");
  if (roleResult instanceof NextResponse) return roleResult;
  const { world } = roleResult;

  // 4. Parse + validate body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bodyParsed = PostBodySchema.safeParse(rawBody);
  if (!bodyParsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: bodyParsed.error.issues },
      { status: 400 }
    );
  }

  const { username } = bodyParsed.data;

  // 5. Transaction: look up target user, check constraints, insert
  type InsertedCollab = {
    userId: string;
    username: string;
    avatarUrl: string | null;
    role: string;
    addedAt: Date;
  };

  let inserted: InsertedCollab;

  try {
    inserted = await dbPool.transaction(async (tx) => {
      // 5a. Look up target user by username
      const [targetUser] = await tx
        .select({
          id: users.id,
          username: users.username,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

      if (!targetUser) {
        throw Object.assign(new Error("user not found"), {
          _forgeCode: "USER_NOT_FOUND",
        });
      }

      // 5b. Owner cannot be a collaborator
      if (targetUser.id === world.userId) {
        throw Object.assign(new Error("owner cannot be a collaborator"), {
          _forgeCode: "OWNER_CONFLICT",
        });
      }

      // 5c. Check if already a collaborator
      const [existing] = await tx
        .select()
        .from(worldCollaborators)
        .where(
          and(
            eq(worldCollaborators.worldId, worldId),
            eq(worldCollaborators.userId, targetUser.id)
          )
        )
        .limit(1);

      if (existing) {
        throw Object.assign(
          new Error("already a collaborator"),
          {
            _forgeCode: "ALREADY_COLLABORATOR",
            existing: {
              id: targetUser.id,
              username: targetUser.username,
              role: existing.role,
              addedAt: existing.addedAt.toISOString(),
            },
          }
        );
      }

      // 5d. Insert the collaborator row
      const [row] = await tx
        .insert(worldCollaborators)
        .values({
          worldId,
          userId: targetUser.id,
          role: "editor",
          addedById: dbUser.id,
        })
        .returning();

      return {
        userId: targetUser.id,
        username: targetUser.username,
        avatarUrl: targetUser.avatarUrl,
        role: row.role,
        addedAt: row.addedAt,
      };
    });
  } catch (err) {
    // 404 — target user not found
    if (
      err instanceof Error &&
      (err as Error & { _forgeCode?: string })._forgeCode === "USER_NOT_FOUND"
    ) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // 409 — owner conflict
    if (
      err instanceof Error &&
      (err as Error & { _forgeCode?: string })._forgeCode === "OWNER_CONFLICT"
    ) {
      return NextResponse.json(
        { error: "owner cannot be a collaborator" },
        { status: 409 }
      );
    }

    // 409 — already a collaborator (includes existing row in response)
    if (
      err instanceof Error &&
      (err as Error & { _forgeCode?: string })._forgeCode ===
        "ALREADY_COLLABORATOR"
    ) {
      const e = err as Error & {
        _forgeCode?: string;
        existing?: { id: string; username: string; role: string; addedAt: string };
      };
      return NextResponse.json(
        { error: "already a collaborator", existing: e.existing },
        { status: 409 }
      );
    }

    console.error("[POST /collaborators] transaction error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  // 6. Best-effort notification (post-commit)
  try {
    await notify({
      userId: inserted.userId,
      type: "collaborator_added",
      actorId: dbUser.id,
      worldId,
    });
  } catch (err) {
    console.error("[POST /collaborators] notify failed:", err);
  }

  // 7. Respond 201 with the newly created collaborator
  return NextResponse.json(
    {
      id: inserted.userId,
      username: inserted.username,
      avatarUrl: inserted.avatarUrl,
      role: inserted.role,
      addedAt: inserted.addedAt.toISOString(),
      addedBy: { id: dbUser.id, username: dbUser.username },
    },
    { status: 201 }
  );
}
