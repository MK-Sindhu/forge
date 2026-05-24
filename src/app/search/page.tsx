import Link from "next/link";
import Image from "next/image";
import { and, desc, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { worlds, tags as tagsTable, worldTags } from "@/db/schema";
import { WorldCardMedia } from "@/components/world-card-media/WorldCardMedia";
import { TagChip } from "@/components/tag-chip/TagChip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type SearchWorld = {
  id: string;
  title: string;
  likesCount: number;
  views: number;
  createdAt: Date;
  user: { username: string; avatarUrl: string | null };
  media: { type: string; url: string }[];
  tags: { name: string }[];
};

// ---------------------------------------------------------------------------
// Page (server component — no 'use client')
// ---------------------------------------------------------------------------
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;

  // Normalize q: take first value if array, trim, treat empty string as absent
  const rawQ = Array.isArray(params.q) ? params.q[0] : params.q;
  const q = rawQ?.trim() ?? "";

  // Normalize tag: take first value if array, trim + lowercase
  const rawTag = Array.isArray(params.tag) ? params.tag[0] : params.tag;
  const tagName = rawTag?.trim().toLowerCase() ?? "";

  const hasQ = q.length > 0;
  const hasTag = tagName.length > 0;

  // ---------------------------------------------------------------------------
  // Branch: neither present — empty state
  // ---------------------------------------------------------------------------
  if (!hasQ && !hasTag) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          Search worlds
        </h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Type a query in the header to find worlds, or click a tag chip to browse by tag.
        </p>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Tag lookup (shared by tag-only and both branches)
  // ---------------------------------------------------------------------------
  let tagId: string | null = null;
  if (hasTag) {
    const [tagRow] = await db
      .select({ id: tagsTable.id })
      .from(tagsTable)
      .where(eq(tagsTable.name, tagName))
      .limit(1);
    tagId = tagRow?.id ?? null;
  }

  // If a tag was requested but does not exist in the DB, show a not-found state.
  if (hasTag && tagId === null) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          {hasQ ? `Results for "${q}" in #${tagName}` : `Worlds tagged #${tagName}`}
        </h1>
        <p className="mt-4 text-neutral-600 dark:text-neutral-400">
          No worlds tagged with #{tagName} yet.
        </p>
      </main>
    );
  }

  // ---------------------------------------------------------------------------
  // Build the where condition for the DB query
  // ---------------------------------------------------------------------------
  // Subquery that returns world IDs for a given tag
  const tagSubquery = tagId
    ? db
        .select({ id: worldTags.worldId })
        .from(worldTags)
        .where(eq(worldTags.tagId, tagId))
    : null;

  // ---------------------------------------------------------------------------
  // Branch: q only
  // ---------------------------------------------------------------------------
  let rows: SearchWorld[];

  if (hasQ && !hasTag) {
    const raw = await db.query.worlds.findMany({
      where: sql`search_vector @@ websearch_to_tsquery('english', ${q})`,
      orderBy: sql`ts_rank(search_vector, websearch_to_tsquery('english', ${q})) DESC, ${worlds.createdAt} DESC`,
      limit: 50,
      columns: { id: true, title: true, likesCount: true, views: true, createdAt: true },
      with: {
        user: { columns: { username: true, avatarUrl: true } },
        media: {
          where: (m, { or, eq: meq }) => or(meq(m.type, "thumbnail"), meq(m.type, "video")),
          limit: 2,
          columns: { type: true, url: true },
        },
        tags: { with: { tag: { columns: { name: true } } } },
      },
    });
    rows = flattenTags(raw);
  }
  // ---------------------------------------------------------------------------
  // Branch: tag only
  // ---------------------------------------------------------------------------
  else if (!hasQ && hasTag) {
    const raw = await db.query.worlds.findMany({
      where: inArray(worlds.id, tagSubquery!),
      orderBy: [desc(worlds.createdAt)],
      limit: 50,
      columns: { id: true, title: true, likesCount: true, views: true, createdAt: true },
      with: {
        user: { columns: { username: true, avatarUrl: true } },
        media: {
          where: (m, { or, eq: meq }) => or(meq(m.type, "thumbnail"), meq(m.type, "video")),
          limit: 2,
          columns: { type: true, url: true },
        },
        tags: { with: { tag: { columns: { name: true } } } },
      },
    });
    rows = flattenTags(raw);
  }
  // ---------------------------------------------------------------------------
  // Branch: both q and tag — intersection
  // ---------------------------------------------------------------------------
  else {
    const raw = await db.query.worlds.findMany({
      where: and(
        sql`search_vector @@ websearch_to_tsquery('english', ${q})`,
        inArray(worlds.id, tagSubquery!)
      ),
      orderBy: sql`ts_rank(search_vector, websearch_to_tsquery('english', ${q})) DESC, ${worlds.createdAt} DESC`,
      limit: 50,
      columns: { id: true, title: true, likesCount: true, views: true, createdAt: true },
      with: {
        user: { columns: { username: true, avatarUrl: true } },
        media: {
          where: (m, { or, eq: meq }) => or(meq(m.type, "thumbnail"), meq(m.type, "video")),
          limit: 2,
          columns: { type: true, url: true },
        },
        tags: { with: { tag: { columns: { name: true } } } },
      },
    });
    rows = flattenTags(raw);
  }

  // ---------------------------------------------------------------------------
  // Heading based on which params are active
  // ---------------------------------------------------------------------------
  let heading: string;
  if (hasQ && hasTag) {
    heading = `Results for "${q}" in #${tagName}`;
  } else if (hasQ) {
    heading = `Search results for "${q}"`;
  } else {
    heading = `Worlds tagged #${tagName}`;
  }

  // ---------------------------------------------------------------------------
  // Result count description
  // ---------------------------------------------------------------------------
  const resultSummary =
    rows.length === 50
      ? "Showing 50 results — refine your search to see more"
      : `${rows.length} ${rows.length === 1 ? "result" : "results"}`;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
        {heading}
      </h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        {resultSummary}
      </p>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-neutral-300 py-24 text-center dark:border-neutral-700">
          <p className="text-lg font-medium text-neutral-700 dark:text-neutral-300">
            No worlds match your search.
          </p>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
            Try different keywords.
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((world) => (
            <li key={world.id}>
              <SearchCard world={world} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flatten Drizzle relational tags shape { tag: { name } }[] → { name }[] */
function flattenTags<T extends { tags: { tag: { name: string } }[] }>(
  rows: T[]
): (Omit<T, "tags"> & { tags: { name: string }[] })[] {
  return rows.map((row) => ({
    ...row,
    tags: row.tags.map((wt) => ({ name: wt.tag.name })),
  }));
}

// ---------------------------------------------------------------------------
// SearchCard — mirrors FeedCard markup exactly (v1: duplicate, not extract)
// ---------------------------------------------------------------------------
function SearchCard({ world }: { world: SearchWorld }) {
  const thumbnailUrl = world.media.find((m) => m.type === "thumbnail")?.url ?? null;
  const videoUrl = world.media.find((m) => m.type === "video")?.url ?? null;

  return (
    <Link
      href={`/world/${world.id}`}
      className="group block overflow-hidden rounded-lg border border-neutral-200 transition hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
    >
      <WorldCardMedia
        thumbnailUrl={thumbnailUrl}
        videoUrl={videoUrl}
        alt={world.title}
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
        likesCount={world.likesCount}
      />

      <div className="p-3">
        <h2 className="line-clamp-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {world.title}
        </h2>

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
            {world.likesCount} {world.likesCount === 1 ? "like" : "likes"}
          </span>
          <span aria-hidden>·</span>
          <span>
            {world.views} {world.views === 1 ? "view" : "views"}
          </span>
        </div>
      </div>
    </Link>
  );
}
