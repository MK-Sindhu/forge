import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

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
            // Filter to thumbnail rows only at the query level.
            // Drizzle 0.45.x relational API supports `where` inside `with`.
            where: (m, { eq: deq }) => deq(m.type, "thumbnail"),
            limit: 1,
            columns: { url: true },
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
            unoptimized
          />
        )}
        <div>
          <h1 className="text-2xl font-semibold">{user.username}</h1>
          <p className="text-sm text-neutral-600">
            {user.worlds.length}{" "}
            {user.worlds.length === 1 ? "world" : "worlds"} · joined{" "}
            {new Date(user.createdAt).toLocaleDateString()}
          </p>
        </div>
      </header>

      {/* Worlds grid or empty state */}
      {user.worlds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 py-16 text-center">
          <p className="text-neutral-600">No worlds yet.</p>
          <p className="mt-2 text-sm text-neutral-400">
            Worlds published by {user.username} will appear here.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {user.worlds.map((world) => {
            // `media` is filtered to thumbnail rows at the query level.
            // If no thumbnail row exists for a world, this will be undefined —
            // the placeholder div below handles that case gracefully.
            const thumbnailUrl = world.media[0]?.url;
            return (
              <li key={world.id}>
                <Link
                  href={`/world/${world.id}`}
                  className="group block overflow-hidden rounded-lg border border-neutral-200 transition hover:border-neutral-400"
                >
                  <div className="relative aspect-square bg-neutral-100">
                    {thumbnailUrl ? (
                      <Image
                        src={thumbnailUrl}
                        alt={world.title}
                        fill
                        sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 25vw"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-neutral-400">
                        No thumbnail
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <h2 className="line-clamp-2 text-sm font-medium text-neutral-900">
                      {world.title}
                    </h2>
                    <p className="mt-1 text-xs text-neutral-500">
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
