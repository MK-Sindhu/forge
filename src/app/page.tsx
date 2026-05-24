import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { worlds, users, follows, reposts, worldUpdates, worldMedia, worldTags, tags as tagsTable } from "@/db/schema";
import { WorldCardMedia } from "@/components/world-card-media/WorldCardMedia";
import { TagChip } from "@/components/tag-chip/TagChip";

// ---------------------------------------------------------------------------
// Types inferred from the Drizzle query result
// ---------------------------------------------------------------------------
type FeedWorld = {
  id: string;
  title: string;
  likesCount: number;
  views: number;
  createdAt: Date;
  user: {
    username: string;
    avatarUrl: string | null;
  };
  media: { type: string; url: string }[];
  tags: { name: string }[];
};

type FeedEntry =
  | (FeedWorld & {
      entryType: "original";
      activityAt: Date;
      repostedBy: null;
      updateBody: null;
      updateId: null;
    })
  | (FeedWorld & {
      entryType: "repost";
      activityAt: Date;
      repostedBy: string;
      updateBody: null;
      updateId: null;
    })
  | (FeedWorld & {
      entryType: "update";
      activityAt: Date;
      repostedBy: null;
      updateBody: string;
      updateId: string;
    });

// ---------------------------------------------------------------------------
// Page (server component — no 'use client')
// ---------------------------------------------------------------------------
export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { tab } = await searchParams;
  // Closed-set parse: only "following" is accepted; everything else → "recent"
  const activeTab: "recent" | "following" =
    tab === "following" ? "following" : "recent";

  // --- Auth context ----------------------------------------------------------
  const { userId: clerkUserId } = await auth();
  let currentDbUserId: string | null = null;

  if (clerkUserId) {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);
    if (row) currentDbUserId = row.id;
  }

  // Following tab requires sign-in. Redirect if not authenticated.
  if (activeTab === "following" && !clerkUserId) {
    redirect("/sign-in?redirect_url=/?tab=following");
  }

  // --- Queries (only one fires per request) ----------------------------------
  let rows: FeedEntry[];

  if (activeTab === "following") {
    // Step 1: look up followee IDs
    const followeeRows = currentDbUserId
      ? await db
          .select({ id: follows.followeeId })
          .from(follows)
          .where(eq(follows.followerId, currentDbUserId))
      : [];

    const followeeIds = followeeRows.map((r) => r.id);

    // Early-return: no followees → empty feed, no further queries
    if (followeeIds.length === 0) {
      rows = [];
    } else {
      // Step 2: repost rows from followees — dedupe per world in JS, keeping
      // the most recent reposter (rows arrive DESC so first-seen wins).
      // Uses alias() from drizzle-orm/pg-core to join users a second time
      // for the reposter's username without conflicting with the world-author join.
      const reposter = alias(users, "reposter");

      const repostRows = await db
        .select({
          worldId: reposts.worldId,
          reposterUsername: reposter.username,
          repostedAt: reposts.createdAt,
        })
        .from(reposts)
        .innerJoin(reposter, eq(reposter.id, reposts.userId))
        .where(inArray(reposts.userId, followeeIds))
        .orderBy(desc(reposts.createdAt))
        .limit(50);

      // Dedupe: for each worldId keep only the most recent reposter
      // (rows are already in DESC order so the first occurrence is the latest)
      const repostByWorld = new Map<
        string,
        { reposterUsername: string; repostedAt: Date }
      >();
      for (const r of repostRows) {
        if (!repostByWorld.has(r.worldId)) {
          repostByWorld.set(r.worldId, {
            reposterUsername: r.reposterUsername,
            repostedAt: r.repostedAt,
          });
        }
      }

      // Step 3: original worlds created by followees
      const originalRows = await db.query.worlds.findMany({
        where: inArray(worlds.userId, followeeIds),
        orderBy: [desc(worlds.createdAt)],
        limit: 50,
        columns: {
          id: true,
          title: true,
          likesCount: true,
          views: true,
          createdAt: true,
        },
        with: {
          user: { columns: { username: true, avatarUrl: true } },
          media: {
            where: (m, { or, eq: oreq }) =>
              or(oreq(m.type, "thumbnail"), oreq(m.type, "video")),
            limit: 2,
            columns: { type: true, url: true },
          },
          tags: { with: { tag: { columns: { name: true } } } },
        },
      });

      // Step 3b: fetch full world data for worlds that were reposted but whose
      // author is NOT in followeeIds (i.e. not already in originalRows)
      const originalIds = new Set(originalRows.map((w) => w.id));
      const repostOnlyIds = [...repostByWorld.keys()].filter(
        (id) => !originalIds.has(id)
      );

      const repostOnlyRows =
        repostOnlyIds.length === 0
          ? []
          : await db.query.worlds.findMany({
              where: inArray(worlds.id, repostOnlyIds),
              columns: {
                id: true,
                title: true,
                likesCount: true,
                views: true,
                createdAt: true,
              },
              with: {
                user: { columns: { username: true, avatarUrl: true } },
                media: {
                  where: (m, { or, eq: oreq }) =>
                    or(oreq(m.type, "thumbnail"), oreq(m.type, "video")),
                  limit: 2,
                  columns: { type: true, url: true },
                },
                tags: { with: { tag: { columns: { name: true } } } },
              },
            });

      // Step 4: world updates by followees
      const updateRows = await db
        .select({
          updateId: worldUpdates.id,
          updateBody: worldUpdates.body,
          updateCreatedAt: worldUpdates.createdAt,
          worldId: worldUpdates.worldId,
          worldTitle: worlds.title,
          worldGlbUrl: worlds.glbUrl,
          worldLikesCount: worlds.likesCount,
          worldViews: worlds.views,
          worldCreatedAt: worlds.createdAt,
          authorUsername: users.username,
          authorAvatarUrl: users.avatarUrl,
        })
        .from(worldUpdates)
        .innerJoin(worlds, eq(worlds.id, worldUpdates.worldId))
        .innerJoin(users, eq(users.id, worlds.userId))
        .where(inArray(worlds.userId, followeeIds))
        .orderBy(desc(worldUpdates.createdAt))
        .limit(50);

      // Step 5: fetch thumbnail/video media for the worlds referenced in updates
      const updateWorldIds = [...new Set(updateRows.map((u) => u.worldId))];
      const updateMediaRows =
        updateWorldIds.length === 0
          ? []
          : await db
              .select({
                worldId: worldMedia.worldId,
                type: worldMedia.type,
                url: worldMedia.url,
              })
              .from(worldMedia)
              .where(
                and(
                  inArray(worldMedia.worldId, updateWorldIds),
                  or(
                    eq(worldMedia.type, "thumbnail"),
                    eq(worldMedia.type, "video")
                  )
                )
              );

      const mediaByWorld = new Map<string, { type: string; url: string }[]>();
      for (const m of updateMediaRows) {
        if (!mediaByWorld.has(m.worldId)) mediaByWorld.set(m.worldId, []);
        mediaByWorld.get(m.worldId)!.push({ type: m.type, url: m.url });
      }

      // Step 5b: fetch tags for the worlds referenced in updates
      const updateTagRows =
        updateWorldIds.length === 0
          ? []
          : await db
              .select({
                worldId: worldTags.worldId,
                name: tagsTable.name,
              })
              .from(worldTags)
              .innerJoin(tagsTable, eq(tagsTable.id, worldTags.tagId))
              .where(inArray(worldTags.worldId, updateWorldIds));

      const tagsByWorld = new Map<string, { name: string }[]>();
      for (const t of updateTagRows) {
        if (!tagsByWorld.has(t.worldId)) tagsByWorld.set(t.worldId, []);
        tagsByWorld.get(t.worldId)!.push({ name: t.name });
      }

      // Flatten Drizzle relational tags shape { tag: { name } }[] → { name }[]
      type WithRawTags = Omit<(typeof originalRows)[number], "tags"> & {
        tags: { tag: { name: string } }[];
      };

      // Step 6: merge + sort by activityAt DESC, cap at 50
      const merged: FeedEntry[] = [
        ...(originalRows as unknown as WithRawTags[]).map((w) => {
          const flatTags = w.tags.map((wt) => ({ name: wt.tag.name }));
          const r = repostByWorld.get(w.id);
          // If a followee reposted this world AND the repost is more recent
          // than the original publish, surface it as a repost with that
          // activity timestamp. This also handles the case where a creator
          // reposts their own world.
          if (r && r.repostedAt > w.createdAt) {
            return {
              ...w,
              tags: flatTags,
              entryType: "repost" as const,
              activityAt: r.repostedAt,
              repostedBy: r.reposterUsername,
              updateBody: null,
              updateId: null,
            };
          }
          return {
            ...w,
            tags: flatTags,
            entryType: "original" as const,
            activityAt: w.createdAt,
            repostedBy: null,
            updateBody: null,
            updateId: null,
          };
        }),
        ...(repostOnlyRows as unknown as WithRawTags[]).map((w) => {
          const flatTags = w.tags.map((wt) => ({ name: wt.tag.name }));
          // Guaranteed: every id in repostOnlyIds has an entry in repostByWorld
          const r = repostByWorld.get(w.id)!;
          return {
            ...w,
            tags: flatTags,
            entryType: "repost" as const,
            activityAt: r.repostedAt,
            repostedBy: r.reposterUsername,
            updateBody: null,
            updateId: null,
          };
        }),
        ...updateRows.map((u) => ({
          entryType: "update" as const,
          id: u.worldId,
          title: u.worldTitle,
          likesCount: u.worldLikesCount,
          views: u.worldViews,
          createdAt: u.worldCreatedAt,
          user: { username: u.authorUsername, avatarUrl: u.authorAvatarUrl },
          media: mediaByWorld.get(u.worldId) ?? [],
          tags: tagsByWorld.get(u.worldId) ?? [],
          activityAt: u.updateCreatedAt,
          repostedBy: null,
          updateBody: u.updateBody,
          updateId: u.updateId,
        })),
      ];

      merged.sort((a, b) => b.activityAt.getTime() - a.activityAt.getTime());
      rows = merged.slice(0, 50);
    }
  } else {
    // Recent tab — original behavior
    const result = await db.query.worlds.findMany({
      orderBy: [desc(worlds.createdAt)],
      limit: 50,
      columns: {
        id: true,
        title: true,
        likesCount: true,
        views: true,
        createdAt: true,
      },
      with: {
        user: {
          columns: { username: true, avatarUrl: true },
        },
        media: {
          where: (m, { or, eq: oreq }) =>
            or(oreq(m.type, "thumbnail"), oreq(m.type, "video")),
          limit: 2,
          columns: { type: true, url: true },
        },
        tags: { with: { tag: { columns: { name: true } } } },
      },
    });
    // Recent tab has no repost attribution — activityAt equals createdAt, repostedBy is null
    rows = (result as unknown as Array<Omit<(typeof result)[number], "tags"> & { tags: { tag: { name: string } }[] }>).map((w) => ({
      ...w,
      tags: w.tags.map((wt) => ({ name: wt.tag.name })),
      entryType: "original" as const,
      activityAt: w.createdAt,
      repostedBy: null,
      updateBody: null,
      updateId: null,
    }));
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="sr-only">
        {activeTab === "following" ? "Following" : "Recent worlds"}
      </h1>

      {/* Tab bar */}
      <div
        className="mb-6 flex gap-1 border-b border-neutral-200 dark:border-neutral-800"
        role="tablist"
      >
        <TabLink href="/" active={activeTab === "recent"} label="Recent" />
        {clerkUserId && (
          <TabLink
            href="/?tab=following"
            active={activeTab === "following"}
            label="Following"
          />
        )}
      </div>

      {/* Grid or empty state */}
      {rows.length === 0 ? (
        <ContextualEmptyState activeTab={activeTab} />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((world) => (
            <li key={`${world.entryType}-${world.entryType === "update" ? world.updateId : world.id}`}>
              <FeedCard world={world} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// TabLink
// ---------------------------------------------------------------------------
function TabLink({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={`relative px-4 py-2 text-sm font-medium transition ${
        active
          ? "text-neutral-900 dark:text-neutral-100"
          : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-500 dark:hover:text-neutral-300"
      }`}
    >
      {label}
      {active && (
        <span
          aria-hidden
          className="absolute inset-x-0 -bottom-px h-0.5 bg-neutral-900 dark:bg-neutral-100"
        />
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// FeedCard
// ---------------------------------------------------------------------------
function FeedCard({ world }: { world: FeedEntry }) {
  const thumbnailUrl =
    world.media.find((m) => m.type === "thumbnail")?.url ?? null;
  const videoUrl = world.media.find((m) => m.type === "video")?.url ?? null;

  return (
    <div>
      {/* Repost attribution — shown above the card when a followed creator reposted this world */}
      {world.repostedBy && (
        <div className="mb-1 text-xs text-neutral-500 dark:text-neutral-400">
          Reposted by{" "}
          <span className="font-medium text-neutral-700 dark:text-neutral-300">
            @{world.repostedBy}
          </span>
        </div>
      )}
      {/* Update attribution — shown above the card when this entry is a world update */}
      {world.updateBody && (
        <div className="mb-1 text-xs text-neutral-500 dark:text-neutral-400">
          Update from{" "}
          <span className="font-medium text-neutral-700 dark:text-neutral-300">
            @{world.user.username}
          </span>
        </div>
      )}
      <Link
        href={`/world/${world.id}`}
        className="group block overflow-hidden rounded-lg border border-neutral-200 transition hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
      >
        {/* Media area — thumbnail by default; swaps to video preview on hover */}
        <WorldCardMedia
          thumbnailUrl={thumbnailUrl}
          videoUrl={videoUrl}
          alt={world.title}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
          likesCount={world.likesCount}
        />

        {/* Card body */}
        <div className="p-3">
          <h2 className="line-clamp-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {world.title}
          </h2>
          {/* Update body snippet — visually distinguishes update content from the world title */}
          {world.updateBody && (
            <p className="mt-1 line-clamp-2 text-xs text-neutral-600 dark:text-neutral-400">
              &quot;{world.updateBody}&quot;
            </p>
          )}
          {/* Tag chips — up to 3 visible, with +N overflow */}
          {world.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {world.tags.slice(0, 3).map((t) => (
                <TagChip key={t.name} name={t.name} size="small" />
              ))}
              {world.tags.length > 3 && (
                <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                  +{world.tags.length - 3} more
                </span>
              )}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            {world.user.avatarUrl && (
              <Image
                src={world.user.avatarUrl}
                width={20}
                height={20}
                className="rounded-full"
                alt=""
              />
            )}
            <span>{world.user.username}</span>
            <span aria-hidden>·</span>
            <span>
              {world.likesCount}{" "}
              {world.likesCount === 1 ? "like" : "likes"}
            </span>
          </div>
        </div>
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContextualEmptyState — different messages for global-empty vs following-empty
// ---------------------------------------------------------------------------
function ContextualEmptyState({
  activeTab,
}: {
  activeTab: "recent" | "following";
}) {
  if (activeTab === "following") {
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 py-24 text-center dark:border-neutral-700">
        <p className="text-lg font-medium text-neutral-700 dark:text-neutral-300">
          Your following feed is empty
        </p>
        <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
          Worlds from creators you follow will show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-neutral-300 py-24 text-center dark:border-neutral-700">
      <p className="text-lg font-medium text-neutral-700 dark:text-neutral-300">
        No worlds yet — be the first.
      </p>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        Upload a .glb world you&apos;ve made.
      </p>
      <Link
        href="/upload"
        className="mt-6 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 dark:focus-visible:ring-neutral-100"
      >
        Upload a world
      </Link>
    </div>
  );
}
