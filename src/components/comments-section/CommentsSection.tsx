"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { formatRelative } from "@/lib/format-relative";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Comment {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; username: string; avatarUrl: string | null };
}

interface GetCommentsResponse {
  comments: Comment[];
  nextCursor: string | null;
}

export interface CommentsSectionProps {
  worldId: string;
  worldOwnerId: string;
  initialCommentsCount: number;
  signedIn: boolean;
  /** null when signed out or no DB row */
  currentUserDbId: string | null;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CommentsSection({
  worldId,
  worldOwnerId,
  signedIn,
  currentUserDbId,
}: CommentsSectionProps) {
  const router = useRouter();

  // List state
  const [comments, setComments] = useState<Comment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Composer state
  const [composerBody, setComposerBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  // Load first page on mount
  useEffect(() => {
    void loadPage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId]);

  // ---------------------------------------------------------------------------
  // Fetch helpers
  // ---------------------------------------------------------------------------

  async function loadPage(cursor: string | null) {
    if (cursor === null) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setListError(null);

    try {
      const url = new URL(
        `/api/worlds/${worldId}/comments`,
        window.location.origin
      );
      url.searchParams.set("limit", "20");
      if (cursor) url.searchParams.set("cursor", cursor);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as GetCommentsResponse;

      // Full replace on initial load; append on load-more
      setComments((prev) =>
        cursor === null ? data.comments : [...prev, ...data.comments]
      );
      setNextCursor(data.nextCursor);
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Failed to load comments"
      );
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Submit a new comment
  // ---------------------------------------------------------------------------

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = composerBody.trim();
    if (!trimmed || posting) return;

    setPosting(true);
    setComposerError(null);

    try {
      const res = await fetch(`/api/worlds/${worldId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }

      const created = (await res.json()) as Comment;
      // Prepend the canonical server row so the author sees their comment first
      setComments((prev) => [created, ...prev]);
      setComposerBody("");
      // Re-fetch the server component so commentsCount in the title row updates
      router.refresh();
    } catch (err) {
      setComposerError(
        err instanceof Error ? err.message : "Failed to post comment"
      );
    } finally {
      setPosting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete a comment
  // ---------------------------------------------------------------------------

  async function deleteComment(commentId: string) {
    if (!window.confirm("Delete this comment?")) return;

    // Optimistic remove
    const previous = comments;
    setComments((prev) => prev.filter((c) => c.id !== commentId));

    try {
      const res = await fetch(`/api/comments/${commentId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Update server-rendered commentsCount
      router.refresh();
    } catch (err) {
      // Revert
      setComments(previous);
      alert(err instanceof Error ? err.message : "Failed to delete comment");
    }
  }

  // ---------------------------------------------------------------------------
  // Auth check for delete button
  // ---------------------------------------------------------------------------

  function canDelete(comment: Comment): boolean {
    if (!currentUserDbId) return false;
    return (
      comment.user.id === currentUserDbId ||
      worldOwnerId === currentUserDbId
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <section
      aria-labelledby="comments-heading"
      className="mt-12 border-t border-neutral-200 pt-8 dark:border-neutral-800"
    >
      <h2
        id="comments-heading"
        className="text-xl font-semibold text-neutral-900 dark:text-neutral-100"
      >
        Comments
      </h2>

      {/* ------------------------------------------------------------------ */}
      {/* Composer (or sign-in CTA)                                           */}
      {/* ------------------------------------------------------------------ */}

      {signedIn ? (
        <form onSubmit={submitComment} className="mt-4">
          <textarea
            value={composerBody}
            onChange={(e) => setComposerBody(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Share what you think about this world…"
            aria-label="Comment text"
            className="w-full rounded-md border border-neutral-300 bg-white p-3 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-100"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
            <span aria-live="polite">{composerBody.length} / 1000</span>
            <button
              type="submit"
              disabled={!composerBody.trim() || posting}
              className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {posting ? "Posting…" : "Post comment"}
            </button>
          </div>
          {composerError && (
            <p
              role="alert"
              className="mt-2 text-sm text-red-600 dark:text-red-400"
            >
              {composerError}
            </p>
          )}
        </form>
      ) : (
        <p className="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          <Link
            href={`/sign-in?redirect_url=/world/${worldId}`}
            className="underline hover:no-underline"
          >
            Sign in
          </Link>{" "}
          to comment.
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Comment list                                                        */}
      {/* ------------------------------------------------------------------ */}

      <div className="mt-8 space-y-6">
        {loading ? (
          /* Skeleton / loading state */
          <div aria-busy="true" className="space-y-4">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flex gap-3 animate-pulse">
                <div className="h-8 w-8 shrink-0 rounded-full bg-neutral-200 dark:bg-neutral-800" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 rounded bg-neutral-200 dark:bg-neutral-800" />
                  <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-800" />
                  <div className="h-3 w-4/5 rounded bg-neutral-200 dark:bg-neutral-800" />
                </div>
              </div>
            ))}
          </div>
        ) : listError ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            Couldn&apos;t load comments.{" "}
            <button
              onClick={() => loadPage(null)}
              className="underline hover:no-underline"
            >
              Retry
            </button>
          </p>
        ) : comments.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-500">
            No comments yet. Be the first.
          </p>
        ) : (
          comments.map((c) => (
            <article key={c.id} className="flex gap-3">
              {c.user.avatarUrl ? (
                <Image
                  src={c.user.avatarUrl}
                  alt={c.user.username}
                  width={32}
                  height={32}
                  className="h-8 w-8 shrink-0 rounded-full object-cover"
                />
              ) : (
                /* Fallback initials avatar */
                <div
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
                >
                  {c.user.username.charAt(0).toUpperCase()}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                  <Link
                    href={`/profile/${c.user.username}`}
                    className="font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                  >
                    {c.user.username}
                  </Link>
                  <time
                    dateTime={c.createdAt}
                    className="text-xs text-neutral-500 dark:text-neutral-500"
                  >
                    {formatRelative(c.createdAt)}
                  </time>
                  {canDelete(c) && (
                    <button
                      onClick={() => deleteComment(c.id)}
                      aria-label={`Delete comment by ${c.user.username}`}
                      title="Delete comment"
                      className="ml-auto text-xs text-neutral-400 hover:text-red-600 dark:text-neutral-600 dark:hover:text-red-400"
                    >
                      <TrashIcon />
                      <span className="sr-only">Delete</span>
                    </button>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-neutral-700 dark:text-neutral-300">
                  {c.body}
                </p>
              </div>
            </article>
          ))
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Load more                                                           */}
      {/* ------------------------------------------------------------------ */}

      {!loading && !listError && nextCursor && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => loadPage(nextCursor)}
            disabled={loadingMore}
            className="rounded-md border border-neutral-300 bg-white px-4 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}
