import Link from "next/link";

// ---------------------------------------------------------------------------
// WelcomeCallout — server component (no 'use client')
//
// Shown above the feed when a signed-in user is "fresh" (has not uploaded any
// world AND follows nobody). The parent page (`src/app/page.tsx`) computes the
// `isFreshUser` flag and mounts this component conditionally — no dismissal
// state, no cookie, no localStorage. The callout silently disappears the moment
// the user uploads their first world OR follows their first creator.
// ---------------------------------------------------------------------------
export function WelcomeCallout() {
  return (
    <section
      aria-labelledby="welcome-heading"
      className="mb-6 rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-950"
    >
      <h2
        id="welcome-heading"
        className="text-xl font-semibold text-neutral-900 dark:text-neutral-100"
      >
        Welcome to FORGE 👋
      </h2>
      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        FORGE is a feed of user-created 3D worlds. Three ways to start:
      </p>

      {/* Action cards — horizontal row that wraps on mobile */}
      <div className="mt-4 flex flex-wrap gap-3">
        {/* Primary action — Upload */}
        <Link
          href="/upload"
          className="flex flex-col gap-1 rounded-lg border border-transparent bg-neutral-900 px-5 py-4 text-white transition hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 dark:focus-visible:ring-neutral-100"
        >
          <span className="text-sm font-semibold">Upload your first world</span>
          <span className="text-xs opacity-75">Publish a .glb file to FORGE</span>
        </Link>

        {/* Secondary — Trending */}
        <Link
          href="/?tab=trending"
          className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white px-5 py-4 text-neutral-900 transition hover:border-neutral-400 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-500 dark:hover:bg-neutral-800 dark:focus-visible:ring-neutral-100"
        >
          <span className="text-sm font-semibold">Browse what&apos;s trending</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            See the most-liked worlds right now
          </span>
        </Link>

        {/* Secondary — Search */}
        <Link
          href="/search"
          className="flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white px-5 py-4 text-neutral-900 transition hover:border-neutral-400 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:border-neutral-500 dark:hover:bg-neutral-800 dark:focus-visible:ring-neutral-100"
        >
          <span className="text-sm font-semibold">Search for tags or worlds</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Find worlds by title, description, or tag
          </span>
        </Link>
      </div>
    </section>
  );
}
