"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { formatRelative } from "@/lib/format-relative";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VersionAuthor {
  id: string;
  username: string;
  avatarUrl: string | null;
}

interface WorldVersion {
  id: string;
  versionNumber: number;
  status: "draft" | "published";
  label: string | null;
  parentVersionId: string | null;
  createdAt: string;
  author: VersionAuthor;
}

interface VersionsResponse {
  versions: WorldVersion[];
  nextCursor: string | null;
}

interface Props {
  worldId: string;
  /** The currently-live version id from worlds.published_version_id; null if none. */
  publishedVersionId: string | null;
  /** True when the current signed-in user is the world owner. Controls Publish buttons. */
  isOwner: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VersionHistorySection({
  worldId,
  publishedVersionId: initialPublishedVersionId,
  isOwner,
}: Props) {
  const router = useRouter();

  // Versions list state
  const [versions, setVersions] = useState<WorldVersion[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  // Optimistic published-version tracking
  const [publishedVersionId, setPublishedVersionId] = useState(
    initialPublishedVersionId
  );

  // Per-version publish action state
  const [publishingVersionId, setPublishingVersionId] = useState<string | null>(
    null
  );
  const [publishError, setPublishError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Initial fetch
  // ---------------------------------------------------------------------------

  async function fetchVersions() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/worlds/${worldId}/versions`);
      if (!res.ok) {
        throw new Error(`Server error (${res.status})`);
      }
      const data: VersionsResponse = await res.json();
      setVersions(data.versions);
      setNextCursor(data.nextCursor);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load versions"
      );
    } finally {
      setLoading(false);
    }
  }

  // Load on mount. fetchVersions is defined in component scope; worldId is
  // stable for the lifetime of the component instance (page routing replaces
  // the whole component, not re-renders with a new worldId).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId]);

  // ---------------------------------------------------------------------------
  // Load more
  // ---------------------------------------------------------------------------

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const res = await fetch(
        `/api/worlds/${worldId}/versions?cursor=${encodeURIComponent(nextCursor)}`
      );
      if (!res.ok) throw new Error(`Server error (${res.status})`);
      const data: VersionsResponse = await res.json();
      setVersions((prev) => [...prev, ...data.versions]);
      setNextCursor(data.nextCursor);
    } catch (err) {
      setLoadMoreError(
        err instanceof Error ? err.message : "Failed to load more versions"
      );
    } finally {
      setLoadingMore(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Publish a version
  // ---------------------------------------------------------------------------

  async function handlePublish(version: WorldVersion) {
    if (publishingVersionId) return;

    // Optimistic update — swap published pill immediately
    const prevPublishedId = publishedVersionId;
    setPublishedVersionId(version.id);
    setPublishingVersionId(version.id);
    setPublishError(null);

    try {
      const res = await fetch(
        `/api/worlds/${worldId}/versions/${version.id}/publish`,
        { method: "POST" }
      );
      if (!res.ok) {
        throw new Error(`Server error (${res.status})`);
      }
      // Success — trigger a server re-render to keep other parts of the page in
      // sync (e.g. the world's published_version_id in the outer server component)
      router.refresh();
    } catch (err) {
      // Revert optimistic update
      setPublishedVersionId(prevPublishedId);
      setPublishError(
        err instanceof Error ? err.message : "Publish failed — please try again"
      );
    } finally {
      setPublishingVersionId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function StatusPill({ version }: { version: WorldVersion }) {
    const isCurrent = version.id === publishedVersionId;
    if (isCurrent) {
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950/40 dark:text-green-300">
          Currently published
        </span>
      );
    }
    if (version.status === "published") {
      return (
        <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
          Published
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500">
        Draft
      </span>
    );
  }

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  return (
    <section className="mt-8" aria-labelledby="version-history-heading">
      <div className="mb-3">
        <h2
          id="version-history-heading"
          className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
        >
          Version history
        </h2>
        <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          Every save creates an immutable snapshot. The currently-published
          version is what visitors see. (Browsing past versions is coming soon.)
        </p>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div
          aria-label="Loading versions"
          className="space-y-2"
        >
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800"
            />
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/20"
        >
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          <button
            type="button"
            onClick={fetchVersions}
            className="mt-2 text-sm text-red-600 underline hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && versions.length === 0 && (
        <p className="rounded-lg border border-dashed border-neutral-300 px-6 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          No versions yet. Convert this world or use the editor (coming soon)
          to create one.
        </p>
      )}

      {/* Version list */}
      {!loading && !error && versions.length > 0 && (
        <>
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700">
            {versions.map((v) => {
              const isCurrent = v.id === publishedVersionId;
              const isPublishing = publishingVersionId === v.id;

              return (
                <li
                  key={v.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  {/* Left: version info */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium text-sm text-neutral-900 dark:text-neutral-100">
                      Version {v.versionNumber}
                    </span>
                    {v.label && (
                      <span className="text-sm text-neutral-500 dark:text-neutral-400">
                        &middot; {v.label}
                      </span>
                    )}
                    <StatusPill version={v} />
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">
                      &middot;{" "}
                      <span title={v.createdAt}>
                        {formatRelative(v.createdAt)}
                      </span>
                      {" "}by{" "}
                      <a
                        href={`/profile/${v.author.username}`}
                        className="hover:underline"
                      >
                        @{v.author.username}
                      </a>
                    </span>
                  </div>

                  {/* Right: owner actions */}
                  {isOwner && !isCurrent && (
                    <button
                      type="button"
                      onClick={() => handlePublish(v)}
                      disabled={!!publishingVersionId}
                      aria-busy={isPublishing}
                      className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 transition hover:border-neutral-400 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                    >
                      {isPublishing ? "Publishing…" : "Publish"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Publish error */}
          {publishError && (
            <p
              role="alert"
              className="mt-2 text-xs text-red-600 dark:text-red-400"
            >
              {publishError}
            </p>
          )}

          {/* Load more */}
          {nextCursor && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 transition hover:border-neutral-400 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-neutral-600 dark:hover:bg-neutral-900"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}

          {/* Load more error */}
          {loadMoreError && (
            <p
              role="alert"
              className="mt-2 text-center text-xs text-red-600 dark:text-red-400"
            >
              {loadMoreError}
            </p>
          )}
        </>
      )}
    </section>
  );
}
