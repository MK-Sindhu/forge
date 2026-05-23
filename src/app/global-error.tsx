"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[FORGE global error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
        <main className="mx-auto max-w-2xl px-4 py-16 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">
            Something went really wrong
          </h1>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">
            The app failed to load. Try refreshing the page.
          </p>
          {error.digest && (
            <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-600">
              Error ID: {error.digest}
            </p>
          )}
          <div className="mt-8 flex justify-center">
            <button
              type="button"
              onClick={unstable_retry}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
