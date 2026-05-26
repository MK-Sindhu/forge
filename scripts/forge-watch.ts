/**
 * scripts/forge-watch.ts
 *
 * FORGE Folder Watcher CLI
 * ========================
 * Watches a local folder for .glb file changes and automatically syncs them
 * into a FORGE scene-graph world via the Phase 2 API. This is the
 * "edit in Blender, save the .glb, it appears in FORGE" workflow.
 *
 * USAGE
 * -----
 *   npm run forge:watch -- \
 *     --world-id=<uuid> \
 *     --folder=<local-path> \
 *     --session=<clerk-session-cookie> \
 *     [--base-url=http://localhost:3000]
 *
 *   OR set FORGE_SESSION env var instead of --session.
 *
 * HOW TO GET YOUR SESSION COOKIE
 * --------------------------------
 * 1. Open your browser and sign in to FORGE.
 * 2. Open DevTools (F12 or Cmd+Option+I on Mac).
 * 3. Go to: Application > Storage > Cookies > (your FORGE domain).
 * 4. Find the cookie named "__session".
 * 5. Copy its value (it is a JWT — a long string starting with "eyJ...").
 * 6. Pass it via --session=<value> or set FORGE_SESSION=<value>.
 *
 * NOTE: Clerk session cookies expire (typically 1 hour rolling, max 7 days).
 * If you see "Your session expired" — go back to DevTools and copy a fresh cookie.
 *
 * REQUIREMENTS
 * ------------
 * - The target world must already be a scene-graph world (not legacy).
 *   If not, use the "Convert to scene graph" button on the world page first.
 * - You must be the owner of the world.
 *
 * EVENT GLYPHS
 * ------------
 *   [+]  New .glb file detected — uploaded and added as a new object
 *   [~]  .glb file changed — re-uploaded and all matching objects swapped
 *   [-]  .glb file deleted locally — kept in FORGE (safe; delete via editor)
 *   [!]  Warning or error
 *   [OK] Operation succeeded
 *
 * KNOWN LIMITATIONS (v1)
 * ----------------------
 * - No auto-delete: deleting a file locally does NOT remove it from the world.
 *   Too risky (a folder rename would nuke a world). Use the editor when ready.
 * - No cross-world sharing: assets are scoped to one world per run.
 * - Session auth only: no API token support in v1. Clipboard the __session cookie.
 * - No GLB validation beyond upload: the server accepts any binary at this stage.
 * - Old world_assets rows are NOT deleted on change: they are referenced by past
 *   world_versions. This is correct — history is immutable.
 */

import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { parseArgs } from "node:util";
import { watch as chokidarWatch } from "chokidar";

// ---------------------------------------------------------------------------
// ANSI color helpers — only when stdout is a TTY
// ---------------------------------------------------------------------------

const isTTY = process.stdout.isTTY === true;

function color(code: string, text: string): string {
  return isTTY ? `\x1b[${code}m${text}\x1b[0m` : text;
}

const green = (t: string) => color("32", t);
const red = (t: string) => color("31", t);
const dim = (t: string) => color("2", t);
const bold = (t: string) => color("1", t);

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const HELP_TEXT = `
${bold("FORGE Folder Watcher")}
Watches a local folder for .glb changes and syncs them into a FORGE world.

${bold("Usage:")}
  npm run forge:watch -- \\
    --world-id=<uuid>       UUID of the scene-graph world to update (required)
    --folder=<path>         Local folder to watch for .glb files (required)
    --session=<token>       Clerk __session cookie value (or set FORGE_SESSION env var)
    [--base-url=<url>]      FORGE API base URL (default: http://localhost:3000)

${bold("How to get your session cookie:")}
  1. Sign in to FORGE in your browser.
  2. Open DevTools -> Application -> Cookies -> (your FORGE domain).
  3. Find the "__session" cookie and copy its value.
  4. Pass it via --session=<value>.
  Session cookies expire (~1 hour rolling). On 401, copy a fresh one.

${bold("Event glyphs:")}
  [+]  New .glb added
  [~]  .glb changed (objects swapped)
  [-]  .glb deleted locally (kept in FORGE)
  [!]  Warning / error
  [OK] Success

${bold("Stop:")} Ctrl+C
`.trim();

