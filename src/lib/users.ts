import { eq } from "drizzle-orm";
import type { User } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";

export type DbUser = typeof users.$inferSelect;

/**
 * Returns the FORGE DB user row for a given Clerk user. Creates the row
 * on first call (idempotent — safe to invoke from any auth'd route).
 *
 * Throws if the Clerk user lacks a primary email (FORGE requires email).
 *
 * Known limitation (Slice 1): if two requests for the same new user arrive
 * simultaneously, one insert will succeed and the other will hit a unique
 * constraint violation (propagates as a 500). The client retry will succeed
 * because the row exists by the time of the second call. Production hardening
 * (upsert / ON CONFLICT DO NOTHING) is a Slice 7 concern.
 */
export async function getOrCreateDbUser(clerkUser: User): Promise<DbUser> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkUser.id))
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  const email = clerkUser.emailAddresses[0]?.emailAddress;
  if (!email) {
    throw new Error("Clerk user has no email address — FORGE requires email");
  }

  const username =
    clerkUser.username ??
    email.split("@")[0] ??
    `user_${clerkUser.id.slice(-8)}`;

  const [created] = await db
    .insert(users)
    .values({
      clerkId: clerkUser.id,
      username,
      email,
      avatarUrl: clerkUser.imageUrl,
    })
    .returning();

  return created;
}

/**
 * Ensures the caller is signed in, has a DB row, AND is not suspended.
 * Returns DbUser on success, or a NextResponse (401 / 400 / 503 / 403)
 * ready to return from a route handler.
 *
 * Use this anywhere a route writes to the DB on behalf of the user.
 * The only exception: POST /api/worlds/[id]/reports stays on the raw
 * getOrCreateDbUser so suspended users can still file reports (anti-
 * abuse safety valve — see plan).
 */
export async function requireActiveDbUser(clerkUser: User): Promise<DbUser | NextResponse> {
  let dbUser: DbUser;
  try {
    dbUser = await getOrCreateDbUser(clerkUser);
  } catch (err) {
    if (err instanceof Error && err.message.includes("no email")) {
      return NextResponse.json(
        { error: "No email on Clerk user" },
        { status: 400 }
      );
    }
    console.error("[requireActiveDbUser] getOrCreateDbUser error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  if (dbUser.suspendedAt !== null) {
    return NextResponse.json({ error: "Account suspended" }, { status: 403 });
  }

  return dbUser;
}

/**
 * Ensures the caller is signed in AND has `is_admin === true` on their
 * DB row. Returns the DbUser on success, or a NextResponse error
 * (400-no-email / 503 / 403) ready to return from a route handler.
 *
 * Mirrors getOrCreateDbUser but adds the admin gate after the lookup.
 * The caller is responsible for the 401 check (auth() + currentUser()) before
 * invoking this helper.
 */
export async function requireAdmin(clerkUser: User): Promise<DbUser | NextResponse> {
  let dbUser: DbUser;
  try {
    dbUser = await getOrCreateDbUser(clerkUser);
  } catch (err) {
    if (err instanceof Error && err.message.includes("no email")) {
      return NextResponse.json(
        { error: "No email on Clerk user" },
        { status: 400 }
      );
    }
    console.error("[requireAdmin] getOrCreateDbUser error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  if (!dbUser.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return dbUser;
}
