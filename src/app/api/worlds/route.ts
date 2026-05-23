/**
 * POST /api/worlds
 *
 * Creates a world record after the client has uploaded the GLB + thumbnail
 * directly to R2 via presigned PUT URLs (from POST /api/uploads/sign).
 *
 * Flow:
 *   1. Client → POST /api/uploads/sign × 2  (one for GLB, one for thumbnail)
 *   2. Client → PUT <presignedUrl>           (direct to R2, never touches our server)
 *   3. Client → POST /api/worlds             (this route — finalize the record)
 *
 * Security model:
 *   - Clerk userId is read from the session — never from the request body.
 *   - R2 object keys are validated against the authenticated user's Clerk ID
 *     and the worldId from the body, preventing one user from claiming another's
 *     uploaded files.
 *   - GLB + thumbnail are HEAD-checked in R2 to confirm the uploads completed
 *     before any DB row is written.
 *   - worlds + world_media are inserted in a single DB transaction — no partial
 *     state is possible.
 *   - TOS acceptance is recorded inside the same transaction.
 *
 * TODO: Add per-user rate limiting before public launch (PROJECT.md risk #4).
 *       A simple counter in Postgres or Upstash Redis is sufficient. Ticket this
 *       as a hardening task before Slice 1 goes live.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, dbPool } from "@/db";
import { users, worlds, worldMedia } from "@/db/schema";
import { headObject, publicUrlFor } from "@/lib/r2";

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const BodySchema = z.object({
  // UUID v4 — must match the worldId used in /api/uploads/sign so the R2 key
  // paths align.
  worldId: z.string().uuid(),

  title: z.string().min(1).max(100).transform((s) => s.trim()),

  // Optional — omit or send empty string; stored as null in DB when absent.
  description: z.string().max(1000).optional(),

  // z.literal(true) rejects false, missing, or any other truthy value.
  tosAccepted: z.literal(true),

  // R2 object keys returned by /api/uploads/sign.
  glbKey: z.string().min(1),
  glbSizeBytes: z.number().int().positive(),

  thumbnailKey: z.string().min(1),
  thumbnailSizeBytes: z.number().int().positive(),
});

type Body = z.infer<typeof BodySchema>;

// ---------------------------------------------------------------------------
// Helper: validate that an R2 key belongs to the authenticated user+world.
//
// The canonical key format (from /api/uploads/sign) is:
//   worlds/<clerkUserId>/<worldId>/<filename>
//
// We check that the key starts with the literal string
//   "worlds/<userId>/<worldId>/"
// using plain string comparison on the already-decoded key (no URL-encoding
// in the R2 object key path — keys are stored verbatim, not percent-encoded).
// ---------------------------------------------------------------------------

function keyMatchesUserAndWorld(
  key: string,
  userId: string,
  worldId: string
): boolean {
  const expectedPrefix = `worlds/${userId}/${worldId}/`;
  return key.startsWith(expectedPrefix);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  // --- 1. Auth ---------------------------------------------------------------
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // --- 2. Parse + validate body ----------------------------------------------
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

  const {
    worldId,
    title,
    description,
    glbKey,
    glbSizeBytes,
    thumbnailKey,
    thumbnailSizeBytes,
  } = body;

  // --- 3. Security: R2 key prefix must match authenticated user + worldId ----
  if (!keyMatchesUserAndWorld(glbKey, userId, worldId)) {
    return NextResponse.json(
      { error: "key does not match authenticated user/world" },
      { status: 400 }
    );
  }
  if (!keyMatchesUserAndWorld(thumbnailKey, userId, worldId)) {
    return NextResponse.json(
      { error: "key does not match authenticated user/world" },
      { status: 400 }
    );
  }

  // --- 4. HEAD the GLB in R2 -------------------------------------------------
  const glbHead = await headObject({ bucket: "glb", objectKey: glbKey });
  if (!glbHead.exists) {
    return NextResponse.json(
      { error: "GLB file not found in storage — did upload complete?" },
      { status: 400 }
    );
  }
  if (glbHead.contentLength !== glbSizeBytes) {
    return NextResponse.json(
      { error: "GLB size mismatch" },
      { status: 400 }
    );
  }

  // --- 5. HEAD the thumbnail in R2 -------------------------------------------
  const thumbHead = await headObject({ bucket: "media", objectKey: thumbnailKey });
  if (!thumbHead.exists) {
    return NextResponse.json(
      { error: "Thumbnail file not found in storage — did upload complete?" },
      { status: 400 }
    );
  }
  if (thumbHead.contentLength !== thumbnailSizeBytes) {
    return NextResponse.json(
      { error: "Thumbnail size mismatch" },
      { status: 400 }
    );
  }

  // --- 6. Look up DB user row by Clerk ID ------------------------------------
  const userRows = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);

  const dbUser = userRows[0];
  if (!dbUser) {
    return NextResponse.json(
      { error: "User row missing — call /api/me first" },
      { status: 401 }
    );
  }

  // --- 7. Transaction: insert worlds + world_media, optionally set tos_accepted_at
  await dbPool.transaction(async (tx) => {
    // Insert the world row, using worldId from the body as the PK so it aligns
    // with the R2 key paths that were already created during the sign step.
    await tx.insert(worlds).values({
      id: worldId,
      userId: dbUser.id,
      title,
      description: description ?? null,
      glbUrl: publicUrlFor("glb", glbKey),
      glbSizeBytes,
    });

    // Insert the primary thumbnail row in world_media (position 0).
    await tx.insert(worldMedia).values({
      worldId,
      type: "thumbnail",
      url: publicUrlFor("media", thumbnailKey),
      sizeBytes: thumbnailSizeBytes,
      position: 0,
    });

    // If the user has not yet accepted TOS, record acceptance now.
    // This is part of the same atomic act as publishing their first world.
    if (dbUser.tosAcceptedAt === null) {
      await tx
        .update(users)
        .set({ tosAcceptedAt: new Date() })
        .where(eq(users.id, dbUser.id));
    }
  });

  // --- 8. Respond 201 Created ------------------------------------------------
  return NextResponse.json({ worldId, url: `/world/${worldId}` }, { status: 201 });
}
