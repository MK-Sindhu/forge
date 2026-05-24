"use client";

import { useState } from "react";

interface Props {
  /** Optional title for the native Web Share API (the world's title). */
  title?: string;
}

export function ShareButton({ title }: Props) {
  const [copied, setCopied] = useState(false);

  async function onShare() {
    const url = window.location.href;

    // Prefer Web Share API on mobile / supported browsers.
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ url, title });
        return;
      } catch (err) {
        // User canceled — nothing to do.
        if (err instanceof Error && err.name === "AbortError") return;
        // Share failed — fall through to clipboard.
      }
    }

    // Fallback: copy to clipboard.
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Older browsers without clipboard API — UX degrades gracefully.
    }
  }

  return (
    <button
      type="button"
      onClick={onShare}
      aria-label={copied ? "Copied to clipboard" : "Share this world"}
      className="inline-flex items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 transition"
    >
      <ShareIcon />
      <span>{copied ? "Copied!" : "Share"}</span>
    </button>
  );
}

function ShareIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </svg>
  );
}
