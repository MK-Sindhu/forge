/**
 * /world/[id]/edit — in-browser world editor page.
 *
 * Server component. Owner or editor-gated (collaborators can open the editor).
 * Fetches initial scene-graph + asset data inline from the DB (faster than
 * round-tripping through the API route).
 *
 * Gates:
 *  1. Not signed in → 401-style redirect to sign-in
 *  2. World not found → notFound()
 *  3. Not the world owner or an editor collaborator → "forbidden" inline page
 *  4. Legacy world (sceneGraph === null) → "convert first" inline page
 *
 * Passes serializable data to <EditorShell> which owns the client-side
 * layout and store initialization.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { worlds, worldVersions, worldAssets } from "@/db/schema";
import { requireActiveDbUser } from "@/lib/users";
import { getWorldRoleForUser } from "@/lib/world-permissions";
import { parseSceneGraph } from "@/lib/scene-graph/schema";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";
import { EditorShell } from "@/components/editor/EditorShell";

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params;

  const world = await db.query.worlds.findFirst({
    where: eq(worlds.id, id),
    columns: { title: true },
  });

  if (!world) {
    return { title: "World not found" };
  }

  return {
    // title.template from layout.tsx will append " · FORGE"
    title: `Editing: ${world.title}`,
    robots: { index: false, follow: false }, // editor is never publicly crawlable
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function EditWorldPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 1. Auth check — must be signed in
  const { userId } = await auth();
  if (!userId) {
    redirect(`/sign-in?redirect_url=/world/${id}/edit`);
  }

  const clerkUser = await currentUser();
  if (!clerkUser) {
    // Shouldn't happen if userId is set, but be defensive
    redirect(`/sign-in?redirect_url=/world/${id}/edit`);
  }

  // 2. Resolve DB user (creates row on first login; enforces suspension)
  const dbUserOrError = await requireActiveDbUser(clerkUser);
  if ("status" in dbUserOrError) {
    // requireActiveDbUser returned a NextResponse — account suspended or DB error.
    // Redirect to the world page which will surface an appropriate message.
    redirect(`/world/${id}`);
  }
  const dbUser = dbUserOrError;

  // 3. Look up the world + resolve role (owner or editor collaborator)
  const roleResult = await getWorldRoleForUser(id, dbUser);

  if (roleResult.kind === "not-found") {
    notFound();
  }

  if (roleResult.kind === "db-error") {
    // Redirect to the world page which will surface a generic error message.
    redirect(`/world/${id}`);
  }

  if (roleResult.kind === "forbidden") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 px-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <h1 className="text-xl font-semibold">You don&apos;t have edit access to this world</h1>
          <p className="text-sm text-zinc-400">
            Only the world owner and invited collaborators can open the editor.
          </p>
          <Link
            href={`/world/${id}`}
            className="inline-flex items-center gap-1.5 text-sm text-zinc-300 hover:text-zinc-100 underline underline-offset-2 transition-colors"
          >
            <span aria-hidden>&#8592;</span>
            Back to world
          </Link>
        </div>
      </main>
    );
  }

  // roleResult.kind === "ok"
  const world = roleResult.world;

  // 5. Scene-graph gate — legacy worlds must be converted first
  if (world.sceneGraph === null) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 px-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <h1 className="text-xl font-semibold">Convert this world before editing</h1>
          <p className="text-sm text-zinc-400">
            This world uses the legacy single-file format. Convert it to a scene
            graph first — the button is on the world page.
          </p>
          <Link
            href={`/world/${id}`}
            className="inline-flex items-center gap-1.5 text-sm text-zinc-300 hover:text-zinc-100 underline underline-offset-2 transition-colors"
          >
            <span aria-hidden>&#8592;</span>
            Go to world page
          </Link>
        </div>
      </main>
    );
  }

  // 6. Fetch latest scene-graph version (inline DB query — faster than fetch)
  const latestVersion = await db.query.worldVersions.findFirst({
    where: eq(worldVersions.worldId, id),
    orderBy: [desc(worldVersions.versionNumber)],
    columns: { id: true, sceneGraph: true },
  });

  if (!latestVersion) {
    // World has sceneGraph set but no version rows — shouldn't happen after
    // convert-to-scene-graph, but handle defensively.
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 px-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <h1 className="text-xl font-semibold">No scene graph versions found</h1>
          <p className="text-sm text-zinc-400">
            Something went wrong with this world&apos;s data. Try visiting the
            world page to diagnose.
          </p>
          <Link
            href={`/world/${id}`}
            className="inline-flex items-center gap-1.5 text-sm text-zinc-300 hover:text-zinc-100 underline underline-offset-2 transition-colors"
          >
            <span aria-hidden>&#8592;</span>
            Back to world
          </Link>
        </div>
      </main>
    );
  }

  // 7. Parse the scene graph defensively
  let sceneGraph: SceneGraphV1;
  try {
    sceneGraph = parseSceneGraph(latestVersion.sceneGraph) as SceneGraphV1;
  } catch (err) {
    console.error(`[edit/page] failed to parse scene graph for world ${id}:`, err);
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 px-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <h1 className="text-xl font-semibold">Scene graph data is invalid</h1>
          <p className="text-sm text-zinc-400">
            The world&apos;s scene graph could not be read. Please report this
            to the FORGE team.
          </p>
          <Link
            href={`/world/${id}`}
            className="inline-flex items-center gap-1.5 text-sm text-zinc-300 hover:text-zinc-100 underline underline-offset-2 transition-colors"
          >
            <span aria-hidden>&#8592;</span>
            Back to world
          </Link>
        </div>
      </main>
    );
  }

  // 8. Fetch assets for this world (capped at 100, newest first)
  const rawAssets = await db
    .select({
      id: worldAssets.id,
      name: worldAssets.name,
      glbUrl: worldAssets.glbUrl,
      sizeBytes: worldAssets.glbSizeBytes,
    })
    .from(worldAssets)
    .where(eq(worldAssets.worldId, id))
    .orderBy(desc(worldAssets.createdAt))
    .limit(100);

  // 9. Render the editor shell
  return (
    <EditorShell
      worldId={id}
      worldTitle={world.title}
      sceneGraph={sceneGraph}
      baseVersionId={latestVersion.id}
      assets={rawAssets}
    />
  );
}
