import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">World not found</h1>
      <p className="mt-3 text-neutral-600 dark:text-neutral-400">
        This world doesn&apos;t exist, or it may have been removed.
      </p>
      <Link
        href="/feed"
        className="mt-8 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        Back to feed
      </Link>
    </main>
  );
}
