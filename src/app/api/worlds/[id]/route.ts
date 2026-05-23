/**
 * GET /api/worlds/[id]
 *
 * Public read — no auth required. Returns a single world with its author
 * (id, username, avatarUrl only — no PII) and its ordered media gallery.
 *
 * TODO (Slice 7): increment views counter on read — intentionally omitted here
 * to keep GET handlers side-effect-free until the discovery-polish slice.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { worlds } from "@/db/schema";

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

  // --- 4. Shape the response — only expose safe fields ---------------------
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
  });
}
