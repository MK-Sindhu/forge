import Link from "next/link";
import Image from "next/image";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { worlds } from "@/db/schema";

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
  media: { url: string }[];
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
        where: (m, { eq }) => eq(m.type, "thumbnail"),
        limit: 1,
        columns: { url: true },
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
function NoThumbnail() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-neutral-400">
      No preview
    </div>
  );
}

function FeedCard({ world }: { world: FeedWorld }) {
  const thumbnailUrl = world.media[0]?.url ?? null;

  return (
    <Link
      href={`/world/${world.id}`}
      className="group block overflow-hidden rounded-lg border border-neutral-200 transition hover:border-neutral-400"
    >
      {/* Thumbnail — 16:9 cinematic ratio */}
      <div className="relative aspect-video bg-neutral-100">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt={world.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <NoThumbnail />
        )}
      </div>

      {/* Card body */}
      <div className="p-3">
        <h2 className="line-clamp-2 text-sm font-medium text-neutral-900">
          {world.title}
        </h2>
        <div className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
          {world.user.avatarUrl && (
            <Image
              src={world.user.avatarUrl}
              width={20}
              height={20}
              className="rounded-full"
              alt=""
              unoptimized
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
    <div className="rounded-lg border border-dashed border-neutral-300 py-24 text-center">
      <p className="text-lg font-medium text-neutral-700">
        No worlds yet — be the first.
      </p>
      <p className="mt-2 text-sm text-neutral-500">
        Upload a .glb world you&apos;ve made.
      </p>
      <Link
        href="/upload"
        className="mt-6 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
      >
        Upload a world
      </Link>
    </div>
  );
}
