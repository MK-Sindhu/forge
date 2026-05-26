/**
 * world-permissions.ts — owner/editor/viewer role gating for world-scoped
 * write endpoints. Phase 2 only "owner" exists (= worlds.user_id ===
 * dbUser.id). Phase 3 will extend the role-lookup block with a
 * world_collaborators query; route handlers don't change.
 *
 * Designed to mirror the requireActiveDbUser pattern in src/lib/users.ts:
 *  - Returns the resolved data on success
 *  - Returns NextResponse on auth/permission failure (caller checks instanceof)
 *
 * Usage in route handlers:
 *   const userResult = await requireActiveDbUser(clerkUser);
 *   if (userResult instanceof NextResponse) return userResult;
 *   const dbUser = userResult;
 *
 *   const roleResult = await requireWorldRole(worldId, dbUser, "owner");
 *   if (roleResult instanceof NextResponse) return roleResult;
 *   const { world, role } = roleResult;
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { worlds } from "@/db/schema";
import type { DbUser } from "@/lib/users";

export type WorldRole = "owner" | "editor" | "viewer";
export type WorldRow = typeof worlds.$inferSelect;
export type WorldWithRole = { world: WorldRow; role: WorldRole };

const ROLE_RANK: Record<WorldRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

/**
 * Check whether the user has at least `requiredRole` on the world.
 *
 * Phase 2 implementation: only the world's owner (worlds.user_id ===
 * dbUser.id) gets a role; everyone else is forbidden. Phase 3 will extend
 * the role-lookup block to query world_collaborators for the editor/viewer
 * cases. The return shape and caller pattern do not change.
 *
 * requiredRole is the MINIMUM acceptable role (owner >= editor >= viewer).
 *
 * Returns { world, role } on success; NextResponse 403/404/503 on failure.
 */
export async function requireWorldRole(
  worldId: string,
  dbUser: DbUser,
  requiredRole: WorldRole
): Promise<WorldWithRole | NextResponse> {
  let world: WorldRow | undefined;
  try {
    [world] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1);
  } catch (err) {
    console.error("[requireWorldRole] db error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable" },
      { status: 503 }
    );
  }

  if (!world) {
    return NextResponse.json({ error: "World not found" }, { status: 404 });
  }

  // Phase 2: only owner exists. Phase 3 will extend below with a
  // world_collaborators lookup for editor/viewer roles.
  const role: WorldRole | null = world.userId === dbUser.id ? "owner" : null;

  if (role === null) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (ROLE_RANK[role] < ROLE_RANK[requiredRole]) {
    return NextResponse.json({ error: "Insufficient role" }, { status: 403 });
  }

  return { world, role };
}
