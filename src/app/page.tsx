import Link from "next/link";
import Image from "next/image";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { worlds } from "@/db/schema";
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
export default async function FeedPage() {
  const rows = await db.query.worlds.findMany({
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
        where: (m, { or, eq }) => or(eq(m.type, "thumbnail"), eq(m.type, "video")),
        limit: 2,
        columns: { type: true, url: true },
      },
    },
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      {/* visually hidden heading for screen readers / document outline */}
      <h1 className="sr-only">Recent worlds</h1>

      {rows.length === 0 ? (
        <EmptyState />
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
// EmptyState — shown when FORGE has zero worlds
// ---------------------------------------------------------------------------
function EmptyState() {
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
