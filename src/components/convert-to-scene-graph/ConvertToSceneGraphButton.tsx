"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  worldId: string;
}

export function ConvertToSceneGraphButton({ worldId }: Props) {
  const router = useRouter();
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConvert() {
    if (converting) return;
    setConverting(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/worlds/${worldId}/convert-to-scene-graph`,
        { method: "POST" }
      );

      if (res.ok || res.status === 409) {
        // 200 = success; 409 = already converted (e.g. double-click in another tab)
        // In both cases, refresh the page to reflect the new state.
        router.refresh();
        return;
      }

      // Other errors — surface inline
      let msg = `Server error (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) msg = body.error;
      } catch {
        // non-JSON body — keep the generic message
      }
      setError(msg);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error — please try again"
      );
    } finally {
      setConverting(false);
    }
  }

  return (
    <div className="mt-8 rounded-lg border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Scene graph editor
          </p>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            Unlocks version history and (soon) the in-browser editor. Your world
            will render identically. This action cannot be undone via the UI.
          </p>
          {error && (
            <p
              role="alert"
              id={`convert-error-${worldId}`}
              className="mt-2 text-xs text-red-600 dark:text-red-400"
            >
              Couldn&apos;t convert: {error}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={handleConvert}
          disabled={converting}
          aria-busy={converting}
          aria-describedby={error ? `convert-error-${worldId}` : undefined}
          className="shrink-0 self-start rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 shadow-sm transition hover:border-neutral-400 hover:bg-neutral-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
        >
          {converting ? (
            <span className="inline-flex items-center gap-2">
              <SpinnerIcon />
              Converting&hellip;
            </span>
          ) : (
            "Convert to editable scene graph"
          )}
        </button>
      </div>
    </div>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
