import { notFound } from "next/navigation";
import { headers } from "next/headers";
import Image from "next/image";
import { WorldViewerClient } from "./WorldViewerClient";

export default async function WorldPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Server-side fetch via the API route (uses absolute URL).
  // Derive the base URL from request headers — works in dev, Vercel, and
  // preview deploys without any env var config.
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  const baseUrl = `${proto}://${host}`;

  const res = await fetch(`${baseUrl}/api/worlds/${id}`, {
    // World data may change (likes count); don't cache aggressively in Slice 1.
    cache: "no-store",
  });
  if (res.status === 404) {
    notFound(); // Renders not-found.tsx
  }
  if (!res.ok) {
    throw new Error(`Failed to load world: ${res.status}`);
  }
  const world = await res.json();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      {/* Header section: title, author, metadata */}
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">{world.title}</h1>
        <div className="mt-2 flex items-center gap-3 text-sm text-neutral-600">
          {world.author.avatarUrl && (
            <Image
              src={world.author.avatarUrl}
              alt={world.author.username}
              width={32}
              height={32}
              className="rounded-full"
              unoptimized // Avatars are from Clerk — bypass Next image optimizer for now
            />
          )}
          <span>
            by{" "}
            <a
              href={`/profile/${world.author.username}`}
              className="font-medium text-neutral-900 hover:underline"
            >
              {world.author.username}
            </a>
          </span>
          <span aria-hidden>·</span>
          <time dateTime={world.createdAt}>
            {new Date(world.createdAt).toLocaleDateString()}
          </time>
        </div>
      </header>

      {/* 3D viewer — fills a fixed-aspect container */}
      <div className="aspect-video w-full overflow-hidden rounded-lg border border-neutral-200">
        <WorldViewerClient glbUrl={world.glbUrl} ariaLabel={`3D world: ${world.title}`} />
      </div>

      {/* Description (only if present) */}
      {world.description && (
        <section className="mt-6">
          <p className="whitespace-pre-wrap text-neutral-700">{world.description}</p>
        </section>
      )}

      {/* Stat row */}
      <div className="mt-6 flex gap-6 text-sm text-neutral-600">
        <span>{world.likesCount} {world.likesCount === 1 ? "like" : "likes"}</span>
        <span>{world.views} {world.views === 1 ? "view" : "views"}</span>
      </div>
    </main>
  );
}
