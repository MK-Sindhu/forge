// Server component — no "use client" directive needed
// Fetches worlds where `userId` is a collaborator (editor role) and renders
// them as a thumbnail grid mirroring the owned-worlds grid on the profile page.

import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { worldCollaborators } from "@/db/schema";
import { WorldCardMedia } from "@/components/world-card-media/WorldCardMedia";
import { TagChip } from "@/components/tag-chip/TagChip";

interface Props {
  username: string;  // profile owner's username (used in heading copy)
  userId: string;    // their dbUser.id — used to query worldCollaborators
  isSelf: boolean;   // true when the viewer is looking at their own profile
}

export async function EditableWorldsSection({ username, userId, isSelf }: Props) {
  // Fetch all worlds where this user is a collaborator, newest-first, cap 50
  const rows = await db.query.worldCollaborators.findMany({
    where: eq(worldCollaborators.userId, userId),
    orderBy: [desc(worldCollaborators.addedAt)],
    limit: 50,
    with: {
      world: {
        columns: {
          id: true,
          title: true,
          createdAt: true,
          likesCount: true,
          views: true,
        },
        with: {
          media: {
            where: (m, { or, eq: meq }) =>
              or(meq(m.type, "thumbnail"), meq(m.type, "video")),
            limit: 2,
            columns: { type: true, url: true },
          },
          tags: { with: { tag: { columns: { name: true } } } },
        },
      },
    },
  });

  // Don't render anything if there are no collab worlds — keeps profiles clean
  if (rows.length === 0) return null;

  const heading = isSelf
    ? "Worlds you can edit"
    : `Worlds @${username} can edit`;

  return (
    <section className="mt-10" aria-labelledby="editable-worlds-heading">
      <h2
        id="editable-worlds-heading"
        className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100"
      >
        {heading}
      </h2>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {rows.map(({ world }) => {
          const thumbnailUrl =
            world.media.find((m) => m.type === "thumbnail")?.url ?? null;
          const videoUrl =
            world.media.find((m) => m.type === "video")?.url ?? null;

          return (
            <li key={world.id}>
              <Link
                href={`/world/${world.id}`}
                className="group block overflow-hidden rounded-lg border border-neutral-200 transition hover:border-neutral-400 dark:border-neutral-800 dark:hover:border-neutral-600"
              >
                <WorldCardMedia
                  thumbnailUrl={thumbnailUrl}
                  videoUrl={videoUrl}
                  alt={world.title}
                  sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                  aspectRatio="square"
                  likesCount={world.likesCount}
                />
                <div className="p-3">
                  <h3 className="line-clamp-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {world.title}
                  </h3>
                  {world.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {world.tags.slice(0, 3).map((wt) => (
                        <TagChip key={wt.tag.name} name={wt.tag.name} size="small" />
                      ))}
                      {world.tags.length > 3 && (
                        <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                          +{world.tags.length - 3} more
                        </span>
                      )}
                    </div>
                  )}
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {world.likesCount}{" "}
                    {world.likesCount === 1 ? "like" : "likes"} ·{" "}
                    {world.views} {world.views === 1 ? "view" : "views"}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
