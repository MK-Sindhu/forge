"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatRelative } from "@/lib/format-relative";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface NotificationItem {
  id: string;
  type: "like" | "comment" | "follow" | "new_world";
  createdAt: string;
  readAt: string | null;
  actor: { id: string; username: string; avatarUrl: string | null } | null;
  world: { id: string; title: string } | null;
  comment: { id: string; body: string } | null;
}

interface Props {
  initial: NotificationItem[];
  initialCursor: string | null;
}

// ---------------------------------------------------------------------------
// Helper — build the notification message + destination href
// ---------------------------------------------------------------------------
function renderNotification(n: NotificationItem): {
  message: React.ReactNode;
  href: string;
} {
  const actorName = n.actor ? `@${n.actor.username}` : "Someone";
  const worldTitle = n.world?.title ?? "a world";

  switch (n.type) {
    case "like":
      return {
        message: (
          <>
            <span className="font-semibold">{actorName}</span> liked your world{" "}
            <span className="font-semibold">{worldTitle}</span>
          </>
        ),
        href: n.world ? `/world/${n.world.id}` : "/",
      };
    case "comment": {
      const snippet = n.comment?.body
        ? n.comment.body.length > 80
          ? n.comment.body.slice(0, 80) + "…"
          : n.comment.body
        : "";
      return {
        message: (
          <>
            <span className="font-semibold">{actorName}</span> commented on{" "}
            <span className="font-semibold">{worldTitle}</span>
            {snippet ? (
              <>
                {": "}
                <span className="text-neutral-500 dark:text-neutral-400">
                  {snippet}
                </span>
              </>
            ) : null}
          </>
        ),
        href: n.world ? `/world/${n.world.id}#comments` : "/",
      };
    }
    case "follow":
      return {
        message: (
          <>
            <span className="font-semibold">{actorName}</span> started following
            you
          </>
        ),
        href: n.actor ? `/profile/${n.actor.username}` : "/",
      };
    case "new_world":
      return {
        message: (
          <>
            <span className="font-semibold">{actorName}</span> published a new
            world:{" "}
            <span className="font-semibold">{worldTitle}</span>
          </>
        ),
        href: n.world ? `/world/${n.world.id}` : "/",
      };
    default:
      return { message: "New notification", href: "/" };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function NotificationList({ initial, initialCursor }: Props) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/notifications?cursor=${encodeURIComponent(cursor)}`
      );
      if (!res.ok) throw new Error("Failed to load more notifications");
      const data = await res.json();
      setItems((prev) => [...prev, ...data.notifications]);
      setCursor(data.nextCursor);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load notifications"
      );
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 px-6 py-12 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        No notifications yet. When someone likes or comments on your worlds,
        you&apos;ll see it here.
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
        {items.map((n) => {
          const { message, href } = renderNotification(n);
          const isUnread = n.readAt === null;

          return (
            <li key={n.id}>
              <Link
                href={href}
                className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900 ${
                  isUnread
                    ? "border-l-2 border-l-red-500 bg-red-50/40 dark:bg-red-950/20"
                    : ""
                }`}
              >
                {/* Actor avatar */}
                {n.actor?.avatarUrl ? (
                  <Image
                    src={n.actor.avatarUrl}
                    alt={`${n.actor.username} avatar`}
                    width={36}
                    height={36}
                    className="mt-0.5 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="mt-0.5 h-9 w-9 shrink-0 rounded-full bg-neutral-200 dark:bg-neutral-700"
                  />
                )}

                {/* Message + timestamp */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug text-neutral-900 dark:text-neutral-100">
                    {message}
                  </p>
                  <time
                    dateTime={n.createdAt}
                    className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400"
                  >
                    {formatRelative(n.createdAt)}
                  </time>
                </div>

                {/* Unread dot */}
                {isUnread && (
                  <span
                    aria-label="Unread"
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Load more */}
      {cursor && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loading}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:bg-neutral-900"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <p
          role="alert"
          className="mt-3 text-center text-sm text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}
    </>
  );
}
