/**
 * POST /api/liveblocks/auth
 *
 * Issues a short-lived Liveblocks JWT authorizing a user (signed-in OR
 * anonymous guest) to join the Liveblocks room for one world.
 *
 * Both signed-in users and guests may call this endpoint — no Clerk session
 * is required. Signed-in users get their FORGE identity (username + avatar)
 * embedded in the token; guests get a synthesized "Guest_XXXX" identity.
 *
 * Auth model:
 *   - Signed-in (Clerk session present): user is looked up in the DB.
 *     - Suspended users receive 403.
 *     - DB-missing signed-in users receive 503 (edge case; normal onboarding
 *       creates the row before any world visit).
 *   - Guest (no Clerk session): must supply `guestId` in the body.
 *     - guestId is validated as 4 uppercase alphanumeric chars (matches
 *       guest-id.ts ALPHABET + length).
 *     - Name is derived server-side from guestId via guestName() — the client
 *       does NOT supply a name.
 *
 * Room access:
 *   - The room is validated against the `worlds` table — 404 if the world
 *     does not exist (prevents issuing tokens for non-existent rooms).
 *   - The token grants FULL_ACCESS to the room. Fine for v1 (all visitors
 *     are equal). Future: narrow to read-only for non-collaborators.
 *
 * Token shape:
 *   - The Liveblocks `session.authorize()` call returns a `body` string
 *     (JSON-formatted JWT) and an HTTP `status` (normally 200).
 *   - We forward both verbatim so the Liveblocks client SDK can parse them
 *     as-is. Content-Type is "application/json".
 *
 * Errors: 400 (bad body), 403 (suspended), 404 (world not found),
 *         503 (DB error or Liveblocks unavailable).
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { worlds, users } from "@/db/schema";
import { getLiveblocksClient } from "@/lib/liveblocks/server";
import { worldRoomId, VisitorUserInfo } from "@/lib/liveblocks/types";
import type { IUserInfo } from "@liveblocks/node";
import { visitorColor } from "@/lib/visitor-color";
import { guestName } from "@/lib/guest-id";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const BodySchema = z.object({
  // The worldId — server wraps it into the canonical "world:{id}" room id.
  room: z.string().uuid(),

  // Required for guests (no Clerk session). Must be 4 uppercase alphanumeric
  // chars — matches the ALPHABET and length in src/lib/guest-id.ts.
  guestId: z.string().regex(/^[A-Z0-9]{4}$/).optional(),
});

type Body = z.infer<typeof BodySchema>;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  // --- 1. Parse + validate body ---------------------------------------------
  let body: Body;
  try {
    const raw = await req.json();
    body = BodySchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid request body",
        details: err instanceof z.ZodError ? err.flatten() : undefined,
      },
      { status: 400 }
    );
  }

  // --- 2. Verify the world exists (minimal DB hit: id only) -----------------
  let worldExists: boolean;
  try {
    const rows = await db
      .select({ id: worlds.id })
      .from(worlds)
      .where(eq(worlds.id, body.room))
      .limit(1);
    worldExists = rows.length > 0;
  } catch (err) {
    console.error("[POST liveblocks/auth] DB error on world lookup:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  if (!worldExists) {
    return NextResponse.json({ error: "World not found" }, { status: 404 });
  }

  // --- 3. Determine identity -------------------------------------------------
  const { userId: clerkUserId } = await auth();

  let lbUserId: string;
  let userInfo: VisitorUserInfo;

  if (clerkUserId) {
    // ------------------------------------------------------------------
    // Signed-in path
    // ------------------------------------------------------------------
    const clerkUser = await currentUser();
    if (!clerkUser) {
      // auth() returned a userId but currentUser() returned null — should
      // not happen in practice; treat as a server-side anomaly.
      return NextResponse.json(
        { error: "Database temporarily unavailable, please try again" },
        { status: 503 }
      );
    }

    // Look up the DB user row (do NOT auto-create — if the signed-in Clerk
    // user has no FORGE row that's a weird state that 503 correctly signals).
    let dbUserRow: typeof users.$inferSelect | undefined;
    try {
      const rows = await db
        .select()
        .from(users)
        .where(eq(users.clerkId, clerkUserId))
        .limit(1);
      dbUserRow = rows[0];
    } catch (err) {
      console.error("[POST liveblocks/auth] DB error on user lookup:", err);
      return NextResponse.json(
        { error: "Database temporarily unavailable, please try again" },
        { status: 503 }
      );
    }

    if (!dbUserRow) {
      return NextResponse.json(
        { error: "Database temporarily unavailable, please try again" },
        { status: 503 }
      );
    }

    if (dbUserRow.suspendedAt !== null) {
      return NextResponse.json({ error: "Account suspended" }, { status: 403 });
    }

    lbUserId = `user_${dbUserRow.id}`;
    userInfo = {
      name: `@${dbUserRow.username}`,
      avatarUrl: dbUserRow.avatarUrl ?? null,
      color: visitorColor(dbUserRow.id),
      isGuest: false,
    };
  } else {
    // ------------------------------------------------------------------
    // Guest path — no Clerk session
    // ------------------------------------------------------------------
    if (!body.guestId) {
      return NextResponse.json(
        { error: "guestId is required for unauthenticated visitors" },
        { status: 400 }
      );
    }

    lbUserId = `guest_${body.guestId}`;
    userInfo = {
      name: guestName(body.guestId),
      avatarUrl: null,
      color: visitorColor(body.guestId),
      isGuest: true,
    };
  }

  // --- 4. Issue Liveblocks token --------------------------------------------
  try {
    const liveblocks = getLiveblocksClient();
    // VisitorUserInfo fields are all JSON-serializable but our interface lacks
    // the [key: string] index signature that Liveblocks's IUserInfo requires.
    // Build a plain IUserInfo-typed object to satisfy the type checker.
    const lbUserInfo: IUserInfo = {
      name: userInfo.name,
      avatar: userInfo.avatarUrl ?? undefined,
      color: userInfo.color,
      isGuest: userInfo.isGuest,
    };
    const session = liveblocks.prepareSession(lbUserId, {
      userInfo: lbUserInfo,
    });
    session.allow(worldRoomId(body.room), session.FULL_ACCESS);
    const { body: tokenBody, status } = await session.authorize();
    return new Response(tokenBody, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[POST liveblocks/auth] Liveblocks authorize error:", err);
    return NextResponse.json(
      { error: "Realtime service temporarily unavailable, please try again" },
      { status: 503 }
    );
  }
}
