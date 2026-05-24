"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { formatRelative } from "@/lib/format-relative";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorldUpdate {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
}

interface GetUpdatesResponse {
  updates: WorldUpdate[];
  nextCursor: string | null;
}

export interface UpdatesTimelineProps {
  worldId: string;
  /** True when the current signed-in user is the world owner. Controls all
   *  owner-only UI: composer, edit button, delete button. */
  isOwner: boolean;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function UpdatesTimeline({ worldId, isOwner }: UpdatesTimelineProps) {
  const router = useRouter();

  // List state
  const [updates, setUpdates] = useState<WorldUpdate[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Composer state (owner only)
  const [composerBody, setComposerBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  // Inline edit state
  // editingId: which update is in edit mode (null = none)
  // editDraft: the current textarea value for the editing item
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
        `/api/worlds/${worldId}/updates`,
        window.location.origin
      );
      url.searchParams.set("limit", "20");
      if (cursor) url.searchParams.set("cursor", cursor);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as GetUpdatesResponse;

      setUpdates((prev) =>
        cursor === null ? data.updates : [...prev, ...data.updates]
      );
      setNextCursor(data.nextCursor);
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Failed to load updates"
      );
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Submit a new update (owner only)
  // ---------------------------------------------------------------------------

  async function submitUpdate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = composerBody.trim();
    if (!trimmed || posting) return;

    setPosting(true);
    setComposerError(null);

    try {
      const res = await fetch(`/api/worlds/${worldId}/updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }

      const created = (await res.json()) as WorldUpdate;
      // Prepend the canonical server row so the owner sees their update first
      setUpdates((prev) => [created, ...prev]);
      setComposerBody("");
      // Invalidate any server-rendered cache
      router.refresh();
    } catch (err) {
      setComposerError(
        err instanceof Error ? err.message : "Failed to post update"
      );
    } finally {
      setPosting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Start inline edit
  // ---------------------------------------------------------------------------

  function startEdit(update: WorldUpdate) {
    setEditingId(update.id);
    setEditDraft(update.body);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft("");
    setEditError(null);
  }

  // ---------------------------------------------------------------------------
  // Save inline edit (owner only)
  // ---------------------------------------------------------------------------

  async function saveEdit(updateId: string) {
    const trimmed = editDraft.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setEditError(null);

    try {
      const res = await fetch(`/api/updates/${updateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errBody.error ?? `HTTP ${res.status}`);
      }

      const updatedItem = (await res.json()) as WorldUpdate;
      // Replace the local item with the server response (now has editedAt set)
      setUpdates((prev) =>
        prev.map((u) => (u.id === updateId ? updatedItem : u))
      );
      setEditingId(null);
      setEditDraft("");
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "Failed to save update"
      );
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete an update (owner only)
  // ---------------------------------------------------------------------------

  async function deleteUpdate(updateId: string) {
    if (!window.confirm("Delete this update?")) return;

    // Optimistic remove
    const previous = updates;
    setUpdates((prev) => prev.filter((u) => u.id !== updateId));

    try {
      const res = await fetch(`/api/updates/${updateId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      // Revert on failure
      setUpdates(previous);
      alert(err instanceof Error ? err.message : "Failed to delete update");
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <section
      aria-labelledby="updates-heading"
      className="mt-12 border-t border-neutral-200 pt-8 dark:border-neutral-800"
    >
      <h2
        id="updates-heading"
        className="text-xl font-semibold text-neutral-900 dark:text-neutral-100"
      >
        Updates
      </h2>

      {/* ------------------------------------------------------------------ */}
      {/* Composer (owner only)                                               */}
      {/* ------------------------------------------------------------------ */}

      {isOwner && (
        <form onSubmit={submitUpdate} className="mt-4">
          <textarea
            value={composerBody}
            onChange={(e) => setComposerBody(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Post an update about this world…"
            aria-label="Update text"
            className="w-full rounded-md border border-neutral-300 bg-white p-3 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-100"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
            <span aria-live="polite">{composerBody.length} / 2000</span>
            <button
              type="submit"
              disabled={!composerBody.trim() || posting}
              className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {posting ? "Posting…" : "Post update"}
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
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Updates list                                                         */}
      {/* ------------------------------------------------------------------ */}

      <div className="mt-8 space-y-6">
        {loading ? (
          /* Skeleton loading state */
          <div aria-busy="true" className="space-y-6">
            {[1, 2, 3].map((n) => (
              <div key={n} className="animate-pulse space-y-2">
                <div className="h-3 w-24 rounded bg-neutral-200 dark:bg-neutral-800" />
                <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-800" />
                <div className="h-3 w-4/5 rounded bg-neutral-200 dark:bg-neutral-800" />
                <div className="h-3 w-3/5 rounded bg-neutral-200 dark:bg-neutral-800" />
              </div>
            ))}
          </div>
        ) : listError ? (
          <p className="text-sm text-red-600 dark:text-red-400">
            Couldn&apos;t load updates.{" "}
            <button
              onClick={() => loadPage(null)}
              className="underline hover:no-underline"
            >
              Retry
            </button>
          </p>
        ) : updates.length === 0 ? (
          <p className="text-sm text-neutral-500 dark:text-neutral-500">
            No updates yet.
            {isOwner && " Post your first update above."}
          </p>
        ) : (
          updates.map((u) => (
            <article
              key={u.id}
              className="rounded-md border border-neutral-100 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900/50"
            >
              {/* Header row: timestamp, (edited) badge, owner actions */}
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-500">
                <time dateTime={u.createdAt}>
                  {formatRelative(u.createdAt)}
                </time>

                {u.editedAt && (
                  <span
                    title={`Edited ${formatRelative(u.editedAt)}`}
                    className="text-xs text-neutral-500 dark:text-neutral-500"
                  >
                    (edited)
                  </span>
                )}

                {/* Edit / Delete — owner only, never shown to non-owners */}
                {isOwner && editingId !== u.id && (
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => startEdit(u)}
                      aria-label="Edit update"
                      title="Edit update"
                      className="text-neutral-400 hover:text-neutral-700 dark:text-neutral-600 dark:hover:text-neutral-300"
                    >
                      <PencilIcon />
                      <span className="sr-only">Edit</span>
                    </button>
                    <button
                      onClick={() => deleteUpdate(u.id)}
                      aria-label="Delete update"
                      title="Delete update"
                      className="text-neutral-400 hover:text-red-600 dark:text-neutral-600 dark:hover:text-red-400"
                    >
                      <TrashIcon />
                      <span className="sr-only">Delete</span>
                    </button>
                  </span>
                )}
              </div>

              {/* Body — inline edit when this item is being edited */}
              {isOwner && editingId === u.id ? (
                <div>
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    maxLength={2000}
                    rows={5}
                    aria-label="Edit update text"
                    className="w-full rounded-md border border-neutral-300 bg-white p-3 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:focus:ring-neutral-100"
                  />
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      onClick={() => saveEdit(u.id)}
                      disabled={!editDraft.trim() || saving}
                      className="rounded-md bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={saving}
                      className="rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      Cancel
                    </button>
                    {editError && (
                      <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                        {editError}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm text-neutral-700 dark:text-neutral-300">
                  {u.body}
                </p>
              )}
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

function PencilIcon() {
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
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

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
