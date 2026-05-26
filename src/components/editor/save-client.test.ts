/**
 * Unit tests for save-client.ts.
 *
 * All tests mock global `fetch` per the pattern used in AssetPanel.test.ts.
 * No DOM, no React — node environment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { saveOps, publishVersion } from "./save-client";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";
import { emptySceneGraph } from "@/lib/scene-graph/schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORLD_ID = "550e8400-e29b-41d4-a716-446655440000";
const VERSION_ID = "aa0e8400-e29b-41d4-a716-446655440001";
const VERSION_ID_2 = "bb0e8400-e29b-41d4-a716-446655440002";

function makeSceneGraph(): SceneGraphV1 {
  return emptySceneGraph();
}

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      status,
      json: () => Promise.resolve(body),
    })
  );
}

// ---------------------------------------------------------------------------
// saveOps tests
// ---------------------------------------------------------------------------

describe("saveOps — 200 happy path", () => {
  beforeEach(() => {
    mockFetch(200, {
      versionId: VERSION_ID_2,
      versionNumber: 2,
      sceneGraph: makeSceneGraph(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok:true with versionId, versionNumber, sceneGraph", async () => {
    const result = await saveOps({
      worldId: WORLD_ID,
      ops: [],
      baseVersionId: VERSION_ID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return; // narrow type

    expect(result.versionId).toBe(VERSION_ID_2);
    expect(result.versionNumber).toBe(2);
    expect(result.sceneGraph).toBeDefined();
    expect(result.sceneGraph.schemaVersion).toBe(1);
  });

  it("sends the correct URL and method", async () => {
    await saveOps({ worldId: WORLD_ID, ops: [], baseVersionId: VERSION_ID });

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/worlds/${WORLD_ID}/scene-graph/ops`);
    expect(opts.method).toBe("POST");
  });
});

describe("saveOps — 409 conflict", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns ok:false with kind:conflict and currentVersion", async () => {
    const currentVersion = {
      versionId: VERSION_ID_2,
      versionNumber: 3,
      sceneGraph: makeSceneGraph(),
      status: "draft" as const,
    };
    mockFetch(409, { error: "version conflict", currentVersion });

    const result = await saveOps({
      worldId: WORLD_ID,
      ops: [],
      baseVersionId: VERSION_ID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.kind).toBe("conflict");
    if (result.kind !== "conflict") return;

    expect(result.currentVersion.versionId).toBe(VERSION_ID_2);
    expect(result.currentVersion.versionNumber).toBe(3);
    expect(result.currentVersion.status).toBe("draft");
  });
});

describe("saveOps — 400 with opIndex (operation-error)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns ok:false kind:operation-error with message and opIndex", async () => {
    mockFetch(400, { error: "Object not found", opIndex: 2 });

    const result = await saveOps({
      worldId: WORLD_ID,
      ops: [],
      baseVersionId: VERSION_ID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.kind).toBe("operation-error");
    if (result.kind !== "operation-error") return;

    expect(result.message).toBe("Object not found");
    expect(result.opIndex).toBe(2);
  });
});

describe("saveOps — 400 without opIndex (generic bad request)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns ok:false kind:other with message", async () => {
    mockFetch(400, { error: "Bad request body" });

    const result = await saveOps({
      worldId: WORLD_ID,
      ops: [],
      baseVersionId: VERSION_ID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.kind).toBe("other");
    if (result.kind !== "other") return;

    expect(result.message).toBe("Bad request body");
  });
});

describe("saveOps — 5xx server error", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns ok:false kind:other with HTTP status message", async () => {
    mockFetch(500, { error: "Internal server error" });

    const result = await saveOps({
      worldId: WORLD_ID,
      ops: [],
      baseVersionId: VERSION_ID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.kind).toBe("other");
    if (result.kind !== "other") return;

    expect(result.message).toBe("HTTP 500");
  });
});

// ---------------------------------------------------------------------------
// publishVersion tests
// ---------------------------------------------------------------------------

describe("publishVersion — 200 happy path", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns ok:true with versionId and versionNumber", async () => {
    mockFetch(200, {
      versionId: VERSION_ID,
      versionNumber: 1,
      status: "published",
    });

    const result = await publishVersion({ worldId: WORLD_ID, versionId: VERSION_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.versionId).toBe(VERSION_ID);
    expect(result.versionNumber).toBe(1);
  });

  it("sends POST to the correct URL", async () => {
    mockFetch(200, { versionId: VERSION_ID, versionNumber: 1, status: "published" });

    await publishVersion({ worldId: WORLD_ID, versionId: VERSION_ID });

    const fetchMock = vi.mocked(fetch);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/worlds/${WORLD_ID}/versions/${VERSION_ID}/publish`);
    expect(opts.method).toBe("POST");
  });
});

describe("publishVersion — 403 forbidden", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns ok:false with error message", async () => {
    mockFetch(403, { error: "Forbidden" });

    const result = await publishVersion({ worldId: WORLD_ID, versionId: VERSION_ID });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.message).toBe("Forbidden");
  });
});
