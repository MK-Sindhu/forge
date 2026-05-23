import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">
        Creator not found
      </h1>
      <p className="mt-3 text-neutral-600">
        This profile doesn&apos;t exist, or the username may have changed.
      </p>
      <Link
        href="/feed"
        className="mt-8 inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
      >
        Back to feed
      </Link>
    </main>
  );
}
