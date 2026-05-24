/**
 * POST /api/worlds/[id]/reports — file a report against a world
 *
 * Auth required. Suspension-EXEMPT by design: suspended users must still be
 * able to flag genuinely harmful content posted by others (anti-abuse safety
 * valve). Do NOT add a suspension check here — see Slice 6 plan.
 *
 * Idempotent: a user re-reporting the same world is silently ignored
 * (onConflictDoNothing on the (reporter_id, world_id) unique constraint).
 * The response is always 200 { reported: true } to avoid leaking whether a
 * prior report already existed.
 *
 * TODO: Add per-user rate limiting before public launch (PROJECT.md risk #4).
 *       A simple counter in Postgres or Upstash Redis is sufficient.
 */

import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { worlds, reports } from "@/db/schema";
import { getOrCreateDbUser, type DbUser } from "@/lib/users";

// ---------------------------------------------------------------------------
// Param validation
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Body schema
// ---------------------------------------------------------------------------

const BodySchema = z.object({
  reason: z.enum(["copyright", "nsfw", "abusive", "spam", "other"]),
  body: z.string().trim().max(1000).optional(),
});

// ---------------------------------------------------------------------------
// Shared prelude: auth + DB user resolution + world existence check
// NOTE: intentionally NO suspension check — this endpoint is the safety valve.
// ---------------------------------------------------------------------------

type Prelude = {
  dbUser: DbUser;
  worldId: string;
};

type PreludeError = NextResponse;

async function resolvePrelude(
  rawId: string
): Promise<Prelude | PreludeError> {
  // 1. Auth
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate world id param
  const parsed = UuidSchema.safeParse(rawId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid world id" }, { status: 400 });
  }
  const worldId = parsed.data;

  // 3. Resolve DB user (creates row on first auth'd request)
  const clerkUser = await currentUser();
  if (!clerkUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    console.error("[POST /api/worlds/[id]/reports] getOrCreateDbUser error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  // 4. Confirm world exists
  const worldRows = await db
    .select({ id: worlds.id })
    .from(worlds)
    .where(eq(worlds.id, worldId))
    .limit(1);

  if (worldRows.length === 0) {
    return NextResponse.json({ error: "World not found" }, { status: 404 });
  }

  return { dbUser, worldId };
}

function isError(result: Prelude | PreludeError): result is PreludeError {
  return result instanceof NextResponse;
}

// ---------------------------------------------------------------------------
// POST — file a report (idempotent via onConflictDoNothing)
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const prelude = await resolvePrelude(id);
  if (isError(prelude)) return prelude;

  const { dbUser, worldId } = prelude;

  // 5. Validate request body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bodyParsed = BodySchema.safeParse(rawBody);
  if (!bodyParsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: bodyParsed.error.flatten() },
      { status: 400 }
    );
  }

  const { reason, body } = bodyParsed.data;

  // 6. Insert — duplicate is silently ignored; response is always 200
  try {
    await db
      .insert(reports)
      .values({
        reporterId: dbUser.id,
        worldId,
        reason,
        body: body ?? null,
      })
      .onConflictDoNothing({ target: [reports.reporterId, reports.worldId] });
  } catch (err) {
    console.error("[POST /api/worlds/[id]/reports] insert error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable, please try again" },
      { status: 503 }
    );
  }

  // Return 200 regardless of whether this was a new insert or a no-op
  // duplicate — leaking that information would enable enumeration attacks.
  return NextResponse.json({ reported: true });
}