function parseCliArgs(): {
  worldId: string;
  folder: string;
  session: string;
  baseUrl: string;
} {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        "world-id": { type: "string" },
        "folder": { type: "string" },
        "session": { type: "string" },
        "base-url": { type: "string" },
        "help": { type: "boolean" },
        "h": { type: "boolean" },
      },
      allowPositionals: false,
      strict: false,
    });
  } catch (err) {
    console.error(red("[!] Argument error:"), err instanceof Error ? err.message : String(err));
    console.error(HELP_TEXT);
    process.exit(1);
  }

  const { values } = parsed;

  if (values["help"] || values["h"]) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const worldId = values["world-id"] as string | undefined;
  const folder = values["folder"] as string | undefined;
  const sessionFromArg = values["session"] as string | undefined;
  const session = sessionFromArg ?? process.env.FORGE_SESSION;
  const baseUrl = (values["base-url"] as string | undefined) ?? "http://localhost:3000";

  const missing: string[] = [];
  if (!worldId) missing.push("--world-id");
  if (!folder) missing.push("--folder");
  if (!session) missing.push("--session (or FORGE_SESSION env var)");

  if (missing.length > 0) {
    console.error(red("[!] Missing required arguments: " + missing.join(", ")));
    console.error("");
    console.error(HELP_TEXT);
    process.exit(1);
  }

  // Validate world-id looks like a UUID
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(worldId!)) {
    console.error(red("[!] --world-id does not look like a UUID: " + worldId));
    process.exit(1);
  }

  return {
    worldId: worldId!,
    folder: folder!,
    session: session!,
    baseUrl: baseUrl.replace(/\/$/, ""),
  };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

type SceneGraphObject = {
  id: string;
  assetId: string;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};

type SceneGraphResponse = {
  sceneGraph: {
    schemaVersion: number;
    objects: SceneGraphObject[];
    [key: string]: unknown;
  } | null;
  versionId: string | null;
  versionNumber: number | null;
  status: string | null;
  publishedVersionId: string | null;
};

type AssetRow = {
  id: string;
  name: string;
  glbUrl: string;
  sizeBytes: number;
  createdAt: string;
};

function makeHeaders(session: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Cookie": `__session=${session}`,
  };
}

