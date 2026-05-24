/**
 * GET /api/worlds/[id]
 *
 * Public read — no auth required. Returns a single world with its author
 * (id, username, avatarUrl only — no PII) and its ordered media gallery.
 *
 * Always returns commentsCount (public aggregate — no auth required).
 * Opportunistically checks whether the signed-in user has liked or reposted
 * this world. Signed-out requests always get isLikedByCurrentUser: false and
 * isRepostedByCurrentUser: false (no extra DB hit).
 * We intentionally do NOT call getOrCreateDbUser here — a GET must not write.
 *
 * TODO (Slice 7): increment views counter on read — intentionally omitted here
 * to keep GET handlers side-effect-free until the discovery-polish slice.
 */

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { eq, and, count } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { worlds, likes, users, comments, reposts } from "@/db/schema";

// ---------------------------------------------------------------------------
// Param validation
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // --- 1. Validate path param -----------------------------------------------
  const parsed = UuidSchema.safeParse(id);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid world id" }, { status: 400 });
  }

  // --- 2. Query world + author + media --------------------------------------
  const row = await db.query.worlds.findFirst({
    where: eq(worlds.id, parsed.data),
    with: {
      user: {
        columns: { id: true, username: true, avatarUrl: true },
      },
      media: {
        orderBy: (m, { asc }) => [asc(m.position)],
        columns: {
          id: true,
          type: true,
          url: true,
          sizeBytes: true,
          position: true,
        },
      },
    },
  });

  // --- 3. 404 if not found --------------------------------------------------
  if (!row) {
    return NextResponse.json({ error: "World not found" }, { status: 404 });
  }

  // --- 4. commentsCount — always returned, not auth-gated -----------------
  const [{ count: commentsCount }] = await db
    .select({ count: count() })
    .from(comments)
    .where(eq(comments.worldId, parsed.data));

  // --- 5. Opportunistic like + repost checks (read-only — no DB write on GET) ---
  let isLikedByCurrentUser = false;
  let isRepostedByCurrentUser = false;

  const { userId: clerkUserId } = await auth();
  if (clerkUserId) {
    // Look up DB user by clerk_id only — do NOT create one.
    const [dbUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);

    if (dbUser) {
      const [likeRow] = await db
        .select({ userId: likes.userId })
        .from(likes)
        .where(and(eq(likes.userId, dbUser.id), eq(likes.worldId, parsed.data)))
        .limit(1);

      isLikedByCurrentUser = !!likeRow;

      const [repostRow] = await db
        .select({ userId: reposts.userId })
        .from(reposts)
        .where(and(eq(reposts.userId, dbUser.id), eq(reposts.worldId, parsed.data)))
        .limit(1);

      isRepostedByCurrentUser = !!repostRow;
    }
  }

  // --- 6. Shape the response — only expose safe fields ---------------------
  // row.user is guaranteed non-null because userId is a NOT NULL FK, but
  // TypeScript infers it as possibly undefined from the relational query.
  const author = row.user!;

  return NextResponse.json({
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    glbUrl: row.glbUrl,
    glbSizeBytes: row.glbSizeBytes,
    likesCount: row.likesCount,
    views: row.views,
    createdAt: row.createdAt.toISOString(),
    commentsCount,
    author: {
      id: author.id,
      username: author.username,
      avatarUrl: author.avatarUrl ?? null,
    },
    media: row.media.map((m) => ({
      id: m.id,
      type: m.type as "thumbnail" | "image" | "video",
      url: m.url,
      sizeBytes: m.sizeBytes,
      position: m.position,
    })),
    isLikedByCurrentUser,
    isRepostedByCurrentUser,
  });
}
