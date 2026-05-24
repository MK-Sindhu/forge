import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { worlds, users, follows } from "@/db/schema";
import { WorldCardMedia } from "@/components/world-card-media/WorldCardMedia";

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
};

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
  let rows: FeedWorld[];

  if (activeTab === "following") {
    // Step 1: look up followee IDs
    const followeeRows = currentDbUserId
      ? await db
          .select({ id: follows.followeeId })
          .from(follows)
          .where(eq(follows.followerId, currentDbUserId))
      : [];

    const followeeIds = followeeRows.map((r) => r.id);

    // Step 2: fetch their worlds (or short-circuit to empty)
    if (followeeIds.length === 0) {
      rows = [];
    } else {
      const result = await db.query.worlds.findMany({
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
          user: {
            columns: { username: true, avatarUrl: true },
          },
          media: {
            where: (m, { or, eq: oreq }) =>
              or(oreq(m.type, "thumbnail"), oreq(m.type, "video")),
            limit: 2,
            columns: { type: true, url: true },
          },
        },
      });
      rows = result as FeedWorld[];
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
      },
    });
    rows = result as FeedWorld[];
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
            <li key={world.id}>
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
function FeedCard({ world }: { world: FeedWorld }) {
  const thumbnailUrl =
    world.media.find((m) => m.type === "thumbnail")?.url ?? null;
  const videoUrl = world.media.find((m) => m.type === "video")?.url ?? null;

  return (
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
