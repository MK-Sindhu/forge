"use client";

import { useState } from "react";

interface RepostButtonProps {
  worldId: string;
  /** Server-rendered initial repost state. */
  initialReposted: boolean;
  /** Whether the visitor is signed in. */
  signedIn: boolean;
}

export function RepostButton({
  worldId,
  initialReposted,
  signedIn,
}: RepostButtonProps) {
  const [reposted, setReposted] = useState(initialReposted);
  const [pending, setPending] = useState(false);

  async function onClick() {
    if (!signedIn || pending) return;

    const wasReposted = reposted;
    // Optimistic flip
    setReposted(!wasReposted);
    setPending(true);

    try {
      const res = await fetch(`/api/worlds/${worldId}/repost`, {
        method: wasReposted ? "DELETE" : "POST",
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = (await res.json()) as { reposted: boolean };
      setReposted(data.reposted);
    } catch (err) {
      // Revert optimistic update
      setReposted(wasReposted);
      console.error("[RepostButton] toggle failed:", err);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!signedIn || pending}
      aria-pressed={reposted}
      aria-label={reposted ? "Remove repost" : "Repost this world"}
      title={!signedIn ? "Sign in to repost worlds" : undefined}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
        reposted
          ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
          : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <RepostIcon active={reposted} />
      <span>{reposted ? "Reposted" : "Repost"}</span>
    </button>
  );
}

function RepostIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.5 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Retweet-style arrows */}
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}
