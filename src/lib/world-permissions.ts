/**
 * world-permissions.ts — owner/editor/viewer role gating for world-scoped
 * write endpoints. Phase 2 only "owner" exists (= worlds.user_id ===
 * dbUser.id). Phase 3 extends the role-lookup block with a
 * world_collaborators query for the editor case.
 *
 * Two exported entry points:
 *
 * 1. `getWorldRoleForUser(worldId, dbUser)` — returns a discriminated union:
 *      { kind: "ok",        world, role }  — success
 *      { kind: "not-found"              }  — world does not exist
 *      { kind: "forbidden"              }  — user has no role on this world
 *      { kind: "db-error"               }  — DB unavailable
 *    Safe to call from server components (no NextResponse).
 *
 * 2. `requireWorldRole(worldId, dbUser, requiredRole)` — thin wrapper around
 *    getWorldRoleForUser that converts the error variants to NextResponse.
 *    Designed for route handlers. Returns WorldWithRole or NextResponse.
 *
 * Usage in route handlers:
 *   const roleResult = await requireWorldRole(worldId, dbUser, "owner");
 *   if (roleResult instanceof NextResponse) return roleResult;
 *   const { world, role } = roleResult;
 *
 * Usage in server-component pages:
 *   const roleResult = await getWorldRoleForUser(worldId, dbUser);
 *   if (roleResult.kind !== "ok") { ... render error UI }
 *   const { world, role } = roleResult;
 */

import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { worlds, worldCollaborators } from "@/db/schema";
import type { DbUser } from "@/lib/users";

export type WorldRole = "owner" | "editor" | "viewer";
export type WorldRow = typeof worlds.$inferSelect;
export type WorldWithRole = { world: WorldRow; role: WorldRole };

/** Discriminated result type for getWorldRoleForUser — no NextResponse. */
export type WorldRoleResult =
  | ({ kind: "ok" } & WorldWithRole)
  | { kind: "not-found" }
  | { kind: "forbidden" }
  | { kind: "db-error" };

const ROLE_RANK: Record<WorldRole, number> = {
  viewer: 0,
  editor: 1,
  owner: 2,
};

/**
 * Query world_collaborators for the given (worldId, userId) pair.
 * Returns the collaborator's role, or null if no row found.
 * Propagates DB errors — the outer requireWorldRole catch block handles 503.
 */
async function getCollaboratorRole(
  worldId: string,
  userId: string
): Promise<WorldRole | null> {
  try {
    const [row] = await db
      .select({ role: worldCollaborators.role })
      .from(worldCollaborators)
      .where(
        and(
          eq(worldCollaborators.worldId, worldId),
          eq(worldCollaborators.userId, userId)
        )
      )
      .limit(1);
    if (!row) return null;
    // Defensive: DB CHECK should already filter to 'editor', but coerce explicitly.
    return row.role === "editor" ? "editor" : null;
  } catch (err) {
    console.error("[world-permissions] getCollaboratorRole error:", err);
    throw err; // propagate to outer try/catch → 503
  }
}

/**
 * Resolve the user's effective role on a world, returning a discriminated
 * result. No NextResponse — safe to call from server components.
 *
 * Role lookup order:
 *  1. world.userId === dbUser.id → "owner"
 *  2. world_collaborators row for (worldId, dbUser.id) exists → "editor"
 *  3. Neither → { kind: "forbidden" }
 */
export async function getWorldRoleForUser(
  worldId: string,
  dbUser: DbUser
): Promise<WorldRoleResult> {
  let world: WorldRow | undefined;
  try {
    [world] = await db
      .select()
      .from(worlds)
      .where(eq(worlds.id, worldId))
      .limit(1);
  } catch (err) {
    console.error("[getWorldRoleForUser] db error on world lookup:", err);
    return { kind: "db-error" };
  }

  if (!world) {
    return { kind: "not-found" };
  }

  let role: WorldRole | null;
  try {
    role =
      world.userId === dbUser.id
        ? "owner"
        : await getCollaboratorRole(worldId, dbUser.id);
  } catch {
    // getCollaboratorRole already logged; surface as db-error.
    return { kind: "db-error" };
  }

  if (role === null) {
    return { kind: "forbidden" };
  }

  return { kind: "ok", world, role };
}

/**
 * Check whether the user has at least `requiredRole` on the world.
 *
 * Thin wrapper around getWorldRoleForUser that converts the error variants to
 * NextResponse — suitable for route handlers.
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
  const result = await getWorldRoleForUser(worldId, dbUser);

  if (result.kind === "not-found") {
    return NextResponse.json({ error: "World not found" }, { status: 404 });
  }
  if (result.kind === "db-error") {
    return NextResponse.json(
      { error: "Database temporarily unavailable" },
      { status: 503 }
    );
  }
  if (result.kind === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // result.kind === "ok"
  const { world, role } = result;

  if (ROLE_RANK[role] < ROLE_RANK[requiredRole]) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { world, role };
}
