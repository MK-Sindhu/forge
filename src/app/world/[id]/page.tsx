import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Image from "next/image";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { WorldViewerClient } from "./WorldViewerClient";
import MediaCarousel from "@/components/media-carousel/MediaCarousel";
import { LikeButton } from "@/components/like-button/LikeButton";
import { RepostButton } from "@/components/repost-button/RepostButton";
import { ShareButton } from "@/components/share-button/ShareButton";
import { ReportButton } from "@/components/report-button/ReportButton";
import CommentsSection from "@/components/comments-section/CommentsSection";
import UpdatesTimeline from "@/components/updates-timeline/UpdatesTimeline";

export default async function WorldPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Server-side fetch via the API route (uses absolute URL).
  // Derive the base URL from request headers — works in dev, Vercel, and
  // preview deploys without any env var config.
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const baseUrl = `${proto}://${host}`;

  // Run world fetch and auth check in parallel.
  const [res, { userId }] = await Promise.all([
    fetch(`${baseUrl}/api/worlds/${id}`, {
      // World data may change (likes count); don't cache aggressively in Slice 1.
      cache: "no-store",
    }),
    auth(),
  ]);

  if (res.status === 404) {
    notFound(); // Renders not-found.tsx
  }
  if (!res.ok) {
    throw new Error(`Failed to load world: ${res.status}`);
  }
  const world = await res.json();
  const signedIn = !!userId;

  // Resolve the current visitor's DB user id (needed by CommentsSection for
  // the "can delete?" check).  Null when signed out or no DB row yet.
  let currentUserDbId: string | null = null;
  if (userId) {
    const [dbUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, userId))
      .limit(1);
    currentUserDbId = dbUser?.id ?? null;
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {/* Header section: title, author, metadata */}
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">{world.title}</h1>
        <div className="mt-2 flex items-center gap-3 text-sm text-neutral-600 dark:text-neutral-400">
          {world.author.avatarUrl && (
            <Image
              src={world.author.avatarUrl}
              alt={world.author.username}
              width={32}
              height={32}
              className="rounded-full"
            />
          )}
          <span>
            by{" "}
            <a
              href={`/profile/${world.author.username}`}
              className="font-medium text-neutral-900 hover:underline dark:text-neutral-100"
            >
              {world.author.username}
            </a>
          </span>
          <span aria-hidden>·</span>
          <time dateTime={world.createdAt}>
            {new Date(world.createdAt).toLocaleDateString()}
          </time>
        </div>
      </header>

      {/* Media carousel — only shown when there are 2+ media items (thumbnail + extras) */}
      {world.media.length > 1 && (
        <div className="mb-6">
          <MediaCarousel media={world.media} worldTitle={world.title} />
        </div>
      )}

      {/* 3D viewer — fills a fixed-aspect container */}
      <div className="aspect-video w-full overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
        <WorldViewerClient glbUrl={world.glbUrl} ariaLabel={`3D world: ${world.title}`} />
      </div>

      {/* Description (only if present) */}
      {world.description && (
        <section className="mt-6">
          <p className="whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">{world.description}</p>
        </section>
      )}

      {/* Stat row */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <LikeButton
          worldId={world.id}
          initialLiked={world.isLikedByCurrentUser ?? false}
          initialLikesCount={world.likesCount}
          signedIn={signedIn}
        />
        <RepostButton
          worldId={world.id}
          initialReposted={world.isRepostedByCurrentUser ?? false}
          signedIn={signedIn}
        />
        <ShareButton title={world.title} />
        <ReportButton worldId={world.id} signedIn={signedIn} />
        <span className="text-sm text-neutral-500 dark:text-neutral-500">
          {world.views} {world.views === 1 ? "view" : "views"}
        </span>
      </div>

      {/* Updates timeline — creator-driven content; shown above community comments */}
      <UpdatesTimeline
        worldId={world.id}
        isOwner={currentUserDbId === world.author.id}
      />

      {/* Comments section */}
      <CommentsSection
        worldId={world.id}
        worldOwnerId={world.author.id}
        initialCommentsCount={world.commentsCount}
        signedIn={signedIn}
        currentUserDbId={currentUserDbId}
      />
    </main>
  );
}