async function apiGet(url: string, session: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: makeHeaders(session),
    });
  } catch (err) {
    throw new Error(`Network error: ${err instanceof Error ? err.message : String(err)}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return { ok: res.ok, status: res.status, body };
}

async function apiPost(url: string, session: string, data: unknown): Promise<{ ok: boolean; status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: makeHeaders(session),
      body: JSON.stringify(data),
    });
  } catch (err) {
    throw new Error(`Network error: ${err instanceof Error ? err.message : String(err)}`);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  return { ok: res.ok, status: res.status, body };
}

async function putFileToR2(uploadUrl: string, filePath: string, sizeBytes: number): Promise<void> {
  // Read the whole file into a buffer (files are <= 50 MB per spec cap)
  const buffer = await fsPromises.readFile(filePath);
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "model/gltf-binary",
      "Content-Length": String(sizeBytes),
    },
    // Node fetch accepts Buffer as body
    body: buffer,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`R2 PUT failed: ${res.status} ${text.slice(0, 200)}`);
  }
}

function excerptBody(body: unknown): string {
  const s = typeof body === "string" ? body : JSON.stringify(body);
  return s.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Startup checks
// ---------------------------------------------------------------------------

async function checkWorld(
  baseUrl: string,
  worldId: string,
  session: string
): Promise<SceneGraphResponse> {
  const url = `${baseUrl}/api/worlds/${worldId}/scene-graph`;
  let result: { ok: boolean; status: number; body: unknown };
  try {
    result = await apiGet(url, session);
  } catch (err) {
    console.error(red(`[!] Network error reaching ${url}: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  if (result.status === 401) {
    console.error(red("[!] Your session is invalid or expired."));
    console.error(dim("    Get a fresh __session cookie from DevTools -> Application -> Cookies."));
    process.exit(1);
  }
  if (result.status === 404) {
    console.error(red(`[!] World not found. Check the --world-id: ${worldId}`));
    process.exit(1);
  }
  if (!result.ok) {
    console.error(red(`[!] Unexpected response from GET /scene-graph: ${result.status}`));
    console.error(dim("    " + excerptBody(result.body)));
    process.exit(1);
  }

  const data = result.body as SceneGraphResponse;

  if (data.sceneGraph === null && data.versionId === null) {
    // Could be legacy world (no versions at all) OR parse failure (versionId present but sceneGraph null)
    console.error(red("[!] This world has no scene graph."));
    console.error(dim("    If it is a legacy .glb world, use the 'Convert to scene graph' button on"));
    console.error(dim("    the world page first, then re-run forge:watch."));
    process.exit(1);
  }

  if (data.sceneGraph === null) {
    // versionId exists but parse failure
    console.error(red("[!] This world's scene graph failed to parse. Check the FORGE logs."));
    process.exit(1);
  }

  return data;
}

async function loadExistingAssets(
  baseUrl: string,
  worldId: string,
  session: string
): Promise<Map<string, string>> {
  // Returns: lowercased-basename-without-ext -> assetId
  const url = `${baseUrl}/api/worlds/${worldId}/assets`;
  let result: { ok: boolean; status: number; body: unknown };
  try {
    result = await apiGet(url, session);
  } catch (err) {
    console.error(red(`[!] Could not load existing assets: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
  if (!result.ok) {
    console.error(red(`[!] GET /assets failed: ${result.status} ${excerptBody(result.body)}`));
    process.exit(1);
  }

  const assets = result.body as AssetRow[];
  const map = new Map<string, string>();
  for (const a of assets) {
    // asset.name is the basename-without-ext we stored when uploading
    map.set(a.name.toLowerCase(), a.id);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Upload + API operations
// ---------------------------------------------------------------------------

async function uploadGlbAsset(
  baseUrl: string,
  worldId: string,
  session: string,
  filePath: string,
  assetId: string,
  assetName: string
): Promise<{ glbUrl: string }> {
  const stats = await fsPromises.stat(filePath);
  const sizeBytes = stats.size;

  // 1. Get presigned upload URL
  const signResult = await apiPost(`${baseUrl}/api/uploads/sign`, session, {
    kind: "asset",
    worldId,
    assetId,
    contentType: "model/gltf-binary",
    sizeBytes,
  });

  if (!signResult.ok) {
    if (signResult.status === 401) {
      throw new Error("Session expired. Re-copy the cookie from your browser and restart.");
    }
    throw new Error(`POST /uploads/sign failed: ${signResult.status} ${excerptBody(signResult.body)}`);
  }

  const { uploadUrl } = signResult.body as { uploadUrl: string; objectKey: string };

  // 2. PUT file to R2
  await putFileToR2(uploadUrl, filePath, sizeBytes);

  // 3. Finalize asset row
  const finalizeResult = await apiPost(`${baseUrl}/api/worlds/${worldId}/assets`, session, {
    assetId,
    name: assetName,
    sizeBytes,
  });

  if (!finalizeResult.ok) {
    throw new Error(`POST /assets failed: ${finalizeResult.status} ${excerptBody(finalizeResult.body)}`);
  }

  const row = finalizeResult.body as { id: string; glbUrl: string };
  return { glbUrl: row.glbUrl };
}

async function applyOpsWithRetry(
  baseUrl: string,
  worldId: string,
  session: string,
  ops: unknown[],
  label: string,
  baseVersionId: string
): Promise<{ versionId: string; versionNumber: number }> {
  async function tryApply(vid: string): Promise<{ ok: boolean; status: number; body: unknown }> {
    return apiPost(`${baseUrl}/api/worlds/${worldId}/scene-graph/ops`, session, {
      ops,
      baseVersionId: vid,
      label,
    });
  }

  let result = await tryApply(baseVersionId);

  if (result.status === 409) {
    // Retry once with a fresh baseVersionId from the conflict body
    const conflict = result.body as { currentVersion?: { versionId?: string } };
    const freshVersionId = conflict?.currentVersion?.versionId;
    if (freshVersionId) {
      console.log(dim(`    [!] Version conflict — retrying with fresh baseVersionId...`));
      result = await tryApply(freshVersionId);
    }
  }

  if (!result.ok) {
    if (result.status === 409) {
      throw new Error(`409 conflict on second attempt — skipping. Re-save the file to retry.`);
    }
    if (result.status === 401) {
      throw new Error("Session expired. Re-copy the cookie from your browser and restart.");
    }
    throw new Error(`POST /scene-graph/ops failed: ${result.status} ${excerptBody(result.body)}`);
  }

  const r = result.body as { versionId: string; versionNumber: number };
  return { versionId: r.versionId, versionNumber: r.versionNumber };
}

async function getSceneGraph(
  baseUrl: string,
  worldId: string,
  session: string
): Promise<SceneGraphResponse> {
  const result = await apiGet(`${baseUrl}/api/worlds/${worldId}/scene-graph`, session);
  if (!result.ok) {
    throw new Error(`GET /scene-graph failed: ${result.status} ${excerptBody(result.body)}`);
  }
  return result.body as SceneGraphResponse;
}

// ---------------------------------------------------------------------------
// Queue — serialize all file operations (no concurrent ops to same world)
// ---------------------------------------------------------------------------

type QueuedTask = () => Promise<void>;

class SerialQueue {
  private _queue: QueuedTask[] = [];
  private _running = false;

  enqueue(task: QueuedTask): void {
    this._queue.push(task);
    if (!this._running) {
      void this._drain();
    }
  }

  private async _drain(): Promise<void> {
    this._running = true;
    while (this._queue.length > 0) {
      const task = this._queue.shift()!;
      try {
        await task();
      } catch (err) {
        // Each task should handle its own errors and print; this is a safety net
        console.error(red("[!] Unexpected queue error:"), err instanceof Error ? err.message : String(err));
      }
    }
    this._running = false;
  }
}

// ---------------------------------------------------------------------------
// File event handlers
// ---------------------------------------------------------------------------

function basenameWithoutExt(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

async function handleAdd(
  filePath: string,
  isInitial: boolean,
  ctx: {
    baseUrl: string;
    worldId: string;
    session: string;
    assetMap: Map<string, string>; // lowercase-name -> assetId
  }
): Promise<void> {
  const fileName = path.basename(filePath);
  const assetName = basenameWithoutExt(filePath);
  const key = assetName.toLowerCase();

  if (ctx.assetMap.has(key)) {
    if (isInitial) {
      console.log(dim(`    Already tracked: ${fileName}`));
    }
    return;
  }

  console.log(`[+] New file: ${fileName}`);

  const assetId = crypto.randomUUID();

  try {
    await uploadGlbAsset(ctx.baseUrl, ctx.worldId, ctx.session, filePath, assetId, assetName);

    // Get fresh scene graph for baseVersionId
    const sg = await getSceneGraph(ctx.baseUrl, ctx.worldId, ctx.session);
    const baseVersionId = sg.versionId;
    if (!baseVersionId) {
      throw new Error("World has no versions yet — cannot apply ops. Convert the world first.");
    }

    const result = await applyOpsWithRetry(
      ctx.baseUrl,
      ctx.worldId,
      ctx.session,
      [{ op: "add_object", assetId, name: assetName }],
      `forge-watch: added ${fileName}`,
      baseVersionId
    );

    ctx.assetMap.set(key, assetId);
    console.log(green(`    [OK] Added: ${fileName} -> object placed at origin (version ${result.versionNumber})`));
  } catch (err) {
    console.error(red(`    [!] Failed to add ${fileName}: ${err instanceof Error ? err.message : String(err)}`));
  }
}

async function handleChange(
  filePath: string,
  ctx: {
    baseUrl: string;
    worldId: string;
    session: string;
    assetMap: Map<string, string>;
  }
): Promise<void> {
  const fileName = path.basename(filePath);
  const assetName = basenameWithoutExt(filePath);
  const key = assetName.toLowerCase();

  if (!ctx.assetMap.has(key)) {
    // Not tracked yet — treat as new add
    console.log(`[~] Changed (not tracked): ${fileName} — treating as new file`);
    await handleAdd(filePath, false, ctx);
    return;
  }

  console.log(`[~] Changed: ${fileName}`);

  const oldAssetId = ctx.assetMap.get(key)!;
  const newAssetId = crypto.randomUUID();

  try {
    await uploadGlbAsset(ctx.baseUrl, ctx.worldId, ctx.session, filePath, newAssetId, assetName);

    // Get fresh scene graph to find all objects referencing the old asset
    const sg = await getSceneGraph(ctx.baseUrl, ctx.worldId, ctx.session);
    const baseVersionId = sg.versionId;
    if (!baseVersionId) {
      throw new Error("World has no versions — cannot apply ops.");
    }

    // Find all objects that reference oldAssetId
    const matchingObjects = (sg.sceneGraph?.objects ?? []).filter(
      (obj: SceneGraphObject) => obj.assetId === oldAssetId
    );

    if (matchingObjects.length === 0) {
      // No objects use the old asset — just update the map for future adds
      ctx.assetMap.set(key, newAssetId);
      console.log(dim(`    [!] No objects in scene reference the old asset — asset row created but no objects swapped.`));
      console.log(green(`    [OK] Updated asset: ${fileName} (new assetId registered, 0 objects swapped)`));
      return;
    }

    const ops = matchingObjects.map((obj: SceneGraphObject) => ({
      op: "set_object_asset",
      id: obj.id,
      assetId: newAssetId,
    }));

    const result = await applyOpsWithRetry(
      ctx.baseUrl,
      ctx.worldId,
      ctx.session,
      ops,
      `forge-watch: updated ${fileName}`,
      baseVersionId
    );

    ctx.assetMap.set(key, newAssetId);
    console.log(
      green(`    [OK] Updated: ${fileName} — ${matchingObjects.length} object(s) swapped (version ${result.versionNumber})`)
    );
  } catch (err) {
    console.error(red(`    [!] Failed to update ${fileName}: ${err instanceof Error ? err.message : String(err)}`));
  }
}

function handleUnlink(filePath: string): void {
  const fileName = path.basename(filePath);
  console.log(`[-] Deleted locally: ${fileName} — kept in FORGE (delete from world via the editor).`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { worldId, folder, session, baseUrl } = parseCliArgs();

  // Resolve folder to absolute path
  const absFolder = path.resolve(folder);

  // Check folder exists and is readable
  try {
    await fsPromises.access(absFolder, fs.constants.R_OK);
    const stats = await fsPromises.stat(absFolder);
    if (!stats.isDirectory()) {
      console.error(red(`[!] --folder is not a directory: ${absFolder}`));
      process.exit(1);
    }
  } catch {
    console.error(red(`[!] Folder does not exist or is not readable: ${absFolder}`));
    process.exit(1);
  }

  // Print startup banner
  console.log("");
  console.log(bold("FORGE Folder Watcher"));
  console.log(dim("Phase 2 — folder-watcher CLI"));
  console.log("");
  console.log(`  World ID : ${worldId}`);
  console.log(`  Folder   : ${absFolder}`);
  console.log(`  Base URL : ${baseUrl}`);
  console.log(`  Session  : ${session.slice(0, 12)}...`);
  console.log("");
  console.log(dim("  Stop: Ctrl+C"));
  console.log("");

  // Sanity-check the world
  process.stdout.write("  Checking world...");
  const sg = await checkWorld(baseUrl, worldId, session);
  const versionNum = sg.versionNumber ?? "?";
  console.log(green(` OK (current version ${versionNum})`));

  // Load existing assets into the map
  process.stdout.write("  Loading existing assets...");
  const assetMap = await loadExistingAssets(baseUrl, worldId, session);
  console.log(green(` OK (${assetMap.size} assets already tracked)`));
  console.log("");

  const ctx = { baseUrl, worldId, session, assetMap };
  const queue = new SerialQueue();

  // Start chokidar — watch .glb files only
  let initialScanDone = false;

  const watcher = chokidarWatch(absFolder, {
    ignored: /(^|[/\\])\../,       // skip hidden files/dirs
    persistent: true,
    ignoreInitial: false,          // we DO want the initial scan to populate
    awaitWriteFinish: {
      stabilityThreshold: 500,     // wait 500ms after last write event before firing
      pollInterval: 100,
    },
  });

  watcher.on("add", (filePath: string) => {
    if (!filePath.toLowerCase().endsWith(".glb")) return;
    queue.enqueue(() => handleAdd(filePath, !initialScanDone, ctx));
  });

  watcher.on("change", (filePath: string) => {
    if (!filePath.toLowerCase().endsWith(".glb")) return;
    queue.enqueue(() => handleChange(filePath, ctx));
  });

  watcher.on("unlink", (filePath: string) => {
    if (!filePath.toLowerCase().endsWith(".glb")) return;
    // Remove from map if tracked; the remote asset stays
    const key = basenameWithoutExt(filePath).toLowerCase();
    ctx.assetMap.delete(key);
    handleUnlink(filePath);
  });

  watcher.on("ready", () => {
    initialScanDone = true;
    console.log(green("  Ready. Watching for .glb changes..."));
    console.log(dim("  (Ctrl+C to stop)"));
    console.log("");
  });

  watcher.on("error", (err: unknown) => {
    console.error(red(`[!] Watcher error: ${err instanceof Error ? err.message : String(err)}`));
  });

  // Graceful shutdown
  function shutdown(signal: string): void {
    console.log("");
    console.log(dim(`  Received ${signal} — stopping watcher...`));
    watcher.close().then(() => {
      console.log("  Stopped.");
      process.exit(0);
    }).catch(() => {
      process.exit(0);
    });
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(red("[!] Fatal error:"), err instanceof Error ? err.message : String(err));
  process.exit(1);
});
