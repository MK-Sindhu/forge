import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { auth } from "@clerk/nextjs/server";
import { eq, and, count } from "drizzle-orm";
import { db } from "@/db";
import { users, follows } from "@/db/schema";
import { WorldCardMedia } from "@/components/world-card-media/WorldCardMedia";
import { FollowButton } from "@/components/follow-button/FollowButton";
import { TagChip } from "@/components/tag-chip/TagChip";
import { EditableWorldsSection } from "@/components/profile/EditableWorldsSection";
import { EditUsernameButton } from "@/components/profile/EditUsernameButton";

// ---------------------------------------------------------------------------
// generateMetadata — per-profile OG + Twitter Card tags
// ---------------------------------------------------------------------------
export async function generateMetadata(
  { params }: { params: Promise<{ username: string }> }
): Promise<Metadata> {
  const { username } = await params;

  // Lean query — only the columns OG tags need.
  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
    columns: { username: true, avatarUrl: true },
    with: {
      worlds: { columns: { id: true } },
    },
  });

  if (!user) {
    return { title: "Profile not found" };
  }

  const worldCount = user.worlds.length;
  const description = `@${user.username} — ${worldCount} ${worldCount === 1 ? "world" : "worlds"} on FORGE.`;

  return {
    title: `@${user.username}`,
    description,
    openGraph: {
      type: "profile",
      title: `@${user.username}`,
      description,
      url: `/profile/${user.username}`,
      images: user.avatarUrl
        ? [{ url: user.avatarUrl, alt: user.username }]
        : [],
    },
    twitter: {
      card: "summary",
      title: `@${user.username}`,
      description,
      images: user.avatarUrl ? [user.avatarUrl] : [],
    },
  };
}

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
          tags: { with: { tag: { columns: { name: true } } } },
        },
      },
    },
  });

  if (!user) {
    notFound();
  }

  // --- Follow counts (computed on read; no denormalized column yet) ---------
  const [followerCountResult] = await db
    .select({ count: count() })
    .from(follows)
    .where(eq(follows.followeeId, user.id));
  const [followingCountResult] = await db
    .select({ count: count() })
    .from(follows)
    .where(eq(follows.followerId, user.id));

  const followerCount = Number(followerCountResult.count);
  const followingCount = Number(followingCountResult.count);

  // --- Auth-aware state -----------------------------------------------------
  const { userId: clerkUserId } = await auth();
  let isFollowedByCurrentUser = false;
  let isOwnProfile = false;

  if (clerkUserId) {
    const [currentDbUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);

    if (currentDbUser) {
      isOwnProfile = currentDbUser.id === user.id;
      if (!isOwnProfile) {
        const [followRow] = await db
          .select({ followerId: follows.followerId })
          .from(follows)
          .where(
            and(
              eq(follows.followerId, currentDbUser.id),
              eq(follows.followeeId, user.id)
            )
          )
          .limit(1);
        isFollowedByCurrentUser = !!followRow;
      }
    }
  }

  const signedIn = !!clerkUserId;

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
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{user.username}</h1>
            <EditUsernameButton
              currentUsername={user.username}
              isOwnProfile={isOwnProfile}
            />
            {!isOwnProfile && (
              <FollowButton
                username={user.username}
                initialFollowing={isFollowedByCurrentUser}
                signedIn={signedIn}
              />
            )}
          </div>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            {user.worlds.length}{" "}
            {user.worlds.length === 1 ? "world" : "worlds"}
            {" · "}
            {followerCount}{" "}
            {followerCount === 1 ? "follower" : "followers"}
            {" · "}
            {followingCount} following
            {" · "}
            joined {new Date(user.createdAt).toLocaleDateString()}
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
                    likesCount={world.likesCount}
                  />
                  <div className="p-3">
                    <h2 className="line-clamp-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {world.title}
                    </h2>
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
      )}

      {/* Worlds where this user is a collaborator (editor role) */}
      <EditableWorldsSection
        username={user.username}
        userId={user.id}
        isSelf={isOwnProfile}
      />
    </main>
  );
}
