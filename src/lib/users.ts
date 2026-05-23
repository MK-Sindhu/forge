import { eq } from "drizzle-orm";
import type { User } from "@clerk/nextjs/server";
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
