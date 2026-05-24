"use client";

import { useState } from "react";

interface Props {
  worldId: string;
  /** Server-rendered initial like state. */
  initialLiked: boolean;
  /** Server-rendered initial like count. */
  initialLikesCount: number;
  /** Whether the visitor is signed in. */
  signedIn: boolean;
}

export function LikeButton({
  worldId,
  initialLiked,
  initialLikesCount,
  signedIn,
}: Props) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialLikesCount);
  const [pending, setPending] = useState(false);

  async function onClick() {
    if (!signedIn || pending) return;

    const wasLiked = liked;
    // Optimistic flip
    setLiked(!wasLiked);
    setCount((c) => c + (wasLiked ? -1 : 1));
    setPending(true);

    try {
      const res = await fetch(`/api/worlds/${worldId}/likes`, {
        method: wasLiked ? "DELETE" : "POST",
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = (await res.json()) as { liked: boolean; likesCount: number };
      setLiked(data.liked);
      setCount(data.likesCount);
    } catch (err) {
      // Revert optimistic update
      setLiked(wasLiked);
      setCount((c) => c + (wasLiked ? 1 : -1));
      console.error("[LikeButton] toggle failed:", err);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!signedIn || pending}
      aria-pressed={liked}
      aria-label={liked ? "Unlike this world" : "Like this world"}
      title={!signedIn ? "Sign in to like worlds" : undefined}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
        liked
          ? "border-red-300 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50"
          : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <HeartIcon filled={liked} />
      <span>{count}</span>
    </button>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
