import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock hoisting
//
// vi.hoisted() runs synchronously before any import resolves. Every mock
// factory that a vi.mock() factory references must be hoisted here.
// ---------------------------------------------------------------------------

const {
  mockDbSelectLimit,
  mockFindFirst,
} = vi.hoisted(() => ({
  // db.select().from().where().limit() — world existence check
  mockDbSelectLimit: vi.fn(),
  // db.query.worldVersions.findFirst() — latest version lookup
  mockFindFirst: vi.fn(),
}));

// Mock @/db — real DB connections require DATABASE_URL + a running Neon
// instance; both are unavailable in the test runner.
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => mockDbSelectLimit(...args),
        }),
      }),
    }),
    query: {
      worldVersions: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  },
}));

// Import handler AFTER mocks are registered.
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_UUID = "550e8400-e29b-41d4-a716-446655440000";
const VERSION_UUID_1 = "660e8400-e29b-41d4-a716-446655440001";
const VERSION_UUID_2 = "770e8400-e29b-41d4-a716-446655440002";
const PUBLISHED_VERSION_UUID = "880e8400-e29b-41d4-a716-446655440003";

const VALID_SCENE_GRAPH = {
  schemaVersion: 1,
  objects: [],
  lights: [
    { type: "ambient", intensity: 0.5, color: "#ffffff" },
    { type: "sun", intensity: 1, direction: [5, 5, 5], color: "#ffffff" },
  ],
  environment: { skybox: "studio", fog: null },
  spawnPoints: [{ id: "default", position: [0, 1.6, 5], rotation: [0, 0, 0] }],
  camera: { position: [3, 3, 5], target: [0, 0, 0], fov: 50 },
};

function callGet(worldId: string) {
  const req = new Request(`http://localhost/api/worlds/${worldId}/scene-graph`);
  return GET(req, { params: Promise.resolve({ id: worldId }) });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/worlds/[id]/scene-graph — 404 on missing world", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when the world does not exist", async () => {
    mockDbSelectLimit.mockResolvedValue([]); // world not found

    const res = await callGet(WORLD_UUID);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });
});

describe("GET /api/worlds/[id]/scene-graph — legacy world (no versions)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns null version fields for a world with no world_versions rows", async () => {
    // World exists
    mockDbSelectLimit.mockResolvedValue([
      { id: WORLD_UUID, publishedVersionId: null },
    ]);
    // No versions
    mockFindFirst.mockResolvedValue(undefined);

    const res = await callGet(WORLD_UUID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      sceneGraph: null,
      versionId: null,
      versionNumber: null,
      status: null,
      publishedVersionId: null,
    });
  });

  it("includes the world's publishedVersionId even when no versions exist", async () => {
    mockDbSelectLimit.mockResolvedValue([
      { id: WORLD_UUID, publishedVersionId: PUBLISHED_VERSION_UUID },
    ]);
    mockFindFirst.mockResolvedValue(undefined);

    const res = await callGet(WORLD_UUID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.publishedVersionId).toBe(PUBLISHED_VERSION_UUID);
  });
});

describe("GET /api/worlds/[id]/scene-graph — world with versions", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the latest version's scene graph and metadata", async () => {
    mockDbSelectLimit.mockResolvedValue([
      { id: WORLD_UUID, publishedVersionId: PUBLISHED_VERSION_UUID },
    ]);
    mockFindFirst.mockResolvedValue({
      id: VERSION_UUID_2,
      versionNumber: 3,
      sceneGraph: VALID_SCENE_GRAPH,
      status: "draft",
    });

    const res = await callGet(WORLD_UUID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versionId).toBe(VERSION_UUID_2);
    expect(body.versionNumber).toBe(3);
    expect(body.status).toBe("draft");
    expect(body.publishedVersionId).toBe(PUBLISHED_VERSION_UUID);
    // sceneGraph must be the parsed (Zod-normalized) scene graph
    expect(body.sceneGraph).toBeTruthy();
    expect(body.sceneGraph.schemaVersion).toBe(1);
  });

  it("returns sceneGraph: null (not a crash) when the stored scene_graph is unparseable", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockDbSelectLimit.mockResolvedValue([
      { id: WORLD_UUID, publishedVersionId: null },
    ]);
    mockFindFirst.mockResolvedValue({
      id: VERSION_UUID_1,
      versionNumber: 1,
      sceneGraph: { schemaVersion: 999 }, // unknown version — parseSceneGraph throws
      status: "published",
    });

    const res = await callGet(WORLD_UUID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sceneGraph).toBeNull();
    expect(body.versionId).toBe(VERSION_UUID_1);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
