/**
 * PUT /api/users/me — change the signed-in user's FORGE username.
 *
 * Auth: requireActiveDbUser (signed-in, not suspended).
 * Body: { username: string } — 3-32 chars, alphanumeric + underscore, stored lowercased.
 *
 * Reserved username set prevents conflicts with internal URL paths (e.g. /api, /me, /admin).
 *
 * Error codes:
 *   400 — Zod validation failure, reserved username, or invalid format
 *   401 — not signed in
 *   403 — account suspended
 *   409 — username already taken by another user
 *   503 — DB unavailable
 */

import { NextResponse, NextRequest } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, and, ne } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireActiveDbUser } from "@/lib/users";

// ---------------------------------------------------------------------------
// Reserved usernames — these collide with real URL segments under /profile/*
// or are confusing no-ops (api, me) or brand-reserved (forge, system).
// ---------------------------------------------------------------------------
const RESERVED_USERNAMES = new Set([
  "admin",
  "me",
  "api",
  "forge",
  "system",
  "settings",
  "login",
  "signup",
  "signin",
]);

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------
const PutBodySchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(32, "Username must be at most 32 characters")
    .regex(
      /^[a-z0-9_]+$/i,
      "Username may only contain letters, numbers, and underscores"
    ),
});

// ---------------------------------------------------------------------------
// PUT handler
// ---------------------------------------------------------------------------
export async function PUT(req: NextRequest) {
  // 1. Auth check
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dbUserOrResponse = await requireActiveDbUser(clerkUser);
  if (dbUserOrResponse instanceof NextResponse) {
    return dbUserOrResponse;
  }
  const dbUser = dbUserOrResponse;

  // 2. Parse + validate body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PutBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid username" },
      { status: 400 }
    );
  }

  // 3. Normalize to lowercase
  const newUsername = parsed.data.username.toLowerCase();

  // 4. Reserved-name check
  if (RESERVED_USERNAMES.has(newUsername)) {
    return NextResponse.json(
      { error: "username reserved" },
      { status: 400 }
    );
  }

  // 5. No-op: username unchanged
  if (newUsername === dbUser.username) {
    return NextResponse.json({
      id: dbUser.id,
      username: dbUser.username,
      avatarUrl: dbUser.avatarUrl,
    });
  }

  // 6. Uniqueness check — another user already owns this name
  try {
    const [conflict] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, newUsername), ne(users.id, dbUser.id)))
      .limit(1);

    if (conflict) {
      return NextResponse.json(
        { error: "username taken" },
        { status: 409 }
      );
    }
  } catch (err) {
    console.error("[PUT /api/users/me] uniqueness check error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  // 7. Persist
  try {
    const [updated] = await db
      .update(users)
      .set({ username: newUsername })
      .where(eq(users.id, dbUser.id))
      .returning({
        id: users.id,
        username: users.username,
        avatarUrl: users.avatarUrl,
      });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[PUT /api/users/me] update error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}
