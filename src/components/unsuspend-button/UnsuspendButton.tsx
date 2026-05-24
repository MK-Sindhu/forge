"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface UnsuspendButtonProps {
  userId: string;
  username: string;
}

export function UnsuspendButton({ userId, username }: UnsuspendButtonProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleUnsuspend() {
    if (
      !window.confirm(
        `Unsuspend @${username}? They will be able to like, comment, follow, and upload again.`
      )
    )
      return;

    if (pending) return;
    setPending(true);

    try {
      const res = await fetch(`/api/admin/users/${userId}/suspend`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to unsuspend user");
      setPending(false);
    }
  }

  return (
    <button
      onClick={handleUnsuspend}
      disabled={pending}
      className="rounded-md bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
    >
      {pending ? "Unsuspending…" : "Unsuspend"}
    </button>
  );
}
