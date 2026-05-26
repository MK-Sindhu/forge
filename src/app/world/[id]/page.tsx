import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Image from "next/image";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, worlds } from "@/db/schema";
import { WorldViewerClient } from "./WorldViewerClient";
import { WorldVisitorClient } from "@/components/world-visitor/WorldVisitorClient";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";
import MediaCarousel from "@/components/media-carousel/MediaCarousel";
import { LikeButton } from "@/components/like-button/LikeButton";
import { RepostButton } from "@/components/repost-button/RepostButton";
import { ShareButton } from "@/components/share-button/ShareButton";
import { ReportButton } from "@/components/report-button/ReportButton";
import CommentsSection from "@/components/comments-section/CommentsSection";
import UpdatesTimeline from "@/components/updates-timeline/UpdatesTimeline";
import { TagChip } from "@/components/tag-chip/TagChip";
import { ViewTracker } from "@/components/view-tracker/ViewTracker";
import { ConvertToSceneGraphButton } from "@/components/convert-to-scene-graph/ConvertToSceneGraphButton";
import { VersionHistorySection } from "@/components/version-history/VersionHistorySection";
import { CollaboratorsSection } from "@/components/collaborators/CollaboratorsSection";

// ---------------------------------------------------------------------------
// generateMetadata — per-world OG + Twitter Card tags
// Direct DB query (3 joins, ~5 columns) rather than re-calling the API route,
// which would require reconstructing the absolute URL and adds an extra HTTP
// round-trip. The page render itself still uses the API route (no change to
// that path). Next.js does NOT dedupe a fetch() in generateMetadata with an
// identical fetch() in the page component when they execute in separate phases,
// so the direct DB approach is both cheaper and simpler here.
// ---------------------------------------------------------------------------
export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params;

  // Minimal query — only the columns OG tags need.
  const worldRow = await db.query.worlds.findFirst({
    where: eq(worlds.id, id),
    columns: { id: true, title: true, description: true },
    with: {
      user: { columns: { username: true } },
      media: {
        where: (m, { eq: meq }) => meq(m.type, "thumbnail"),
        limit: 1,
        columns: { url: true },
      },
    },
  });

  if (!worldRow) {
    return { title: "World not found" };
  }

  const thumbnail = worldRow.media[0]?.url ?? null;
  const url = `/world/${worldRow.id}`;
  const description = (
    worldRow.description ??
    `Visit ${worldRow.title} — a world by @${worldRow.user.username} on FORGE.`
  ).slice(0, 200);

  return {
    title: worldRow.title,
    description,
    openGraph: {
      type: "article",
      title: worldRow.title,
      description,
      url,
      images: thumbnail
        ? [{ url: thumbnail, width: 1200, height: 1200, alt: worldRow.title }]
        : [],
      authors: [`@${worldRow.user.username}`],
    },
    twitter: {
      card: "summary_large_image",
      title: worldRow.title,
      description,
      images: thumbnail ? [thumbnail] : [],
      creator: `@${worldRow.user.username}`,
    },
  };
}

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
      <ViewTracker worldId={world.id} signedIn={signedIn} />
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
        {world.tags && world.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(world.tags as { name: string }[]).map((t) => (
              <TagChip key={t.name} name={t.name} />
            ))}
          </div>
        )}
      </header>

      {/* Media carousel — only shown when there are 2+ media items (thumbnail + extras) */}
      {world.media.length > 1 && (
        <div className="mb-6">
          <MediaCarousel media={world.media} worldTitle={world.title} />
        </div>
      )}

      {/* 3D viewer — fills a fixed-aspect container.
          Branches on sceneGraph: scene-graph worlds use WorldVisitorClient (walk mode);
          legacy single-GLB worlds (sceneGraph === null) use WorldViewerClient. */}
      <div className="aspect-video w-full overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
        {(world.sceneGraph as SceneGraphV1 | null) ? (
          <WorldVisitorClient
            sceneGraph={world.sceneGraph as SceneGraphV1}
            assets={world.assets as Array<{ id: string; name: string; glbUrl: string; sizeBytes: number }>}
            ariaLabel={`3D world: ${world.title}`}
          />
        ) : (
          <WorldViewerClient glbUrl={world.glbUrl} ariaLabel={`3D world: ${world.title}`} />
        )}
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

      {/* Owner-only Phase 2 tools:
          - Legacy world  → "Convert to editable scene graph" button
          - Scene-graph world → Version history (immutable snapshots + publish) */}
      {currentUserDbId === world.author.id && (
        <>
          {(world.sceneGraph as SceneGraphV1 | null) === null ? (
            <ConvertToSceneGraphButton worldId={world.id} />
          ) : (
            <VersionHistorySection
              worldId={world.id}
              publishedVersionId={world.publishedVersionId ?? null}
              isOwner={true}
            />
          )}
        </>
      )}

      {/* Collaborators — visible to everyone; owner sees invite/remove, collaborator sees leave */}
      <CollaboratorsSection
        worldId={world.id}
        isOwner={currentUserDbId === world.author.id}
        currentUserId={currentUserDbId}
      />
    </main>
  );
}
