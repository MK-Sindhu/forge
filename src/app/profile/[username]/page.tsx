import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { WorldCardMedia } from "@/components/world-card-media/WorldCardMedia";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
    columns: { id: true, username: true, avatarUrl: true, createdAt: true },
    with: {
      worlds: {
        orderBy: (w, { desc }) => [desc(w.createdAt)],
        columns: {
          id: true,
          title: true,
          createdAt: true,
          likesCount: true,
          views: true,
        },
        with: {
          media: {
            where: (m, { or, eq }) => or(eq(m.type, "thumbnail"), eq(m.type, "video")),
            limit: 2,
            columns: { type: true, url: true },
          },
        },
      },
    },
  });

  if (!user) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {/* Profile header */}
      <header className="mb-8 flex items-center gap-4">
        {user.avatarUrl && (
          <Image
            src={user.avatarUrl}
            alt={user.username}
            width={64}
            height={64}
            className="rounded-full"
          />
        )}
        <div>
          <h1 className="text-2xl font-semibold">{user.username}</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {user.worlds.length}{" "}
            {user.worlds.length === 1 ? "world" : "worlds"} · joined{" "}
            {new Date(user.createdAt).toLocaleDateString()}
          </p>
        </div>
      </header>

      {/* Worlds grid or empty state */}
      {user.worlds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 py-16 text-center dark:border-neutral-700">
          <p className="text-neutral-600 dark:text-neutral-400">No worlds yet.</p>
          <p className="mt-2 text-sm text-neutral-400 dark:text-neutral-600">
            Worlds published by {user.username} will appear here.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {user.worlds.map((world) => {
            const thumbnailUrl = world.media.find((m) => m.type === "thumbnail")?.url ?? null;
            const videoUrl = world.media.find((m) => m.type === "video")?.url ?? null;
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
                  />
                  <div className="p-3">
                    <h2 className="line-clamp-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {world.title}
                    </h2>
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
      )}
    </main>
  );
}
