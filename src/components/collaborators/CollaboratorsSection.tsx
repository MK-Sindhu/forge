"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { formatRelative } from "@/lib/format-relative";
import {
  InviteCollaboratorDialog,
  type CollaboratorRow,
} from "./InviteCollaboratorDialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OwnerRow {
  id: string;
  username: string;
  avatarUrl: string | null;
}

interface CollaboratorsResponse {
  owner: OwnerRow;
  collaborators: CollaboratorRow[];
}

interface Props {
  worldId: string;
  /** True if the current signed-in user is the world owner. */
  isOwner: boolean;
  /** dbUser.id of the current viewer, or null if signed out. */
  currentUserId: string | null;
}

// ---------------------------------------------------------------------------
// Avatar helper
// ---------------------------------------------------------------------------

function Avatar({
  avatarUrl,
  username,
}: {
  avatarUrl: string | null;
  username: string;
}) {
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt={username}
        width={32}
        height={32}
        className="rounded-full shrink-0"
      />
    );
  }
  return (
    <div
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
    >
      {username.slice(0, 1).toUpperCase()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CollaboratorsSection({ worldId, isOwner, currentUserId }: Props) {
  const router = useRouter();

  const [owner, setOwner] = useState<OwnerRow | null>(null);
  const [collaborators, setCollaborators] = useState<CollaboratorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  async function fetchCollaborators() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/worlds/${worldId}/collaborators`);
      if (!res.ok) {
        throw new Error(`Server error (${res.status})`);
      }
      const data: CollaboratorsResponse = await res.json();
      setOwner(data.owner);
      setCollaborators(data.collaborators);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load collaborators"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchCollaborators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId]);

  // ---------------------------------------------------------------------------
  // Invite success — append new row
  // ---------------------------------------------------------------------------

  function handleInviteSuccess(newRow: CollaboratorRow) {
    setCollaborators((prev) => [...prev, newRow]);
  }

  // ---------------------------------------------------------------------------
  // Remove / Leave
  // ---------------------------------------------------------------------------

  async function handleRemove(collab: CollaboratorRow) {
    const isSelf = collab.id === currentUserId;
    const confirmed = window.confirm(
      isSelf
        ? "Stop collaborating on this world?"
        : `Remove @${collab.username} as a collaborator?`
    );
    if (!confirmed) return;
    if (removingId) return;

    setRemovingId(collab.id);
    setActionError(null);

    try {
      const res = await fetch(
        `/api/worlds/${worldId}/collaborators/${collab.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        throw new Error(`Server error (${res.status})`);
      }
      if (isSelf) {
        // Collaborator left — they can no longer edit, redirect to the world view
        router.push(`/world/${worldId}`);
        return;
      }
      // Owner removed someone — splice from local state
      setCollaborators((prev) => prev.filter((c) => c.id !== collab.id));
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Couldn't remove collaborator"
      );
    } finally {
      setRemovingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function RoleBadge({ role }: { role: string }) {
    if (role === "editor") {
      return (
        <span className="inline-flex items-center rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300">
          Editor
        </span>
      );
    }
    // Fallback for unknown roles
    return (
      <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
        {role}
      </span>
    );
  }

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  return (
    <section className="mt-8" aria-labelledby="collaborators-heading">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2
          id="collaborators-heading"
          className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
        >
          Collaborators
        </h2>
        {!loading && (
          <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            {collaborators.length}
          </span>
        )}
      </div>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        Invited users can edit this world. Owners can publish + manage
        collaborators.
      </p>

      {/* Loading skeleton */}
      {loading && (
        <div aria-label="Loading collaborators" className="space-y-2">
          {[1, 2].map((i) => (
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
            onClick={fetchCollaborators}
            className="mt-2 text-sm text-red-600 underline hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          >
            Retry
          </button>
        </div>
      )}

      {/* Action error (remove/leave failures) */}
      {actionError && (
        <p
          role="alert"
          className="mb-3 text-sm text-red-600 dark:text-red-400"
        >
          {actionError}
        </p>
      )}

      {/* Collaborator list */}
      {!loading && !error && owner && (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700">
          {/* Owner row — always first */}
          <li className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Avatar avatarUrl={owner.avatarUrl} username={owner.username} />
            <a
              href={`/profile/${owner.username}`}
              className="text-sm font-medium text-neutral-900 hover:underline dark:text-neutral-100"
            >
              @{owner.username}
            </a>
            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              Owner
            </span>
          </li>

          {/* Collaborator rows */}
          {collaborators.map((collab) => {
            const isSelf = collab.id === currentUserId;
            const isRemoving = removingId === collab.id;

            return (
              <li
                key={collab.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap"
              >
                <Avatar
                  avatarUrl={collab.avatarUrl}
                  username={collab.username}
                />
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  <a
                    href={`/profile/${collab.username}`}
                    className="text-sm font-medium text-neutral-900 hover:underline dark:text-neutral-100"
                  >
                    @{collab.username}
                  </a>
                  <RoleBadge role={collab.role} />
                  <span className="text-xs text-neutral-400 dark:text-neutral-500">
                    {collab.addedBy
                      ? `added by @${collab.addedBy.username} · `
                      : "added · "}
                    <span title={collab.addedAt}>
                      {formatRelative(collab.addedAt)}
                    </span>
                  </span>
                </div>

                {/* Action: owner sees "Remove"; the collaborator on their own row sees "Leave"; no one else sees anything */}
                {(isOwner || isSelf) && (
                  <button
                    type="button"
                    onClick={() => handleRemove(collab)}
                    disabled={isRemoving || !!removingId}
                    aria-busy={isRemoving}
                    className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 transition hover:border-neutral-400 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
                  >
                    {isRemoving ? "Removing…" : isSelf ? "Leave" : "Remove"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Empty state (no collaborators) */}
      {!loading && !error && owner && collaborators.length === 0 && (
        <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
          No collaborators yet.
          {isOwner && (
            <> Invite someone to help build this world.</>
          )}
        </p>
      )}

      {/* Invite button — owner-only */}
      {!loading && !error && isOwner && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="rounded-md border border-neutral-300 bg-white px-4 py-1.5 text-sm font-medium text-neutral-700 transition hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            Invite collaborator
          </button>
        </div>
      )}

      {/* Invite dialog */}
      <InviteCollaboratorDialog
        worldId={worldId}
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSuccess={handleInviteSuccess}
      />
    </section>
  );
}
