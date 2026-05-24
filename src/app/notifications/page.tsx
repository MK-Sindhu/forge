import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { getOrCreateDbUser } from "@/lib/users";
import { MarkAllReadOnView } from "./MarkAllReadOnView";
import { NotificationList } from "./NotificationList";
import type { NotificationItem } from "./NotificationList";

export const metadata = { title: "Notifications — FORGE" };

// ---------------------------------------------------------------------------
// Page (server component — auth-gated)
// ---------------------------------------------------------------------------
export default async function NotificationsPage() {
  // 1. Auth gate
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in?redirect_url=/notifications");
  }

  const clerkUser = await currentUser();
  if (!clerkUser) {
    redirect("/sign-in?redirect_url=/notifications");
  }

  // 2. Fetch DB user
  const dbUser = await getOrCreateDbUser(clerkUser);

  // 3. Fetch first page of notifications (inline DB query — avoids HTTP
  //    roundtrip + mirrors the GET /api/notifications logic exactly)
  const PAGE_LIMIT = 20;

  const rows = await db.query.notifications.findMany({
    where: eq(notifications.userId, dbUser.id),
    orderBy: [desc(notifications.createdAt)],
    limit: PAGE_LIMIT + 1, // +1 to detect next page
    with: {
      actor: {
        columns: { id: true, username: true, avatarUrl: true },
      },
      world: {
        columns: { id: true, title: true },
      },
      comment: {
        columns: { id: true, body: true },
      },
    },
  });

  const hasMore = rows.length > PAGE_LIMIT;
  const sliced = hasMore ? rows.slice(0, PAGE_LIMIT) : rows;
  const nextCursor = hasMore
    ? sliced[sliced.length - 1].createdAt.toISOString()
    : null;

  const firstPage: NotificationItem[] = sliced.map((r) => ({
    id: r.id,
    type: r.type as NotificationItem["type"],
    createdAt: r.createdAt.toISOString(),
    readAt: r.readAt ? r.readAt.toISOString() : null,
    actor: r.actor
      ? {
          id: r.actor.id,
          username: r.actor.username,
          avatarUrl: r.actor.avatarUrl ?? null,
        }
      : null,
    world: r.world ? { id: r.world.id, title: r.world.title } : null,
    comment: r.comment ? { id: r.comment.id, body: r.comment.body } : null,
  }));

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      {/* Auto mark-read after 1.5s */}
      <MarkAllReadOnView />

      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
        Notifications
      </h1>

      <NotificationList initial={firstPage} initialCursor={nextCursor} />
    </main>
  );
}
