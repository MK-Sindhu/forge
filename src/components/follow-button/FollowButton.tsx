"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  username: string;
  /** Server-rendered initial follow state. */
  initialFollowing: boolean;
  /** Whether the visitor is signed in. */
  signedIn: boolean;
}

export function FollowButton({ username, initialFollowing, signedIn }: Props) {
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function onClick() {
    if (!signedIn || pending) return;

    const wasFollowing = following;
    // Optimistic flip
    setFollowing(!wasFollowing);
    setPending(true);

    try {
      const res = await fetch(
        `/api/users/${encodeURIComponent(username)}/follow`,
        { method: wasFollowing ? "DELETE" : "POST" }
      );
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = (await res.json()) as { following: boolean };
      setFollowing(data.following);
      // Re-run the server component so follower count in the header updates.
      router.refresh();
    } catch (err) {
      // Revert optimistic update
      setFollowing(wasFollowing);
      console.error("[FollowButton] toggle failed:", err);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!signedIn || pending}
      aria-pressed={following}
      aria-label={following ? `Unfollow ${username}` : `Follow ${username}`}
      title={!signedIn ? "Sign in to follow creators" : undefined}
      className={`group inline-flex min-w-[110px] items-center justify-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
        following
          ? "border border-neutral-300 bg-white text-neutral-700 hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-red-900 dark:hover:bg-red-950/30 dark:hover:text-red-400"
          : "bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
      }`}
    >
      {following ? (
        <>
          <CheckIcon className="block group-hover:hidden" />
          <span className="block group-hover:hidden">Following</span>
          <span className="hidden group-hover:block">Unfollow</span>
        </>
      ) : (
        <span>Follow</span>
      )}
    </button>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
