"use client";

import { useEffect } from "react";

export default function RootError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Log for dev visibility; production logging is a Slice 7 concern.
    console.error("[FORGE root error]", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        Something went wrong
      </h1>
      <p className="mt-3 text-neutral-600 dark:text-neutral-400">
        We hit an unexpected error. Try again, or head back to the feed.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-600">
          Error ID: {error.digest}
        </p>
      )}
      <div className="mt-8 flex justify-center gap-3">
        <button
          type="button"
          onClick={unstable_retry}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Try again
        </button>
        <a
          href="/"
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Back to feed
        </a>
      </div>
    </main>
  );
}
