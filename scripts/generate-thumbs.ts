/**
 * Generates a PNG thumbnail for every entry in scripts/seed-worlds/manifest.json
 * by rendering its .glb in a headless Chromium (Playwright) + a local
 * three.js viewer (scripts/generate-thumbs/viewer.html). Output paths are
 * read directly from each entry's `thumbnailPath`.
 *
 * Idempotent: skips entries whose thumbnail file already exists. Re-run
 * after deleting individual PNGs to regenerate just those.
 *
 * Usage:
 *   npm run db:seed-thumbs
 *   # or:
 *   npx tsx scripts/generate-thumbs.ts
 */

import { chromium } from "playwright";
import { createServer } from "http";
import { readFile, stat } from "fs/promises";
import { readFileSync } from "fs";
import path from "path";

const MANIFEST_PATH = path.resolve("scripts/seed-worlds/manifest.json");
const VIEWER_PATH = path.resolve("scripts/generate-thumbs/viewer.html");
const ASSETS_DIR = path.resolve("scripts/seed-worlds/assets");
const PORT = 49233;
const THUMB_WIDTH = 800;
const THUMB_HEIGHT = 800;

type ManifestEntry = {
  glbPath: string;
  thumbnailPath: string;
  title: string;
};

function startServer() {
  return new Promise<{ close: () => Promise<void> }>((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const url = req.url ?? "/";
        if (url === "/viewer.html" || url.startsWith("/viewer.html?")) {
          const html = await readFile(VIEWER_PATH);
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(html);
          return;
        }
        if (url.startsWith("/assets/")) {
          const filename = decodeURIComponent(url.slice("/assets/".length).split("?")[0]);
          const filePath = path.join(ASSETS_DIR, filename);
          const buf = await readFile(filePath);
          const ct = filename.endsWith(".glb") ? "model/gltf-binary" : "application/octet-stream";
          res.setHeader("Content-Type", ct);
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Cache-Control", "no-store");
          res.end(buf);
          return;
        }
        res.statusCode = 404;
        res.end("Not Found");
      } catch (err) {
        res.statusCode = 500;
        res.end(String(err));
      }
    });
    server.listen(PORT, () => {
      resolve({
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

async function generateThumbnail(
  browser: import("playwright").Browser,
  glbFilename: string,
  outputPath: string
) {
  const context = await browser.newContext({
    viewport: { width: THUMB_WIDTH, height: THUMB_HEIGHT },
    deviceScaleFactor: 2, // sharper PNG
  });
  const page = await context.newPage();

  try {
    const glbUrl = `http://localhost:${PORT}/assets/${encodeURIComponent(glbFilename)}`;
    const viewerUrl = `http://localhost:${PORT}/viewer.html?glb=${encodeURIComponent(glbUrl)}`;
    await page.goto(viewerUrl, { waitUntil: "load", timeout: 20000 });

    // Wait for window.__ready or window.__error (both injected by viewer.html)
    await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (window as any).__ready === true || typeof (window as any).__error === "string",
      { timeout: 30000 }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const error = await page.evaluate(() => (window as any).__error as string | undefined);
    if (error) throw new Error(error);

    // Slight settle pause for env map + AA
    await page.waitForTimeout(150);

    const canvas = await page.$("canvas");
    if (!canvas) throw new Error("no canvas element found");
    await canvas.screenshot({ path: outputPath, type: "png", omitBackground: true });
  } finally {
    await context.close();
  }
}

async function main() {
  const manifest: ManifestEntry[] = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  console.log(`Loaded ${manifest.length} entries from manifest.\n`);

  const server = await startServer();
  console.log(`Local asset server: http://localhost:${PORT}`);

  const browser = await chromium.launch({ headless: true });
  console.log(`Headless Chromium launched. Generating ${manifest.length} thumbnails (${THUMB_WIDTH}x${THUMB_HEIGHT}, transparent PNG):\n`);

  let rendered = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < manifest.length; i++) {
    const entry = manifest[i];
    const glbFilename = path.basename(entry.glbPath);
    const outputPath = path.resolve(entry.thumbnailPath);
    const label = `[${String(i + 1).padStart(2, " ")}/${manifest.length}] ${entry.title}`;

    const existing = await stat(outputPath).catch(() => null);
    if (existing) {
      console.log(`${label} ↳ exists (${(existing.size / 1024).toFixed(0)} KB), skipping`);
      skipped++;
      continue;
    }

    try {
      const start = Date.now();
      await generateThumbnail(browser, glbFilename, outputPath);
      const stats = await stat(outputPath);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`${label} ✓ rendered (${(stats.size / 1024).toFixed(0)} KB, ${elapsed}s)`);
      rendered++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${label} ✗ ${msg}`);
      failed++;
    }
  }

  await browser.close();
  await server.close();

  console.log(`\nResults: rendered=${rendered} · skipped=${skipped} · failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
